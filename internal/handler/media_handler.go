package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// MediaHandler 本地多媒体文件服务：把白名单目录内的文件通过 HTTP 提供给前端，
// 供画布节点 widget 的 <video>/<img>/<audio> 直接播放/展示，替代 base64 内嵌。
//
// 仅对 local 执行器（或与 server 共享文件系统的场景）产出的文件有效；
// 远程 docker 执行器写出的文件不在本机，此端点无法覆盖。
type MediaHandler struct {
	roots []string // 已解析符号链接的白名单根目录（绝对路径）
}

// NewMediaHandler 创建媒体文件处理器；roots 为白名单目录（需已展开 ~）。
// 构造时对每个 root 做 Abs + EvalSymlinks；root 不存在时跳过（运行期该 root 下文件一律 403）。
func NewMediaHandler(roots []string) *MediaHandler {
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
	return h
}

// RegisterRoutes 注册路由（调用方负责挂在认证中间件之后）
func (h *MediaHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/media/file", h.Serve)
	r.GET("/media/roots", h.Roots)
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
