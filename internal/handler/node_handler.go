package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// NodeHandler 节点处理器
type NodeHandler struct {
	service       *service.NodeService
	importService *service.NodeImportService
}

// NewNodeHandler 创建节点处理器
func NewNodeHandler(svc *service.NodeService) *NodeHandler {
	return &NodeHandler{
		service:       svc,
		importService: service.NewNodeImportService(svc),
	}
}

// RegisterRoutes 注册路由
func (h *NodeHandler) RegisterRoutes(r *gin.RouterGroup) {
	nodes := r.Group("/nodes")
	{
		nodes.GET("", h.List)
		nodes.POST("", h.Create)
		nodes.POST("/import", h.Import)
		nodes.GET("/:id", h.Get)
		nodes.PUT("/:id", h.Update)
		nodes.DELETE("/:id", h.Delete)
		nodes.POST("/:id/mock", h.MockTest)
		nodes.GET("/:id/ui/*filepath", h.ServeUIFile)
	}
}

// List 获取节点列表
func (h *NodeHandler) List(c *gin.Context) {
	language := c.Query("language")
	tag := c.Query("tag")
	search := c.Query("search")
	nodeType := c.Query("node_type")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	resp, err := h.service.List(language, tag, search, nodeType, page, pageSize)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, resp)
}

// Get 获取节点详情
func (h *NodeHandler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	node, err := h.service.Get(id)
	if err != nil {
		if err.Error() == "node not found" {
			Error(c, http.StatusNotFound, err.Error())
			return
		}
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, node)
}

// Create 创建节点
func (h *NodeHandler) Create(c *gin.Context) {
	var req model.Node
	if !BindJSON(c, &req) {
		return
	}

	node, err := h.service.Create(&req)
	if err != nil {
		if err.Error() == "name is required" {
			Error(c, http.StatusBadRequest, err.Error())
			return
		}
		if err.Error() == "node name already exists" {
			Error(c, http.StatusConflict, err.Error())
			return
		}
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, node)
}

// Update 更新节点
func (h *NodeHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	var req model.Node
	if !BindJSON(c, &req) {
		return
	}

	if err := h.service.Update(id, &req); err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, gin.H{"id": id})
}

// Delete 删除节点
func (h *NodeHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	if err := h.service.Delete(id); err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, gin.H{"message": "node deleted"})
}

// ImportRequest 节点导入请求
type ImportRequest struct {
	SourceType string `json:"source_type"`
	SourceURL  string `json:"source_url"`
	SourcePath string `json:"source_path"`
}

// Import 导入节点（git / folder）
func (h *NodeHandler) Import(c *gin.Context) {
	var req ImportRequest
	if !BindJSON(c, &req) {
		return
	}

	sourceType := strings.ToLower(strings.TrimSpace(req.SourceType))
	var node *model.Node
	var err error

	switch sourceType {
	case "git":
		node, err = h.importService.ImportFromGit(req.SourceURL)
	case "folder":
		node, err = h.importService.ImportFromFolder(req.SourcePath)
	default:
		Error(c, http.StatusBadRequest, "source_type must be git or folder")
		return
	}

	if err != nil {
		if strings.Contains(err.Error(), "node name already exists") {
			Error(c, http.StatusConflict, err.Error())
			return
		}
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	Success(c, node)
}

// MockTestRequest Mock 测试请求
type MockTestRequest struct {
	Parameters map[string]string `json:"parameters"`
	Timeout    int               `json:"timeout"`
}

// MockTest Mock 测试节点
func (h *NodeHandler) MockTest(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	var req MockTestRequest
	if !BindJSON(c, &req) {
		return
	}

	result, err := h.service.MockTest(id, req.Parameters, req.Timeout)
	if err != nil {
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	Success(c, result)
}

// ServeUIFile 提供节点自定义 UI 组件 bundle（module 模式）。
// 只允许访问已入库（legacy Node.Files）或已入资产索引（FileAssets）的文件，
// 天然免疫路径穿越。带 ?v=<updatedAt> 查询时响应长缓存（内容随重新导入变化，
// URL 中的 v 随之更新），否则不缓存。
func (h *NodeHandler) ServeUIFile(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	rel := strings.TrimPrefix(c.Param("filepath"), "/")
	if rel == "" {
		Error(c, http.StatusNotFound, "ui file not found")
		return
	}

	node, err := h.service.Get(id)
	if err != nil {
		if err.Error() == "node not found" {
			Error(c, http.StatusNotFound, err.Error())
			return
		}
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	if c.Query("v") != "" {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		c.Header("Cache-Control", "no-cache")
	}

	// legacy：内容直接在 DB Files 里
	if content, ok := node.Files[rel]; ok && content != "" {
		c.Data(http.StatusOK, assets.ContentTypeByExt(rel), []byte(content))
		return
	}

	// P1：内容外置到资产目录，字节流 serving（二进制安全）
	if asset, ok := node.FileAssets[rel]; ok {
		store := h.service.Assets()
		if store == nil {
			Error(c, http.StatusInternalServerError, "asset store not configured")
			return
		}
		f, err := store.Open(node.Name, node.Version, rel)
		if err != nil {
			Error(c, http.StatusNotFound, "ui file not found")
			return
		}
		defer f.Close()
		if asset.SHA256 != "" {
			c.Header("ETag", `"`+asset.SHA256+`"`)
		}
		ct := asset.ContentType
		if ct == "" {
			ct = assets.ContentTypeByExt(rel)
		}
		c.DataFromReader(http.StatusOK, asset.Size, ct, f, nil)
		return
	}

	Error(c, http.StatusNotFound, "ui file not found")
}
