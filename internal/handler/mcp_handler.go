package handler

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/mcp"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/gin-gonic/gin"
)

// MCPHandler MCP 连接处理器
type MCPHandler struct {
	db      *db.DB
	manager *mcp.Manager
}

// NewMCPHandler 创建 MCP 处理器
func NewMCPHandler(database *db.DB, manager *mcp.Manager) *MCPHandler {
	return &MCPHandler{db: database, manager: manager}
}

// RegisterRoutes 注册路由
func (h *MCPHandler) RegisterRoutes(r *gin.RouterGroup) {
	mcp := r.Group("/mcp")
	{
		mcp.GET("/connections", h.ListConnections)
		mcp.POST("/:id/connect", h.Connect)
		mcp.POST("/:id/disconnect", h.Disconnect)
		mcp.GET("/:id/status", h.GetStatus)
		mcp.GET("/:id/tools", h.ListTools)
		mcp.POST("/:id/tools/:tool_name/call", h.CallTool)
	}
}

// ListConnections 获取所有 MCP 连接状态
func (h *MCPHandler) ListConnections(c *gin.Context) {
	// 从数据库获取所有配置
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
		cfg.AuthHeaderValue = "" // 脱敏
		configs = append(configs, cfg)
	}

	// 合并连接状态
	conns := h.manager.GetAllConnections()
	connMap := make(map[int64]*mcp.Connection)
	for _, conn := range conns {
		connMap[conn.ID] = conn
	}

	var results []gin.H
	for _, cfg := range configs {
		status := cfg.Status
		lastError := cfg.LastError
		
		if conn, ok := connMap[cfg.ID]; ok {
			status = conn.Status
			lastError = conn.LastError
		}
		
		results = append(results, gin.H{
			"id":         cfg.ID,
			"name":       cfg.Name,
			"mode":       cfg.Mode,
			"is_enabled": cfg.IsEnabled,
			"status":     status,
			"last_error": lastError,
			"tools_count": len(h.manager.GetTools(cfg.ID)),
		})
	}

	Success(c, results)
}

// Connect 建立 MCP 连接
func (h *MCPHandler) Connect(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	// 获取配置
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

	if !cfg.IsEnabled {
		Error(c, http.StatusBadRequest, "mcp config is disabled")
		return
	}

	// 建立连接
	if err := h.manager.Connect(cfg); err != nil {
		// 更新数据库状态
		h.db.Exec("UPDATE mcp_configs SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
			"error", err.Error(), id)
		
		Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to connect: %v", err))
		return
	}

	// 更新数据库状态
	h.db.Exec("UPDATE mcp_configs SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		"connected", "", id)

	Success(c, gin.H{
		"id":     id,
		"status": "connected",
		"message": "MCP connection established",
	})
}

// Disconnect 断开 MCP 连接
func (h *MCPHandler) Disconnect(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	if err := h.manager.Disconnect(id); err != nil {
		Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to disconnect: %v", err))
		return
	}

	// 更新数据库状态
	h.db.Exec("UPDATE mcp_configs SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		"disconnected", "", id)

	Success(c, gin.H{
		"id":     id,
		"status": "disconnected",
		"message": "MCP connection closed",
	})
}

// GetStatus 获取 MCP 连接状态
func (h *MCPHandler) GetStatus(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	conn := h.manager.GetConnection(id)
	if conn == nil {
		// 从数据库获取状态
		var status string
		h.db.Get(&status, "SELECT status FROM mcp_configs WHERE id = ?", id)
		
		Success(c, gin.H{
			"id":     id,
			"status": status,
			"connected": false,
		})
		return
	}

	Success(c, gin.H{
		"id":         id,
		"status":     conn.Status,
		"connected":  conn.Status == "connected",
		"last_error": conn.LastError,
		"tools_count": len(h.manager.GetTools(id)),
	})
}

// ListTools 获取 MCP 工具列表
func (h *MCPHandler) ListTools(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	tools := h.manager.GetTools(id)
	if tools == nil {
		Success(c, []Tool{})
		return
	}

	Success(c, tools)
}

// Tool 工具定义（用于响应）
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// CallToolRequest 工具调用请求
type CallToolRequest struct {
	Parameters map[string]interface{} `json:"parameters"`
}

// CallTool 调用 MCP 工具
func (h *MCPHandler) CallTool(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	toolName := c.Param("tool_name")
	if toolName == "" {
		Error(c, http.StatusBadRequest, "tool name is required")
		return
	}

	var req CallToolRequest
	if !BindJSON(c, &req) {
		return
	}

	result, err := h.manager.CallTool(id, toolName, req.Parameters)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to call tool: %v", err))
		return
	}

	Success(c, result)
}


