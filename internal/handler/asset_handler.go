package handler

import (
	"net/http"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/gin-gonic/gin"
)

// AssetHandler 节点资产 HTTP 服务（P3）：供 docker/k8s 等远程执行器
// 通过签名 URL 拉取节点文件。签名独立于 API 认证（URL 自带时效与 HMAC），
// 因此注册在认证中间件之外。
type AssetHandler struct {
	store *assets.Store
}

// NewAssetHandler 创建资产处理器
func NewAssetHandler(store *assets.Store) *AssetHandler {
	return &AssetHandler{store: store}
}

// RegisterRoutes 注册路由（无认证，签名 URL 自校验）
func (h *AssetHandler) RegisterRoutes(r *gin.Engine) {
	r.GET("/api/v1/assets/nodes/:nodeRef/*filepath", h.Serve)
}

// Serve 校验签名并流式返回资产文件
func (h *AssetHandler) Serve(c *gin.Context) {
	if h.store == nil {
		Error(c, http.StatusInternalServerError, "asset store not configured")
		return
	}

	// :nodeRef 形如 name@version（version 为空时由导入方存为 "0"）
	nodeRef := c.Param("nodeRef")
	name, version, found := strings.Cut(nodeRef, "@")
	if !found || name == "" {
		Error(c, http.StatusBadRequest, "invalid node ref, expect <name>@<version>")
		return
	}

	if !h.store.VerifySignedRequest(name, version, c.Query("expires"), c.Query("sig")) {
		Error(c, http.StatusForbidden, "invalid or expired asset URL signature")
		return
	}

	rel := strings.TrimPrefix(c.Param("filepath"), "/")
	if rel == "" {
		Error(c, http.StatusNotFound, "asset file not found")
		return
	}

	f, err := h.store.Open(name, version, rel)
	if err != nil {
		Error(c, http.StatusNotFound, "asset file not found")
		return
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		Error(c, http.StatusNotFound, "asset file not found")
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.DataFromReader(http.StatusOK, fi.Size(), assets.ContentTypeByExt(rel), f, nil)
}
