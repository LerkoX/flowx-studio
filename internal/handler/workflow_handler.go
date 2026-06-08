package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/runtime"
	"github.com/gin-gonic/gin"
)

// WorkflowHandler 工作流处理器
type WorkflowHandler struct {
	db      *db.DB
	runtime *runtime.Adapter
}

// NewWorkflowHandler 创建工作流处理器
func NewWorkflowHandler(database *db.DB, rt *runtime.Adapter) *WorkflowHandler {
	return &WorkflowHandler{db: database, runtime: rt}
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
	}

	executions := r.Group("/executions")
	{
		executions.GET("", h.ListExecutions)
		executions.GET("/:id", h.GetExecution)
		executions.GET("/:id/stream", h.StreamExecution)
		executions.GET("/:id/logs", h.GetExecutionLogs)
	}
}

// List 获取工作流列表
func (h *WorkflowHandler) List(c *gin.Context) {
	status := c.Query("status")
	search := c.Query("search")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var conditions []string
	var args []interface{}

	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}
	if search != "" {
		conditions = append(conditions, "(name LIKE ? OR description LIKE ?)")
		args = append(args, "%"+search+"%", "%"+search+"%")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	h.db.Get(&total, "SELECT COUNT(*) FROM workflows "+whereClause, args...)

	query := "SELECT * FROM workflows " + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	var workflows []model.Workflow
	if err := h.db.Select(&workflows, query, args...); err != nil {
		Error(c, http.StatusInternalServerError, "failed to list workflows")
		return
	}

	Success(c, model.PaginatedResponse{
		Items:    workflows,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// Get 获取工作流详情
func (h *WorkflowHandler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid workflow id")
		return
	}

	var workflow model.Workflow
	if err := h.db.Get(&workflow, "SELECT * FROM workflows WHERE id = ?", id); err != nil {
		if err == sql.ErrNoRows {
			Error(c, http.StatusNotFound, "workflow not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get workflow")
		return
	}

	Success(c, workflow)
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

	result, err := h.db.Exec(`
		INSERT INTO workflows (name, description, intent, yaml_config, status)
		VALUES (?, ?, ?, ?, ?)
	`, req.Name, req.Description, req.Intent, req.YAMLConfig, req.Status)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to create workflow: "+err.Error())
		return
	}

	id, _ := result.LastInsertId()
	req.ID = id
	Success(c, req)
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

	_, err = h.db.Exec(`
		UPDATE workflows SET
			name = ?, description = ?, intent = ?, yaml_config = ?, status = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.Description, req.Intent, req.YAMLConfig, req.Status, id)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to update workflow")
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

	_, err = h.db.Exec("DELETE FROM workflows WHERE id = ?", id)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to delete workflow")
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

	var workflow model.Workflow
	if err := h.db.Get(&workflow, "SELECT * FROM workflows WHERE id = ?", id); err != nil {
		if err == sql.ErrNoRows {
			Error(c, http.StatusNotFound, "workflow not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get workflow")
		return
	}

	// 创建执行记录
	result, err := h.db.Exec(`
		INSERT INTO executions (workflow_id, status, trigger, started_at)
		VALUES (?, ?, ?, ?)
	`, id, "running", "manual", time.Now())
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to create execution")
		return
	}

	execID, _ := result.LastInsertId()

	// 使用 FlowX Runtime 执行
	go h.runWorkflow(execID, workflow)

	Success(c, gin.H{
		"executionId": execID,
		"status":      "running",
		"streamUrl":   fmt.Sprintf("/api/v1/executions/%d/stream", execID),
	})
}

func (h *WorkflowHandler) runWorkflow(execID int64, workflow model.Workflow) {
	ctx := context.Background()

	// 更新执行状态为运行中
	h.db.Exec("UPDATE executions SET status = ?, started_at = ? WHERE id = ?",
		"running", time.Now(), execID)

	// 调用 FlowX Runtime 执行
	err := h.runtime.ExecuteWorkflow(ctx, execID, workflow.YAMLConfig)
	if err != nil {
		h.db.Exec("UPDATE executions SET status = ?, completed_at = ?, error_message = ? WHERE id = ?",
			"failed", time.Now(), err.Error(), execID)
		return
	}

	// 等待执行完成
	for {
		status, err := h.runtime.GetPipelineStatus(execID)
		if err != nil {
			break
		}
		if status == "SUCCESS" || status == "FAILED" || status == "CANCELLED" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	// 获取最终状态
	status, _ := h.runtime.GetPipelineStatus(execID)
	finalStatus := strings.ToLower(status)
	if finalStatus == "" {
		finalStatus = "success"
	}

	h.db.Exec("UPDATE executions SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
		finalStatus, time.Now(), 2000, execID)
}

// ListExecutions 获取执行历史
func (h *WorkflowHandler) ListExecutions(c *gin.Context) {
	workflowID, _ := strconv.ParseInt(c.Query("workflow_id"), 10, 64)
	status := c.Query("status")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var conditions []string
	var args []interface{}

	if workflowID > 0 {
		conditions = append(conditions, "workflow_id = ?")
		args = append(args, workflowID)
	}
	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	h.db.Get(&total, "SELECT COUNT(*) FROM executions "+whereClause, args...)

	query := "SELECT * FROM executions " + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	var executions []model.Execution
	if err := h.db.Select(&executions, query, args...); err != nil {
		Error(c, http.StatusInternalServerError, "failed to list executions")
		return
	}

	Success(c, model.PaginatedResponse{
		Items:    executions,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// GetExecution 获取执行详情
func (h *WorkflowHandler) GetExecution(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid execution id")
		return
	}

	var execution model.Execution
	if err := h.db.Get(&execution, "SELECT * FROM executions WHERE id = ?", id); err != nil {
		if err == sql.ErrNoRows {
			Error(c, http.StatusNotFound, "execution not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get execution")
		return
	}

	Success(c, execution)
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

	// 订阅 FlowX Runtime 事件
	events := h.runtime.GetEvents()
	
	for {
		select {
		case event := <-events:
			if event.ExecutionID != id {
				continue
			}
			data, _ := json.Marshal(event)
			fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event.Type, string(data))
			flusher.Flush()
			
			if event.Type == "execution_complete" {
				return
			}
			
		case <-c.Request.Context().Done():
			return
			
		case <-time.After(30 * time.Second):
			// 发送心跳保持连接
			fmt.Fprintf(c.Writer, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		}
	}
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
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit < 1 || limit > 1000 {
		limit = 100
	}

	var conditions []string
	var args []interface{}

	conditions = append(conditions, "execution_id = ?")
	args = append(args, id)

	if nodeID != "" {
		conditions = append(conditions, "node_id = ?")
		args = append(args, nodeID)
	}
	if level != "" {
		conditions = append(conditions, "level = ?")
		args = append(args, level)
	}

	whereClause := "WHERE " + strings.Join(conditions, " AND ")

	var total int
	h.db.Get(&total, "SELECT COUNT(*) FROM execution_logs "+whereClause, args...)

	query := "SELECT * FROM execution_logs " + whereClause + " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	var logs []model.ExecutionLog
	if err := h.db.Select(&logs, query, args...); err != nil {
		Error(c, http.StatusInternalServerError, "failed to get logs")
		return
	}

	Success(c, gin.H{
		"items":  logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}
