package handler

import (
	"net/http"
	"strconv"
	"strings"

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
