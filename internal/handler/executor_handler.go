package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// ExecutorHandler 执行器实例 API 处理器
type ExecutorHandler struct {
	service *service.ExecutorService
}

// NewExecutorHandler 创建执行器处理器
func NewExecutorHandler(svc *service.ExecutorService) *ExecutorHandler {
	return &ExecutorHandler{service: svc}
}

// RegisterRoutes 注册路由
func (h *ExecutorHandler) RegisterRoutes(r *gin.RouterGroup) {
	executors := r.Group("/executors")
	{
		executors.GET("", h.List)
		executors.POST("", h.Create)
		executors.GET("/:id", h.Get)
		executors.PUT("/:id", h.Update)
		executors.DELETE("/:id", h.Delete)
		executors.PUT("/:id/default", h.SetDefault)
	}
}

// executorError 按错误内容映射状态码（409 冲突 / 404 不存在 / 400 校验失败）
func executorError(c *gin.Context, err error) {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "not found"):
		Error(c, http.StatusNotFound, msg)
	case strings.Contains(msg, "already exists"), strings.Contains(msg, "only one local executor"),
		strings.Contains(msg, "cannot delete the default"):
		Error(c, http.StatusConflict, msg)
	default:
		Error(c, http.StatusBadRequest, msg)
	}
}

// List 列出全部执行器实例
func (h *ExecutorHandler) List(c *gin.Context) {
	items, err := h.service.List()
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, items)
}

// Get 获取执行器详情
func (h *ExecutorHandler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid executor id")
		return
	}
	e, err := h.service.GetByID(id)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if e == nil {
		Error(c, http.StatusNotFound, "executor not found")
		return
	}
	Success(c, e)
}

// Create 创建执行器实例（local 仅允许一个；k8s 拒绝）
func (h *ExecutorHandler) Create(c *gin.Context) {
	var req model.Executor
	if !BindJSON(c, &req) {
		return
	}
	if req.Name == "" || req.Type == "" {
		Error(c, http.StatusBadRequest, "name and type are required")
		return
	}
	if err := h.service.Create(&req); err != nil {
		executorError(c, err)
		return
	}
	Success(c, req)
}

// Update 更新执行器（名称与类型不可变更）
func (h *ExecutorHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid executor id")
		return
	}
	var req model.Executor
	if !BindJSON(c, &req) {
		return
	}
	if err := h.service.Update(id, &req); err != nil {
		executorError(c, err)
		return
	}
	Success(c, gin.H{"id": id})
}

// Delete 删除执行器（默认执行器禁止删除）
func (h *ExecutorHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid executor id")
		return
	}
	if err := h.service.Delete(id); err != nil {
		executorError(c, err)
		return
	}
	Success(c, gin.H{"message": "executor deleted"})
}

// SetDefault 设为全局默认执行器
func (h *ExecutorHandler) SetDefault(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid executor id")
		return
	}
	e, err := h.service.SetDefault(id)
	if err != nil {
		executorError(c, err)
		return
	}
	Success(c, e)
}
