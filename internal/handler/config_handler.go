package handler

import (
	"net/http"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// ConfigHandler 配置处理器
type ConfigHandler struct {
	db    *db.DB
	audit *service.AuditService
}

// NewConfigHandler 创建配置处理器
func NewConfigHandler(database *db.DB) *ConfigHandler {
	return &ConfigHandler{db: database}
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
	var configs []model.SystemConfig
	if err := h.db.Select(&configs, "SELECT * FROM system_configs"); err != nil {
		Error(c, http.StatusInternalServerError, "failed to get system config")
		return
	}

	result := make(map[string]string)
	for _, cfg := range configs {
		result[cfg.Key] = cfg.Value
	}

	Success(c, result)
}

// UpdateSystemConfig 更新系统配置
func (h *ConfigHandler) UpdateSystemConfig(c *gin.Context) {
	var req map[string]string
	if !BindJSON(c, &req) {
		return
	}

	for key, value := range req {
		_, err := h.db.Exec(`
			INSERT INTO system_configs (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
		`, key, value)
		if err != nil {
			Error(c, http.StatusInternalServerError, "failed to update system config: "+err.Error())
			return
		}
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
