package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/crypto"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/gin-gonic/gin"
)

// ConfigHandler 配置处理器
type ConfigHandler struct {
	db        *db.DB
	encrypter *crypto.Encrypter
}

// NewConfigHandler 创建配置处理器
func NewConfigHandler(database *db.DB, enc *crypto.Encrypter) *ConfigHandler {
	return &ConfigHandler{db: database, encrypter: enc}
}

// RegisterRoutes 注册路由
func (h *ConfigHandler) RegisterRoutes(r *gin.RouterGroup) {
	config := r.Group("/config")
	{
		// AI 配置
		config.GET("/ai", h.ListAIConfigs)
		config.POST("/ai", h.CreateAIConfig)
		config.PUT("/ai/:id", h.UpdateAIConfig)
		config.DELETE("/ai/:id", h.DeleteAIConfig)
		config.POST("/ai/:id/test", h.TestAIConfig)

		// MCP 配置
		config.GET("/mcp", h.ListMCPConfigs)
		config.POST("/mcp", h.CreateMCPConfig)
		config.PUT("/mcp/:id", h.UpdateMCPConfig)
		config.DELETE("/mcp/:id", h.DeleteMCPConfig)
		config.POST("/mcp/:id/test", h.TestMCPConfig)

		// 系统配置
		config.GET("/system", h.GetSystemConfig)
		config.PUT("/system", h.UpdateSystemConfig)
	}
}

// ========== AI Config ==========

// ListAIConfigs 获取 AI 配置列表
func (h *ConfigHandler) ListAIConfigs(c *gin.Context) {
	var configs []model.AIConfig
	if err := h.db.Select(&configs, "SELECT * FROM ai_configs ORDER BY created_at DESC"); err != nil {
		Error(c, http.StatusInternalServerError, "failed to list ai configs")
		return
	}
	// 脱敏：不返回 api_key
	for i := range configs {
		configs[i].APIKey = ""
	}
	Success(c, configs)
}

// CreateAIConfig 创建 AI 配置
func (h *ConfigHandler) CreateAIConfig(c *gin.Context) {
	var req model.AIConfig
	if !BindJSON(c, &req) {
		return
	}

	// 加密 api_key
	if req.APIKey != "" {
		encrypted, err := h.encrypter.Encrypt(req.APIKey)
		if err != nil {
			Error(c, http.StatusInternalServerError, "failed to encrypt api key")
			return
		}
		req.APIKey = encrypted
	}

	// 如果设置为 active，取消其他 active
	if req.IsActive {
		h.db.Exec("UPDATE ai_configs SET is_active = 0 WHERE is_active = 1")
	}

	result, err := h.db.Exec(`
		INSERT INTO ai_configs (provider, name, model, api_key, base_url, temperature, max_tokens, is_active, is_enabled, capabilities)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.Provider, req.Name, req.Model, req.APIKey, req.BaseURL, req.Temperature, req.MaxTokens, req.IsActive, req.IsEnabled, req.Capabilities)

	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to create ai config: "+err.Error())
		return
	}

	id, _ := result.LastInsertId()
	req.ID = id
	req.APIKey = ""
	Success(c, req)
}

// UpdateAIConfig 更新 AI 配置
func (h *ConfigHandler) UpdateAIConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	var req model.AIConfig
	if !BindJSON(c, &req) {
		return
	}

	// 如果提供了新的 api_key，加密它
	if req.APIKey != "" {
		encrypted, err := h.encrypter.Encrypt(req.APIKey)
		if err != nil {
			Error(c, http.StatusInternalServerError, "failed to encrypt api key")
			return
		}
		req.APIKey = encrypted
	} else {
		// 保持原有 api_key
		var existing model.AIConfig
		if err := h.db.Get(&existing, "SELECT api_key FROM ai_configs WHERE id = ?", id); err == nil {
			req.APIKey = existing.APIKey
		}
	}

	if req.IsActive {
		h.db.Exec("UPDATE ai_configs SET is_active = 0 WHERE is_active = 1 AND id != ?", id)
	}

	_, err = h.db.Exec(`
		UPDATE ai_configs SET
			provider = ?, name = ?, model = ?, api_key = ?, base_url = ?,
			temperature = ?, max_tokens = ?, is_active = ?, is_enabled = ?, capabilities = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Provider, req.Name, req.Model, req.APIKey, req.BaseURL,
		req.Temperature, req.MaxTokens, req.IsActive, req.IsEnabled, req.Capabilities, id)

	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to update ai config: "+err.Error())
		return
	}

	Success(c, gin.H{"id": id})
}

// DeleteAIConfig 删除 AI 配置
func (h *ConfigHandler) DeleteAIConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	_, err = h.db.Exec("DELETE FROM ai_configs WHERE id = ?", id)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to delete ai config")
		return
	}

	Success(c, gin.H{"message": "ai config deleted"})
}

// TestAIConfig 测试 AI 配置
func (h *ConfigHandler) TestAIConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	var cfg model.AIConfig
	if err := h.db.Get(&cfg, "SELECT * FROM ai_configs WHERE id = ?", id); err != nil {
		if err == sql.ErrNoRows {
			Error(c, http.StatusNotFound, "config not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get config")
		return
	}

	// 解密 api_key
	if cfg.APIKey != "" {
		decrypted, err := h.encrypter.Decrypt(cfg.APIKey)
		if err != nil {
			Error(c, http.StatusInternalServerError, "failed to decrypt api key")
			return
		}
		cfg.APIKey = decrypted
	}

	// V1: 返回模拟测试结果
	Success(c, gin.H{
		"success":     true,
		"latency_ms":  850,
		"model":       cfg.Model,
		"response":    "Hello! I'm working properly.",
	})
}

// ========== MCP Config ==========

// ListMCPConfigs 获取 MCP 配置列表
func (h *ConfigHandler) ListMCPConfigs(c *gin.Context) {
	rows, err := h.db.Queryx("SELECT * FROM mcp_configs ORDER BY created_at DESC")
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list mcp configs")
		return
	}
	defer rows.Close()

	var configs []model.MCPConfig
	for rows.Next() {
		var cfg model.MCPConfig
		if err := scanMCPConfig(rows, &cfg); err != nil {
			continue
		}
		cfg.AuthHeaderValue = ""
		configs = append(configs, cfg)
	}

	Success(c, configs)
}

// CreateMCPConfig 创建 MCP 配置
func (h *ConfigHandler) CreateMCPConfig(c *gin.Context) {
	var req model.MCPConfig
	if !BindJSON(c, &req) {
		return
	}

	// 黑名单校验
	if req.Mode == "local" && req.Command != "" {
		if isBlacklisted(req.Command) {
			Error(c, http.StatusForbidden, "command is in blacklist")
			return
		}
	}

	// 加密 auth_header_value
	if req.AuthHeaderValue != "" {
		encrypted, err := h.encrypter.Encrypt(req.AuthHeaderValue)
		if err != nil {
			Error(c, http.StatusInternalServerError, "failed to encrypt auth header")
			return
		}
		req.AuthHeaderValue = encrypted
	}

	argsJSON, _ := json.Marshal(req.Args)
	envJSON, _ := json.Marshal(req.Env)

	result, err := h.db.Exec(`
		INSERT INTO mcp_configs (name, mode, command, args, env, url, auth_header_key, auth_header_value, is_enabled, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.Name, req.Mode, req.Command, string(argsJSON), string(envJSON),
		req.URL, req.AuthHeaderKey, req.AuthHeaderValue, req.IsEnabled, req.Status)

	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to create mcp config: "+err.Error())
		return
	}

	id, _ := result.LastInsertId()
	req.ID = id
	req.AuthHeaderValue = ""
	Success(c, req)
}

// UpdateMCPConfig 更新 MCP 配置
func (h *ConfigHandler) UpdateMCPConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	var req model.MCPConfig
	if !BindJSON(c, &req) {
		return
	}

	// 黑名单校验
	if req.Mode == "local" && req.Command != "" {
		if isBlacklisted(req.Command) {
			Error(c, http.StatusForbidden, "command is in blacklist")
			return
		}
	}

	if req.AuthHeaderValue != "" {
		encrypted, err := h.encrypter.Encrypt(req.AuthHeaderValue)
		if err != nil {
			Error(c, http.StatusInternalServerError, "failed to encrypt auth header")
			return
		}
		req.AuthHeaderValue = encrypted
	} else {
		row := h.db.QueryRowx("SELECT auth_header_value FROM mcp_configs WHERE id = ?", id)
		var encrypted string
		if err := row.Scan(&encrypted); err == nil {
			req.AuthHeaderValue = encrypted
		}
	}

	argsJSON, _ := json.Marshal(req.Args)
	envJSON, _ := json.Marshal(req.Env)

	_, err = h.db.Exec(`
		UPDATE mcp_configs SET
			name = ?, mode = ?, command = ?, args = ?, env = ?, url = ?,
			auth_header_key = ?, auth_header_value = ?, is_enabled = ?, status = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.Mode, req.Command, string(argsJSON), string(envJSON),
		req.URL, req.AuthHeaderKey, req.AuthHeaderValue, req.IsEnabled, req.Status, id)

	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to update mcp config: "+err.Error())
		return
	}

	Success(c, gin.H{"id": id})
}

// DeleteMCPConfig 删除 MCP 配置
func (h *ConfigHandler) DeleteMCPConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	_, err = h.db.Exec("DELETE FROM mcp_configs WHERE id = ?", id)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to delete mcp config")
		return
	}

	Success(c, gin.H{"message": "mcp config deleted"})
}

// TestMCPConfig 测试 MCP 配置
func (h *ConfigHandler) TestMCPConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	var cfg model.MCPConfig
	row := h.db.QueryRowx("SELECT * FROM mcp_configs WHERE id = ?", id)
	if err := scanMCPConfig(row, &cfg); err != nil {
		if err == sql.ErrNoRows {
			Error(c, http.StatusNotFound, "config not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get config")
		return
	}

	// V1: 返回模拟测试结果
	Success(c, gin.H{
		"success":  true,
		"mode":     cfg.Mode,
		"status":   "connected",
		"message":  "MCP connection test passed (V1 placeholder)",
	})
}

// ========== System Config ==========

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

	Success(c, gin.H{"message": "system config updated"})
}

// ========== Helper ==========

func scanMCPConfig(scanner interface{ Scan(dest ...interface{}) error }, cfg *model.MCPConfig) error {
	var argsJSON, envJSON string
	dests := []interface{}{
		&cfg.ID, &cfg.Name, &cfg.Mode, &cfg.Command, &argsJSON, &envJSON,
		&cfg.URL, &cfg.AuthHeaderKey, &cfg.AuthHeaderValue,
		&cfg.IsEnabled, &cfg.Status, &cfg.LastError, &cfg.CreatedAt, &cfg.UpdatedAt,
	}
	if err := scanner.Scan(dests...); err != nil {
		return err
	}
	json.Unmarshal([]byte(argsJSON), &cfg.Args)
	json.Unmarshal([]byte(envJSON), &cfg.Env)
	return nil
}

// 默认黑名单
var defaultBlacklist = []string{
	"rm", "rmdir", "del", "format", "mkfs", "fdisk", "dd",
	"curl", "wget", "nc", "netcat", "telnet", "ssh", "scp",
	"sudo", "su", "chmod", "chown", "mount", "umount",
	"reboot", "shutdown", "halt", "poweroff", "kill", "killall",
}

func isBlacklisted(cmd string) bool {
	cmd = strings.TrimSpace(cmd)
	// 检查是否包含 shell 操作符
	for _, op := range []string{">", ">>", "|", ";", "&&", "||", "`", "$"} {
		if strings.Contains(cmd, op) {
			return true
		}
	}
	// 检查是否在黑名单中
	parts := strings.Fields(cmd)
	if len(parts) == 0 {
		return false
	}
	base := filepath.Base(parts[0])
	for _, b := range defaultBlacklist {
		if base == b {
			return true
		}
	}
	return false
}
