package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/ai"
	"github.com/LerkoX/flowx-studio/internal/crypto"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/gin-gonic/gin"
)

// AIHandler AI 处理器
type AIHandler struct {
	db        *db.DB
	encrypter *crypto.Encrypter
	service   *ai.Service
}

// NewAIHandler 创建 AI 处理器
func NewAIHandler(database *db.DB, enc *crypto.Encrypter) *AIHandler {
	h := &AIHandler{
		db:        database,
		encrypter: enc,
	}
	// 初始化 AI 服务，传入获取配置的函数
	h.service = ai.NewService(func() (string, string, string, string, error) {
		return h.getActiveAIConfigForService()
	})
	return h
}

// getActiveAIConfigForService 获取活跃 AI 配置（供 service 使用）
func (h *AIHandler) getActiveAIConfigForService() (provider, apiKey, baseURL, model string, err error) {
	var cfg struct {
		Provider  string `db:"provider"`
		APIKey    string `db:"api_key"`
		BaseURL   string `db:"base_url"`
		Model     string `db:"model"`
	}
	if err := h.db.Get(&cfg, "SELECT * FROM ai_configs WHERE is_active = 1 AND is_enabled = 1 LIMIT 1"); err != nil {
		if err == sql.ErrNoRows {
			if err := h.db.Get(&cfg, "SELECT * FROM ai_configs WHERE is_enabled = 1 LIMIT 1"); err != nil {
				return "", "", "", "", fmt.Errorf("no active AI config found")
			}
		} else {
			return "", "", "", "", err
		}
	}

	// 解密 api_key
	if cfg.APIKey != "" {
		decrypted, err := h.encrypter.Decrypt(cfg.APIKey)
		if err != nil {
			return "", "", "", "", fmt.Errorf("failed to decrypt api key: %w", err)
		}
		cfg.APIKey = decrypted
	}

	return cfg.Provider, cfg.APIKey, cfg.BaseURL, cfg.Model, nil
}

// RegisterRoutes 注册路由
func (h *AIHandler) RegisterRoutes(r *gin.RouterGroup) {
	ai := r.Group("/ai")
	{
		ai.POST("/chat", h.Chat)
		ai.GET("/chat/:session_id/history", h.ChatHistory)
		ai.POST("/generate-node", h.GenerateNode)
		ai.POST("/generate-workflow", h.GenerateWorkflow)
	}
}

// ChatRequest 对话请求
type ChatRequest struct {
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
	Context   struct {
		CurrentPage        string `json:"current_page"`
		SelectedNodeID     *int64 `json:"selected_node_id"`
		SelectedWorkflowID *int64 `json:"selected_workflow_id"`
	} `json:"context"`
}

// Chat AI 对话（SSE 流式）
func (h *AIHandler) Chat(c *gin.Context) {
	var req ChatRequest
	if !BindJSON(c, &req) {
		return
	}

	if req.SessionID == "" {
		req.SessionID = fmt.Sprintf("sess_%d", time.Now().UnixNano())
	}

	// 保存用户消息
	_, _ = h.db.Exec(`
		INSERT INTO chat_history (session_id, role, content, context_type)
		VALUES (?, ?, ?, ?)
	`, req.SessionID, "user", req.Message, "general")

	// 获取历史消息
	var history []model.ChatMessage
	h.db.Select(&history,
		"SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC LIMIT 20",
		req.SessionID,
	)

	// 构建消息列表
	messages := []ai.Message{
		{Role: "system", Content: "你是 FlowX AI 助手，一个帮助用户创建和管理工作流的智能助手。你可以理解用户的自动化需求，生成可复用的工作流节点，编排复杂的工作流，诊断和修复工作流错误。"},
	}
	for _, m := range history {
		messages = append(messages, ai.Message{Role: m.Role, Content: m.Content})
	}
	// 确保最后一条是用户消息
	if len(history) == 0 || history[len(history)-1].Role != "user" {
		messages = append(messages, ai.Message{Role: "user", Content: req.Message})
	}

	// SSE 响应
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Error(c, http.StatusInternalServerError, "streaming not supported")
		return
	}

	ctx := c.Request.Context()
	var fullResponse strings.Builder

	// 调用真实 AI 服务
	err := ai.RetryWithBackoff(2, func() error {
		return h.service.ChatStream(ctx, messages, func(chunk ai.ChatChunk) {
			if chunk.Error != nil {
				data, _ := json.Marshal(gin.H{"error": chunk.Error.Error()})
				fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", string(data))
				flusher.Flush()
				return
			}
			if chunk.Done {
				data, _ := json.Marshal(gin.H{"done": true})
				fmt.Fprintf(c.Writer, "event: done\ndata: %s\n\n", string(data))
				flusher.Flush()
				return
			}
			if chunk.Content != "" {
				fullResponse.WriteString(chunk.Content)
				data, _ := json.Marshal(gin.H{
					"role":    "assistant",
					"content": chunk.Content,
				})
				fmt.Fprintf(c.Writer, "event: message\ndata: %s\n\n", string(data))
				flusher.Flush()
			}
		})
	})

	if err != nil {
		data, _ := json.Marshal(gin.H{"error": err.Error()})
		fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", string(data))
		flusher.Flush()
		return
	}

	// 保存助手消息
	if fullResponse.Len() > 0 {
		_, _ = h.db.Exec(`
			INSERT INTO chat_history (session_id, role, content, context_type)
			VALUES (?, ?, ?, ?)
		`, req.SessionID, "assistant", fullResponse.String(), "general")
	}
}

// ChatHistory 获取对话历史
func (h *AIHandler) ChatHistory(c *gin.Context) {
	sessionID := c.Param("session_id")

	var messages []model.ChatMessage
	if err := h.db.Select(&messages,
		"SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC",
		sessionID,
	); err != nil {
		Error(c, http.StatusInternalServerError, "failed to get chat history")
		return
	}

	Success(c, messages)
}

// GenerateNode AI 生成节点（SSE 流式）
func (h *AIHandler) GenerateNode(c *gin.Context) {
	var req struct {
		Description   string `json:"description"`
		Language      string `json:"language"`
		PreferredName string `json:"preferred_name"`
	}
	if !BindJSON(c, &req) {
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Error(c, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 获取已有节点名称作为上下文
	var existingNodes []string
	h.db.Select(&existingNodes,
		"SELECT name FROM nodes ORDER BY created_at DESC LIMIT 20",
	)

	prompt := h.service.GenerateNodePrompt(req.Description, req.Language, req.PreferredName, existingNodes)

	messages := []ai.Message{
		{Role: "system", Content: "你是一个 FlowX 节点开发专家。"},
		{Role: "user", Content: prompt},
	}

	ctx := c.Request.Context()
	var fullResponse strings.Builder

	// 发送开始事件
	data, _ := json.Marshal(gin.H{"stage": "generating", "message": "正在生成节点..."})
	fmt.Fprintf(c.Writer, "event: generating\ndata: %s\n\n", string(data))
	flusher.Flush()

	err := h.service.ChatStream(ctx, messages, func(chunk ai.ChatChunk) {
		if chunk.Error != nil {
			data, _ := json.Marshal(gin.H{"error": chunk.Error.Error()})
			fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", string(data))
			flusher.Flush()
			return
		}
		if chunk.Done {
			return
		}
		if chunk.Content != "" {
			fullResponse.WriteString(chunk.Content)
			data, _ := json.Marshal(gin.H{"stage": "generating", "content": chunk.Content})
			fmt.Fprintf(c.Writer, "event: generating\ndata: %s\n\n", string(data))
			flusher.Flush()
		}
	})

	if err != nil {
		data, _ := json.Marshal(gin.H{"error": err.Error()})
		fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", string(data))
		flusher.Flush()
		return
	}

	// 尝试解析 JSON 响应
	var nodeData map[string]interface{}
	if err := json.Unmarshal([]byte(fullResponse.String()), &nodeData); err != nil {
		// 解析失败，返回原始文本
		data, _ := json.Marshal(gin.H{
			"node_id": 0,
			"name":    req.PreferredName,
			"status":  "generated",
			"raw":     fullResponse.String(),
		})
		fmt.Fprintf(c.Writer, "event: complete\ndata: %s\n\n", string(data))
		flusher.Flush()
		return
	}

	data, _ = json.Marshal(gin.H{
		"node_id": 0,
		"name":    req.PreferredName,
		"status":  "generated",
		"data":    nodeData,
	})
	fmt.Fprintf(c.Writer, "event: complete\ndata: %s\n\n", string(data))
	flusher.Flush()
}

// GenerateWorkflow AI 生成工作流（SSE 流式）
func (h *AIHandler) GenerateWorkflow(c *gin.Context) {
	var req struct {
		Description string `json:"description"`
	}
	if !BindJSON(c, &req) {
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Error(c, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 获取已有节点
	var availableNodes []string
	h.db.Select(&availableNodes,
		"SELECT name || ': ' || COALESCE(description, '') FROM nodes ORDER BY created_at DESC LIMIT 20",
	)

	prompt := h.service.GenerateWorkflowPrompt(req.Description, availableNodes)

	messages := []ai.Message{
		{Role: "system", Content: "你是一个工作流编排专家。"},
		{Role: "user", Content: prompt},
	}

	ctx := c.Request.Context()
	var fullResponse strings.Builder

	data, _ := json.Marshal(gin.H{"stage": "analyzing", "message": "正在分析需求..."})
	fmt.Fprintf(c.Writer, "event: analyzing\ndata: %s\n\n", string(data))
	flusher.Flush()

	err := h.service.ChatStream(ctx, messages, func(chunk ai.ChatChunk) {
		if chunk.Error != nil {
			data, _ := json.Marshal(gin.H{"error": chunk.Error.Error()})
			fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", string(data))
			flusher.Flush()
			return
		}
		if chunk.Done {
			return
		}
		if chunk.Content != "" {
			fullResponse.WriteString(chunk.Content)
			data, _ := json.Marshal(gin.H{"stage": "generating", "content": chunk.Content})
			fmt.Fprintf(c.Writer, "event: generating\ndata: %s\n\n", string(data))
			flusher.Flush()
		}
	})

	if err != nil {
		data, _ := json.Marshal(gin.H{"error": err.Error()})
		fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", string(data))
		flusher.Flush()
		return
	}

	data, _ = json.Marshal(gin.H{
		"workflow_id": 0,
		"name":        "generated_workflow",
		"node_count":  3,
		"yaml":        fullResponse.String(),
	})
	fmt.Fprintf(c.Writer, "event: complete\ndata: %s\n\n", string(data))
	flusher.Flush()
}
