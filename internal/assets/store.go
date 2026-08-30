// Package assets 提供节点文件的外置资产存储（Node Asset Store）。
//
// 设计动机：节点包文件（尤其 UI bundle 与贴图等资源）直接存 DB 的 JSON/TEXT 字段
// 会导致二进制损坏（非法 UTF-8 被替换）、DB 膨胀、以及运行时被内联进 bash argv
// 触发 "argument list too long"。资产外置后：
//   - 文件内容落在 <data.dir>/assets/nodes/<name>@<version>/ 下，DB 只存索引
//     （model.NodeFileAsset：sha256/size/contentType/kind）
//   - 前端 UI serving 与运行时按需从磁盘读取，全程字节流，二进制安全
//   - 备份由 BackupService 以 tar.gz 形式打包整个 assets 目录
package assets

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
)

// Kind 资产类别
const (
	KindRuntime = "runtime" // 节点运行时依赖（展开器会物化到执行工作目录）
	KindUI      = "ui"      // 前端画布组件资源（仅供 HTTP serving，不进执行链路）
)

// FileData 待写入的资产文件
type FileData struct {
	Content []byte
	Kind    string // KindRuntime | KindUI
}

// Store 节点资产存储，根目录 <dataDir>/assets/nodes。
// HTTPBase/SignKey 用于为远程执行器生成签名拉取 URL（P3）。
type Store struct {
	Root     string
	HTTPBase string // 例：http://192.168.1.10:8080（需执行器网络可达）
	SignKey  []byte
}

// NewStore 创建资产存储。dataDir 为 flowx-studio 数据目录。
func NewStore(dataDir string) *Store {
	return &Store{Root: filepath.Join(dataDir, "assets", "nodes")}
}

var (
	nodeNamePattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]*$`)
	versionPattern  = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)
)

// validateRelPath 校验包内相对路径，禁止绝对路径与 .. 穿越
func validateRelPath(rel string) error {
	if rel == "" {
		return fmt.Errorf("empty path")
	}
	if filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") {
		return fmt.Errorf("absolute path not allowed: %s", rel)
	}
	clean := filepath.Clean(rel)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.HasPrefix(clean, "../") {
		return fmt.Errorf("path traversal not allowed: %s", rel)
	}
	return nil
}

// NodeDir 返回节点资产目录 <root>/<name>@<version>（version 为空时用 "0"）
func (s *Store) NodeDir(name, version string) (string, error) {
	if !nodeNamePattern.MatchString(name) {
		return "", fmt.Errorf("invalid node name: %s", name)
	}
	if version == "" {
		version = "0"
	}
	if !versionPattern.MatchString(version) {
		return "", fmt.Errorf("invalid node version: %s", version)
	}
	return filepath.Join(s.Root, name+"@"+version), nil
}

// Put 原子写入节点资产：先写临时目录再 rename，避免运行中的 pipeline 读到半截文件。
// 返回 path -> 资产索引。files 为空时只确保目录存在。
func (s *Store) Put(name, version string, files map[string]FileData) (map[string]model.NodeFileAsset, error) {
	dir, err := s.NodeDir(name, version)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(s.Root, 0755); err != nil {
		return nil, err
	}

	tmp := fmt.Sprintf("%s.tmp-%d", dir, os.Getpid())
	if err := os.RemoveAll(tmp); err != nil {
		return nil, err
	}

	index := make(map[string]model.NodeFileAsset, len(files))
	for rel, fd := range files {
		if err := validateRelPath(rel); err != nil {
			os.RemoveAll(tmp)
			return nil, err
		}
		kind := fd.Kind
		if kind == "" {
			kind = KindRuntime
		}
		dst := filepath.Join(tmp, rel)
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			os.RemoveAll(tmp)
			return nil, fmt.Errorf("failed to create dir for %s: %w", rel, err)
		}
		if err := os.WriteFile(dst, fd.Content, 0644); err != nil {
			os.RemoveAll(tmp)
			return nil, fmt.Errorf("failed to write asset %s: %w", rel, err)
		}
		sum := sha256.Sum256(fd.Content)
		index[rel] = model.NodeFileAsset{
			SHA256:      hex.EncodeToString(sum[:]),
			Size:        int64(len(fd.Content)),
			ContentType: ContentTypeByExt(rel),
			Kind:        kind,
		}
	}

	if len(files) > 0 {
		if err := os.RemoveAll(dir); err != nil {
			os.RemoveAll(tmp)
			return nil, err
		}
		// rename 原子生效，避免运行中的 pipeline 读到半截文件
		if err := os.Rename(tmp, dir); err != nil {
			os.RemoveAll(tmp)
			return nil, fmt.Errorf("failed to activate asset dir: %w", err)
		}
	} else {
		os.RemoveAll(tmp)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}
	return index, nil
}

// path 解析节点资产完整路径并校验
func (s *Store) path(name, version, rel string) (string, error) {
	if err := validateRelPath(rel); err != nil {
		return "", err
	}
	dir, err := s.NodeDir(name, version)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, rel), nil
}

// Open 打开资产文件（调用方负责 Close）
func (s *Store) Open(name, version, rel string) (*os.File, error) {
	p, err := s.path(name, version, rel)
	if err != nil {
		return nil, err
	}
	return os.Open(p)
}

// Read 读取资产文件全部内容
func (s *Store) Read(name, version, rel string) ([]byte, error) {
	p, err := s.path(name, version, rel)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(p)
}

// Remove 删除节点资产目录（不存在时不报错）
func (s *Store) Remove(name, version string) error {
	dir, err := s.NodeDir(name, version)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

// Empty 判断资产根目录为空或不存在
func (s *Store) Empty() bool {
	empty := true
	_ = filepath.Walk(s.Root, func(_ string, info os.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() {
			empty = false
			return io.EOF // 提前结束遍历
		}
		return nil
	})
	return empty
}

// ListDirs 返回资产根目录下的目录名列表（<name>@<version> 或遗留的 .tmp- 目录）
func (s *Store) ListDirs() ([]string, error) {
	entries, err := os.ReadDir(s.Root)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, e.Name())
		}
	}
	return dirs, nil
}

// RemoveDir 按目录名删除资产目录（GC 用；名称需已通过校验或为 tmp 遗留）
func (s *Store) RemoveDir(dirName string) error {
	if dirName == "" || strings.Contains(dirName, "/") || strings.Contains(dirName, "..") {
		return fmt.Errorf("invalid asset dir name: %s", dirName)
	}
	return os.RemoveAll(filepath.Join(s.Root, dirName))
}

// ContentTypeByExt 按扩展名推断 Content-Type（serving 用）
func ContentTypeByExt(rel string) string {
	switch strings.ToLower(filepath.Ext(rel)) {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	case ".map", ".json":
		return "application/json"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".wasm":
		return "application/wasm"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".py", ".sh", ".go", ".ts", ".txt", ".md", ".yaml", ".yml":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
