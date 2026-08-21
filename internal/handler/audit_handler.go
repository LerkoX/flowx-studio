package handler

import (
	"net/http"
	"strconv"

	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// AuditHandler 审计日志处理器
type AuditHandler struct {
	service *service.AuditService
}

// NewAuditHandler 创建审计日志处理器
func NewAuditHandler(svc *service.AuditService) *AuditHandler {
	return &AuditHandler{service: svc}
}

// RegisterRoutes 注册路由
func (h *AuditHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/audit-logs", h.List)
}

// List 分页查询审计日志
func (h *AuditHandler) List(c *gin.Context) {
	action := c.Query("action")
	resourceType := c.Query("resource_type")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	resp, err := h.service.List(action, resourceType, page, pageSize)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, resp)
}
