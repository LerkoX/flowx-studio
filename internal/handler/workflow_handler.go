package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// WorkflowHandler 工作流处理器
type WorkflowHandler struct {
	service *service.WorkflowService
}

// NewWorkflowHandler 创建工作流处理器
func NewWorkflowHandler(svc *service.WorkflowService) *WorkflowHandler {
	return &WorkflowHandler{service: svc}
}

// RegisterRoutes 注册路由
func (h *WorkflowHandler) RegisterRoutes(r *gin.RouterGroup) {
	workflows := r.Group("/workflows")
	{
		workflows.GET("", h.List)
		workflows.POST("", h.Create)
		workflows.GET("/:id", h.Get)
		workflows.PUT("/:id", h.Update)
		workflows.DELETE("/:id", h.Delete)
		workflows.POST("/:id/run", h.Run)
		workflows.POST("/:id/mock", h.MockRun)
	}

	executions := r.Group("/executions")
	{
		executions.GET("", h.ListExecutions)
		executions.GET("/:id", h.GetExecution)
		executions.GET("/:id/stream", h.StreamExecution)
		executions.GET("/:id/logs", h.GetExecutionLogs)
		executions.GET("/:id/logs/export", h.ExportExecutionLogs)
		executions.GET("/:id/nodes", h.GetExecutionNodes)
		executions.POST("/:id/continue", h.ContinueExecution)
	}
}

// List 获取工作流列表
func (h *WorkflowHandler) List(c *gin.Context) {
	status := c.Query("status")
	search := c.Query("search")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	resp, err := h.service.List(status, search, page, pageSize)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, resp)
}

// Get 获取工作流详情
func (h *WorkflowHandler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid workflow id")
		return
	}

	wf, err := h.service.Get(id)
	if err != nil {
		if err.Error() == "workflow not found" {
			Error(c, http.StatusNotFound, err.Error())
			return
		}
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, wf)
}

// Create 创建工作流
func (h *WorkflowHandler) Create(c *gin.Context) {
	var req model.Workflow
	if !BindJSON(c, &req) {
		return
	}

	if req.Name == "" || req.YAMLConfig == "" {
		Error(c, http.StatusBadRequest, "name and yaml_config are required")
		return
	}

	wf, err := h.service.Create(&req)
	if err != nil {
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	Success(c, wf)
}

// Update 更新工作流
func (h *WorkflowHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid workflow id")
		return
	}

	var req model.Workflow
	if !BindJSON(c, &req) {
		return
	}

	if err := h.service.Update(id, &req); err != nil {
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	Success(c, gin.H{"id": id})
}

// Delete 删除工作流
func (h *WorkflowHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid workflow id")
		return
	}

	if err := h.service.Delete(id); err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, gin.H{"message": "workflow deleted"})
}

// Run 执行工作流
func (h *WorkflowHandler) Run(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid workflow id")
		return
	}

	execID, streamURL, err := h.service.Run(id, nil, false)
	if err != nil {
		if err.Error() == "workflow not found" {
			Error(c, http.StatusNotFound, err.Error())
			return
		}
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	Success(c, gin.H{
		"executionId": execID,
		"status":      "running",
		"streamUrl":   streamURL,
	})
}

// MockRun 工作流 Mock 执行（校验 + nodeRef 展开，不真实运行）
func (h *WorkflowHandler) MockRun(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid workflow id")
		return
	}

	result, err := h.service.MockRun(id)
	if err != nil {
		if err.Error() == "workflow not found" {
			Error(c, http.StatusNotFound, err.Error())
			return
		}
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	Success(c, result)
}

// ListExecutions 获取执行历史
func (h *WorkflowHandler) ListExecutions(c *gin.Context) {
	workflowID, _ := strconv.ParseInt(c.Query("workflow_id"), 10, 64)
	status := c.Query("status")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	resp, err := h.service.ListExecutions(workflowID, status, page, pageSize)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, resp)
}

// GetExecution 获取执行详情
func (h *WorkflowHandler) GetExecution(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid execution id")
		return
	}

	exec, err := h.service.GetExecution(id)
	if err != nil {
		if err.Error() == "execution not found" {
			Error(c, http.StatusNotFound, err.Error())
			return
		}
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, exec)
}

// ContinueExecution 继续运行已结束的执行实例
// POST /executions/:id/continue，body 可选 {"yaml": "..."}：
// 提供 yaml 时先更新执行实例的图（追加/修改未运行节点），随后增量续跑。
func (h *WorkflowHandler) ContinueExecution(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid execution id")
		return
	}

	var req struct {
		YAML string `json:"yaml"`
	}
	if c.Request.Body != nil {
		_ = c.ShouldBindJSON(&req) // 空 body 视为不提供 yaml
	}

	if err := h.service.ContinueExecution(id, req.YAML); err != nil {
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	Success(c, gin.H{"executionId": id, "status": "running"})
}

// GetExecutionLogs 获取执行日志
func (h *WorkflowHandler) GetExecutionLogs(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid execution id")
		return
	}

	nodeID := c.Query("node_id")
	level := c.Query("level")
	search := c.Query("search")
	order := c.Query("order")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	result, err := h.service.GetExecutionLogs(id, nodeID, level, search, order, limit, offset)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, result)
}

// GetExecutionNodes 获取执行节点状态
func (h *WorkflowHandler) GetExecutionNodes(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid execution id")
		return
	}

	nodes, err := h.service.GetExecutionNodes(id)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	Success(c, nodes)
}

// ExportExecutionLogs 导出执行日志（GET /executions/:id/logs/export?format=json|txt|markdown）
func (h *WorkflowHandler) ExportExecutionLogs(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid execution id")
		return
	}

	format := c.DefaultQuery("format", "json")
	logs, err := h.service.GetAllExecutionLogs(id)
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	filename := fmt.Sprintf("execution-%d-logs", id)
	switch format {
	case "json":
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.json", filename))
		c.JSON(http.StatusOK, gin.H{"executionId": id, "logs": logs})
	case "txt":
		var sb strings.Builder
		for _, l := range logs {
			sb.WriteString(formatLogLine(l))
		}
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.txt", filename))
		c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(sb.String()))
	case "markdown":
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("# Execution %d Logs\n\n", id))
		sb.WriteString("| Time | Level | Node | Message |\n|---|---|---|---|\n")
		for _, l := range logs {
			node := ""
			if l.NodeName != nil {
				node = *l.NodeName
			}
			msg := strings.ReplaceAll(l.Message, "|", "\\|")
			sb.WriteString(fmt.Sprintf("| %s | %s | %s | %s |\n",
				l.Timestamp.Format(time.RFC3339), l.Level, node, msg))
		}
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.md", filename))
		c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(sb.String()))
	default:
		Error(c, http.StatusBadRequest, "format must be json, txt or markdown")
	}
}

// formatLogLine 格式化单行日志（txt 导出用）
func formatLogLine(l model.ExecutionLog) string {
	node := ""
	if l.NodeName != nil {
		node = *l.NodeName
	}
	return fmt.Sprintf("%s [%s] [%s] %s\n", l.Timestamp.Format(time.RFC3339), l.Level, node, l.Message)
}

// StreamExecution SSE 实时日志流
func (h *WorkflowHandler) StreamExecution(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid execution id")
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

	// 订阅全局事件总线，筛选 execution 事件
	events := h.service.SubscribeEvents()
	defer h.service.UnsubscribeEvents(events)

	// 回放内存环形缓冲区中的近期日志（支持断线重连，事件流为 at-least-once，
	// 重连可能收到少量重复日志，前端按时间戳去重即可）
	for _, data := range h.service.RecentExecutionLogs(id) {
		payload, _ := json.Marshal(data)
		c.Writer.Write([]byte("event: execution.log\ndata: "))
		c.Writer.Write(payload)
		c.Writer.Write([]byte("\n\n"))
	}
	flusher.Flush()

	for {
		select {
		case evt := <-events:
			data, ok := evt.Data.(map[string]interface{})
			if !ok {
				continue
			}
			execID, ok := data["execution_id"].(int64)
			if !ok {
				continue
			}
			if execID != id {
				continue
			}
			payload, _ := json.Marshal(data)
			c.Writer.Write([]byte("event: "))
			c.Writer.Write([]byte(evt.Type))
			c.Writer.Write([]byte("\ndata: "))
			c.Writer.Write(payload)
			c.Writer.Write([]byte("\n\n"))
			flusher.Flush()

			if evt.Type == "execution.completed" {
				return
			}

		case <-c.Request.Context().Done():
			return

		case <-time.After(30 * time.Second):
			c.Writer.Write([]byte("event: ping\ndata: {}\n\n"))
			flusher.Flush()
		}
	}
}
