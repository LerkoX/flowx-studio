package service

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// MediaStore 节点媒体产物物化缓存（路线 A：媒体通道统一化）。
//
// 设计原则：Studio 只有两条通用通道 ——
//   1. 节点→Studio 的单向 marker（stdout 标记行，不落日志/metadata）；
//   2. media 出口（GET /api/v1/media/file?path=...）——唯一 HTTP 媒体出口。
//
// 本模块把 marker 声明的「第三方服务媒体来源」物化（拉取）到磁盘，
// 使 media 出口能覆盖一切节点媒体（推理服务帧/结果、远程 docker 产物…），
// 刷新页面 / Studio 重启 / 第三方服务断网后仍能从磁盘供给最后一帧。
//
// 关键性质：
//   - kind 与 Studio 完全解耦：kind 是不透明分类标签（节点生态自描述），
//     Studio 只解释 mode（replace=覆盖式最新帧 / append=追加序列产物）。
//   - 原子写：临时文件 + rename，前端永远读到完整文件。
//   - 磁盘持久：TTL/LRU 清理，Studio 重启不丢；source.json（0600）供重启后续拉。
type MediaStore struct {
	root        string // <dataDir>/media-cache
	maxBytes    int64
	ttl         time.Duration
	minInterval time.Duration

	mu        sync.Mutex
	keyLocks  map[string]*sync.Mutex // per 物化键的串行锁
	lastFetch map[string]time.Time   // per 键节流
}

// MediaSource marker 声明的来源。token 仅在物化与 0600 落盘的 source.json 内使用。
type MediaSource struct {
	URL   string `json:"url,omitempty"`
	Path  string `json:"path,omitempty"` // local 类型：本地绝对/~/路径（须落在媒体白名单内）
	Token string `json:"token,omitempty"`
	Base  string `json:"base,omitempty"`
	JobID string `json:"job_id,omitempty"`
}

// MediaItem 媒体清单条目（GET /executions/:id/nodes 响应的 media 字段元素）。
type MediaItem struct {
	NodeID    string    `json:"nodeId"`
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	Path      string    `json:"path"` // 供 /api/v1/media/file?path= 使用
	Size      int64     `json:"size"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const (
	mediaStoreDefaultTTL         = 72 * time.Hour
	mediaStoreDefaultMaxBytes    = 5 << 30 // 5GB LRU
	mediaStoreDefaultMinInterval = 500 * time.Millisecond
	mediaStoreFetchTimeout       = 5 * time.Second
	mediaStoreMaxBytes           = 16 << 20 // 单帧/产物上限 16MB
	mediaStoreManifest           = "source.json"
)

// NewMediaStore 创建物化缓存。root 为空时退化为 nil（调用方判空）。
func NewMediaStore(root string) *MediaStore {
	if strings.TrimSpace(root) == "" {
		return nil
	}
	_ = os.MkdirAll(filepath.Join(root, "executions"), 0755)
	return &MediaStore{
		root:        root,
		maxBytes:    mediaStoreDefaultMaxBytes,
		ttl:         mediaStoreDefaultTTL,
		minInterval: mediaStoreDefaultMinInterval,
		keyLocks:    make(map[string]*sync.Mutex),
		lastFetch:   make(map[string]time.Time),
	}
}

// Root 返回缓存根目录（用于纳入媒体白名单）。
func (m *MediaStore) Root() string { return m.root }

// execNodeDir 计算 <root>/executions/<execID>/<sanitized nodeID>/，不创建。
func (m *MediaStore) execNodeDir(execID int64, nodeID string) string {
	return filepath.Join(m.root, "executions", fmt.Sprintf("%d", execID), sanitizeNodeID(nodeID))
}

// sanitizeNodeID 只允许 [A-Za-z0-9_.-]，其它字符替换为下划线——防路径穿越，
// 且保证 marker/请求/磁盘三者索引一致。
func sanitizeNodeID(nodeID string) string {
	var b strings.Builder
	for _, r := range nodeID {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '_', r == '-', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}

// sanitizeName 产物文件名同样只允许安全字符；空名回退 kind。
func sanitizeName(name, kind string) string {
	name = sanitizeNodeID(strings.TrimSpace(name))
	if name == "" || name == "." || name == ".." {
		name = sanitizeNodeID(kind)
		if name == "" {
			name = "media"
		}
	}
	return name
}

// key 物化键 = exec/node/kind（frame 类覆盖式：同键只留最新一份）。
func mediaKey(execID int64, nodeID, kind string) string {
	return fmt.Sprintf("%d/%s/%s", execID, sanitizeNodeID(nodeID), kind)
}

func (m *MediaStore) lockFor(key string) *sync.Mutex {
	m.mu.Lock()
	defer m.mu.Unlock()
	lk := m.keyLocks[key]
	if lk == nil {
		lk = &sync.Mutex{}
		m.keyLocks[key] = lk
	}
	return lk
}

// Materialize 把 http 来源物化到磁盘（异步调用时由调用方起 goroutine）。
// 同键串行 + 节流（minInterval 内重复调用直接跳过——过程帧高频上报不炸第三方）。
// 返回最终落盘绝对路径；节流跳过/失败返回 ("", err)。
func (m *MediaStore) Materialize(execID int64, nodeID, kind string, mode string,
	name string, src MediaSource) (string, error) {
	if src.URL == "" {
		return "", fmt.Errorf("media source requires url")
	}
	key := mediaKey(execID, nodeID, kind)
	lk := m.lockFor(key)
	lk.Lock()
	defer lk.Unlock()

	m.mu.Lock()
	if mode != "append" {
		// 覆盖式产物（过程帧）才节流；追加式（结果）每次都要落
		if last, ok := m.lastFetch[key]; ok && time.Since(last) < m.minInterval {
			m.mu.Unlock()
			return "", fmt.Errorf("throttled")
		}
	}
	m.lastFetch[key] = time.Now()
	m.mu.Unlock()

	frame, mimeType, err := fetchMedia(src.URL, src.Token)
	if err != nil {
		return "", err
	}
	ext := extFromMIME(mimeType)
	dir := m.execNodeDir(execID, nodeID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	// 未带扩展名时按 Content-Type 补（含扩展名则尊重调用方声明）
	fname := sanitizeName(name, kind)
	if filepath.Ext(fname) == "" && ext != "" {
		fname += ext
	}
	if mode == "append" {
		// 追加式结果产物：时间戳插到扩展名前，互不覆盖
		e := filepath.Ext(fname)
		stem := strings.TrimSuffix(fname, e)
		fname = fmt.Sprintf("%s_%d%s", stem, time.Now().UnixMilli(), e)
	}
	dst := filepath.Join(dir, fname)
	if err := writeAtomic(dst, frame, 0644); err != nil {
		return "", err
	}
	// 来源落盘（含 token）：供 Studio 重启后续拉。权限 0600。
	if err := writeAtomicJSON(filepath.Join(dir, mediaStoreManifest), map[string]string{
		"url": src.URL, "token": src.Token, "base": src.Base, "job_id": src.JobID,
		"kind": kind, "mode": mode, "file": fname, "mime": mimeType,
	}); err != nil {
		return dst, nil // 产物已落盘，manifest 失败不致命
	}
	return dst, nil
}

// RegisterLocal 登记本地路径产物（已在磁盘、白名单内，不复制），只写 manifest。
func (m *MediaStore) RegisterLocal(execID int64, nodeID, kind, mode, name string, src MediaSource) (string, error) {
	if src.Path == "" {
		return "", fmt.Errorf("media source requires path")
	}
	dir := m.execNodeDir(execID, nodeID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	// local 产物的清单指向原路径（经媒体接口的白名单校验后再被访问）
	if err := writeAtomicJSON(filepath.Join(dir, mediaStoreManifest), map[string]string{
		"path": src.Path, "kind": kind, "mode": mode, "local": "1",
	}); err != nil {
		return "", err
	}
	return src.Path, nil
}

// Latest 返回某节点某 kind 的最新产物（绝对路径 + mime + 是否命中）。
// replace 式取同名文件；append 式取最近的一份；本地登记从 manifest 读回 path。
func (m *MediaStore) Latest(execID int64, nodeID, kind string) (string, string, bool) {
	dir := m.execNodeDir(execID, nodeID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", "", false
	}
	prefix := sanitizeNodeID(kind)
	var best string
	var bestTime time.Time
	for _, e := range entries {
		if e.IsDir() || e.Name() == mediaStoreManifest {
			continue
		}
		if !strings.HasPrefix(e.Name(), prefix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if best == "" || info.ModTime().After(bestTime) {
			best, bestTime = filepath.Join(dir, e.Name()), info.ModTime()
		}
	}
	if best == "" {
		return "", "", false
	}
	return best, mimeFromPath(best), true
}

// Index 列出某执行的全部媒体产物（GET /executions/:id/nodes 的 media 字段来源）。
func (m *MediaStore) Index(execID int64) []MediaItem {
	base := filepath.Join(m.root, "executions", fmt.Sprintf("%d", execID))
	nodeDirs, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	var items []MediaItem
	for _, nd := range nodeDirs {
		if !nd.IsDir() {
			continue
		}
		dir := filepath.Join(base, nd.Name())
		files, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || f.Name() == mediaStoreManifest {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			name := f.Name()
			kind := name
			if i := strings.Index(name, "."); i > 0 {
				kind = name[:i]
			}
			if j := strings.LastIndex(kind, "_"); j > 0 { // 去掉 append 序号后缀
				if _, err := fmt.Sscanf(kind[j+1:], "%d", new(int64)); err == nil {
					kind = kind[:j]
				}
			}
			items = append(items, MediaItem{
				NodeID: nd.Name(), Kind: kind, Name: name,
				Path: filepath.Join(dir, name), Size: info.Size(), UpdatedAt: info.ModTime(),
			})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	return items
}

// Cleanup 先删超 TTL 的执行目录（按目录内最新文件 mtime），再按 LRU 把总量降到 maxBytes。
func (m *MediaStore) Cleanup() {
	execRoot := filepath.Join(m.root, "executions")
	entries, err := os.ReadDir(execRoot)
	if err != nil {
		return
	}
	type dirInfo struct {
		path    string
		size    int64
		latest  time.Time
	}
	now := time.Now()
	var dirs []dirInfo
	var total int64
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p := filepath.Join(execRoot, e.Name())
		size, latest := dirStat(p)
		if now.Sub(latest) > m.ttl {
			_ = os.RemoveAll(p)
			continue
		}
		dirs = append(dirs, dirInfo{p, size, latest})
		total += size
	}
	if total <= m.maxBytes {
		return
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].latest.Before(dirs[j].latest) })
	for _, d := range dirs {
		if total <= m.maxBytes {
			break
		}
		_ = os.RemoveAll(d.path)
		total -= d.size
	}
}

// dirStat 递归统计目录总大小与最新 mtime。
func dirStat(root string) (int64, time.Time) {
	var size int64
	var latest time.Time
	_ = filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		size += info.Size()
		if info.ModTime().After(latest) {
			latest = info.ModTime()
		}
		return nil
	})
	return size, latest
}

// fetchMedia 拉取第三方媒体（超时/大小上限，媒体本体不经 metadata/日志）。
func fetchMedia(url, token string) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, "", fmt.Errorf("invalid media url: %w", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := (&http.Client{Timeout: mediaStoreFetchTimeout}).Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("fetch media: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("media source returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, mediaStoreMaxBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read media: %w", err)
	}
	if len(data) > mediaStoreMaxBytes {
		return nil, "", fmt.Errorf("media too large")
	}
	mt := resp.Header.Get("Content-Type")
	if mt == "" {
		mt = "image/jpeg"
	}
	return data, mt, nil
}

// writeAtomic 临时文件 + rename 原子写（前端永远读到完整文件）。
func writeAtomic(dst string, data []byte, perm os.FileMode) error {
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

func writeAtomicJSON(dst string, v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

// extFromMIME 推断扩展名（不含点）；未知回退 .jpg。
func extFromMIME(mt string) string {
	switch {
	case strings.Contains(mt, "png"):
		return ".png"
	case strings.Contains(mt, "webp"):
		return ".webp"
	case strings.Contains(mt, "gif"):
		return ".gif"
	case strings.Contains(mt, "mp4"):
		return ".mp4"
	case strings.Contains(mt, "webm"):
		return ".webm"
	case strings.Contains(mt, "jpeg"), strings.Contains(mt, "jpg"):
		return ".jpg"
	}
	return ".jpg"
}

func mimeFromPath(p string) string {
	if mt := mime.TypeByExtension(filepath.Ext(p)); mt != "" {
		return mt
	}
	return "image/jpeg"
}
