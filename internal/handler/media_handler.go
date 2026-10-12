package handler

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// MediaHandler 本地多媒体文件服务：把白名单目录内的文件通过 HTTP 提供给前端，
// 供画布节点 widget 的 <video>/<img>/<audio> 直接播放/展示，替代 base64 内嵌。
//
// 仅对 local 执行器（或与 server 共享文件系统的场景）产出的文件有效；
// 远程 docker 执行器写出的文件不在本机，此端点无法覆盖。
type MediaHandler struct {
	roots     []string // 已解析符号链接的白名单根目录（绝对路径）
	uploadDir string   // 上传落点根目录（空 = 自动：flowx-input/uploads，见 targetDir）
}

// NewMediaHandler 创建媒体文件处理器；roots 为可读白名单目录（需已展开 ~），
// uploadDir 为上传落点根目录（空 = 自动选白名单里名为 flowx-input 的根下的 uploads/）。
// 上传**不限扩展名、不限大小**，只要落在 uploadDir 下即可。
// uploadDir 不在 roots 内时自动补进可读白名单——否则刚上传的文件自己都预览不了。
// 构造时对每个 root 做 Abs + EvalSymlinks；root 不存在时跳过（运行期该 root 下文件一律 403）。
func NewMediaHandler(roots []string, uploadDir string) *MediaHandler {
	h := &MediaHandler{}
	for _, r := range roots {
		abs, err := filepath.Abs(r)
		if err != nil {
			continue
		}
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			abs = real
		}
		h.roots = append(h.roots, abs)
	}
	if dir := strings.TrimSpace(uploadDir); dir != "" {
		abs, err := filepath.Abs(dir)
		if err == nil {
			dir = abs
		}
		h.uploadDir = dir
		if !h.allowed(dir) {
			h.roots = append(h.roots, dir)
		}
	}
	return h
}

// RegisterRoutes 注册路由（调用方负责挂在认证中间件之后）
func (h *MediaHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/media/file", h.Serve)
	r.GET("/media/roots", h.Roots)
	r.POST("/media/upload", h.Upload)
}

// Roots 返回当前生效的白名单目录（供前端/节点探测可用性）
func (h *MediaHandler) Roots(c *gin.Context) {
	Success(c, map[string]interface{}{"roots": h.roots})
}

// Serve 按 ?path=<绝对路径> 返回文件内容。路径必须落在某个白名单根目录内，
// 防路径穿越与符号链接逃逸。http.ServeContent 自带 Range 支持（视频拖动进度条）。
func (h *MediaHandler) Serve(c *gin.Context) {
	p := strings.TrimSpace(c.Query("path"))
	if p == "" {
		Error(c, http.StatusBadRequest, "missing query parameter: path")
		return
	}
	if strings.HasPrefix(p, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			p = filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(p, "~"), "/"))
		}
	}

	abs, err := filepath.Abs(p)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid path")
		return
	}
	// 解析符号链接后的真实路径再校验，防 root 内软链指到白名单外
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		Error(c, http.StatusNotFound, "file not found")
		return
	}
	if !h.allowed(real) {
		Error(c, http.StatusForbidden, "path is outside of allowed media roots")
		return
	}

	f, err := os.Open(real)
	if err != nil {
		Error(c, http.StatusNotFound, "file not found")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		Error(c, http.StatusNotFound, "file not found")
		return
	}

	c.Header("Cache-Control", "private, max-age=60")
	http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), f)
}

// allowed 判断真实路径是否落在某个白名单根目录内
func (h *MediaHandler) allowed(real string) bool {
	for _, root := range h.roots {
		rel, err := filepath.Rel(root, real)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// ---- 上传（加载类节点在画布上"选/拖文件"的落点）----

// Upload 接收浏览器上传的文件，落盘到上传目录（见 targetDir），返回到本机文件路径
// （可直接写进节点的 *_path 参数）。
//
// **不限扩展名、不限大小**（原先按图片/视频白名单 + 32/512MB 上限的把控已去掉）；
// 仍保留的两条安全措施：subdir 不得越出上传根目录、文件名一律消毒。
//
// 形态：multipart/form-data，字段名 file（一次一个）；subdir 走 query —— 便于
// 用 MultipartReader 单遍流式写盘（不落临时文件、大文件不占内存）。
//
// 落点：配置了 media.upload_dir 就用它（+ 可选 subdir）；未配置时自动选白名单里名为
// flowx-input 的根下的 uploads/（默认 ~/flowx-input/uploads），没有 flowx-input 就退到
// 第一个可写根。返回的 path 在 $HOME 下时缩写成 ~/...，与节点参数写法一致。
func (h *MediaHandler) Upload(c *gin.Context) {
	sub := strings.Trim(strings.TrimSpace(c.Query("subdir")), "/")
	if sub != "" && (sub == ".." || strings.Contains(sub, "..") ||
		strings.ContainsRune(sub, filepath.Separator)) {
		Error(c, http.StatusBadRequest, "invalid subdir")
		return
	}

	dir, err := h.targetDir(sub)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	reader, err := c.Request.MultipartReader()
	if err != nil {
		Error(c, http.StatusBadRequest, "expect multipart/form-data: "+err.Error())
		return
	}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			Error(c, http.StatusBadRequest, "read multipart: "+err.Error())
			return
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}

		name := SanitizeUploadName(part.FileName())
		ext := strings.ToLower(filepath.Ext(name))
		dst, err := uniqueUploadPath(dir, name)
		if err != nil {
			_ = part.Close()
			Error(c, http.StatusInternalServerError, "create target file: "+err.Error())
			return
		}
		size, err := writeFile(dst, part)
		_ = part.Close()
		if err != nil {
			_ = os.Remove(dst) // 清理半成品，不留垃圾
			Error(c, http.StatusInternalServerError, "write file: "+err.Error())
			return
		}

		path := ShortHomePath(dst)
		ct := mime.TypeByExtension(ext)
		if ct == "" {
			ct = "application/octet-stream"
		}
		Success(c, map[string]interface{}{
			"path":     path,
			"abs_path": dst,
			"name":     filepath.Base(dst),
			"size":     size,
			"mime":     ct,
			"kind":     kindOf(ct),
			"url":      "/api/v1/media/file?path=" + url.QueryEscape(path),
		})
		return
	}
	Error(c, http.StatusBadRequest, "missing multipart field: file")
}

// targetDir 解析本次上传的目标目录，必要时创建。
//
// 配置了 media.upload_dir 时以其为根（+ 可选 subdir）；未配置时沿用旧行为：
// 白名单里名为 flowx-input 的根下的 uploads/（素材进，语义正确），否则第一个可写的根。
func (h *MediaHandler) targetDir(sub string) (string, error) {
	if h.uploadDir != "" {
		dir := h.uploadDir
		if sub != "" {
			dir = filepath.Join(dir, sub)
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("create upload dir %s: %w", dir, err)
		}
		return dir, nil
	}
	if len(h.roots) == 0 {
		return "", fmt.Errorf("no media root configured (see media.roots)")
	}
	cands := make([]string, 0, len(h.roots))
	// 输入目录语义优先：上传物是"素材进"，不是"结果出"
	for _, r := range h.roots {
		if filepath.Base(r) == "flowx-input" {
			cands = append(cands, r)
		}
	}
	cands = append(cands, h.roots...)

	var lastErr error
	for _, root := range cands {
		dir := filepath.Join(root, "uploads")
		if sub != "" {
			dir = filepath.Join(dir, sub)
		}
		// 目标必须仍在白名单根内（sub 已过滤，这里再兜一层）
		if !h.allowed(dir) {
			continue
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			lastErr = err
			continue
		}
		return dir, nil
	}
	return "", fmt.Errorf("no writable media root for upload: %v", lastErr)
}

// SanitizeUploadName 消毒上传文件名：去目录成分、去控制字符，非白名单字符替换为
// 下划线，保留扩展名；空名兜底 uploaded。同名防覆盖由 uniqueUploadPath 负责。
func SanitizeUploadName(raw string) string {
	raw = strings.TrimSpace(raw)
	// 兼容部分客户端（含 Windows 路径）传来的完整路径
	raw = strings.ReplaceAll(raw, "\\", "/")
	raw = filepath.Base(raw)
	if raw == "." || raw == ".." || raw == "/" {
		raw = ""
	}
	keep := func(r rune) bool {
		return r == '.' || r == '-' || r == '_' ||
			(r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r > 127
	}
	var b strings.Builder
	for _, r := range raw {
		if keep(r) {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	name := strings.Trim(b.String(), "._")
	if name == "" {
		return "uploaded"
	}
	return name
}

// uniqueUploadPath 生成不覆盖已有文件的目标路径：<时间戳>_<名字>，
// 仍重名则加 -1/-2 后缀。
func uniqueUploadPath(dir, name string) (string, error) {
	stamp := time.Now().UTC().Format("20060102T150405Z")
	base := filepath.Base(name)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for i := 0; i < 100; i++ {
		suffix := ""
		if i > 0 {
			suffix = fmt.Sprintf("-%d", i)
		}
		cand := filepath.Join(dir, fmt.Sprintf("%s_%s%s%s", stamp, stem, suffix, ext))
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand, nil
		}
	}
	return "", fmt.Errorf("too many files with the same name under %s", dir)
}

// writeFile 把 r 单遍流式写入 path（不设大小上限，写多少算多少）。
// 调用方负责在出错时删除半成品。
func writeFile(path string, r io.Reader) (int64, error) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	n, err := io.Copy(f, r)
	if err != nil {
		return n, err
	}
	if err := f.Sync(); err != nil {
		return n, err
	}
	return n, nil
}

// kindOf 由 MIME 推导上传返回里的 kind 字段（纯提示性，不参与放行判定）。
func kindOf(mimeType string) string {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	}
	return "file"
}

// ShortHomePath 把 $HOME 下的绝对路径缩写成 ~/...（与节点参数现有写法一致）。
func ShortHomePath(abs string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return abs
	}
	rel, err := filepath.Rel(home, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return abs
	}
	return "~/" + filepath.ToSlash(rel)
}
