package handler

import (
	"net/http"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// ConfigHandler 配置处理器
type ConfigHandler struct {
	cfg   *service.SystemConfigService
	audit *service.AuditService
}

// NewConfigHandler 创建配置处理器
func NewConfigHandler(cfg *service.SystemConfigService) *ConfigHandler {
	return &ConfigHandler{cfg: cfg}
}

// SetAudit 注入审计服务（可选）
func (h *ConfigHandler) SetAudit(a *service.AuditService) {
	h.audit = a
}

// RegisterRoutes 注册路由
func (h *ConfigHandler) RegisterRoutes(r *gin.RouterGroup) {
	config := r.Group("/config")
	{
		config.GET("/system", h.GetSystemConfig)
		config.PUT("/system", h.UpdateSystemConfig)
	}
}

// GetSystemConfig 获取系统配置
func (h *ConfigHandler) GetSystemConfig(c *gin.Context) {
	result, err := h.cfg.All()
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, result)
}

// UpdateSystemConfig 更新系统配置
func (h *ConfigHandler) UpdateSystemConfig(c *gin.Context) {
	var req map[string]string
	if !BindJSON(c, &req) {
		return
	}

	if err := h.cfg.Set(req); err != nil {
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	if h.audit != nil {
		keys := make([]string, 0, len(req))
		for k := range req {
			keys = append(keys, k)
		}
		_ = h.audit.Record("update_config", "config", "", "keys="+strings.Join(keys, ","))
	}

	Success(c, gin.H{"message": "system config updated"})
}
