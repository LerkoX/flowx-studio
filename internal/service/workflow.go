package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/runtime"
	"github.com/LerkoX/flowx-studio/internal/validator"
	"github.com/LerkoX/flowx/logger"
)

// WorkflowService 工作流服务
type WorkflowService struct {
	db        *db.DB
	runtime   *runtime.Adapter
	eventBus  *event.Bus
	validator *validator.WorkflowValidator
	metaMu    sync.Mutex
	metaCache map[int64]map[string]interface{}
}

// NewWorkflowService 创建工作流服务
func NewWorkflowService(database *db.DB, rt *runtime.Adapter, bus *event.Bus) *WorkflowService {
	svc := &WorkflowService{
		db:        database,
		runtime:   rt,
		eventBus:  bus,
		validator: validator.NewWorkflowValidator(),
		metaCache: make(map[int64]map[string]interface{}),
	}
	rt.OnLog(svc.handleLogEntry)
	return svc
}

// List 获取工作流列表
func (s *WorkflowService) List(status, search string, page, pageSize int) (*model.PaginatedResponse, error) {
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
	if err := s.db.Get(&total, "SELECT COUNT(*) FROM workflows "+whereClause, args...); err != nil {
		return nil, fmt.Errorf("failed to count workflows: %w", err)
	}

	query := "SELECT * FROM workflows " + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	var workflows []model.Workflow
	if err := s.db.Select(&workflows, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list workflows: %w", err)
	}

	return &model.PaginatedResponse{
		Items:    workflows,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// Get 获取工作流详情
func (s *WorkflowService) Get(id int64) (*model.Workflow, error) {
	var wf model.Workflow
	if err := s.db.Get(&wf, "SELECT * FROM workflows WHERE id = ?", id); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("workflow not found")
		}
		return nil, fmt.Errorf("failed to get workflow: %w", err)
	}
	return &wf, nil
}

// Create 创建工作流
func (s *WorkflowService) Create(req *model.Workflow) (*model.Workflow, error) {
	if err := s.validator.ValidateWorkflow(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	if req.Status == "" {
		req.Status = "draft"
	}

	result, err := s.db.Exec(`
		INSERT INTO workflows (name, description, intent, yaml_config, status)
		VALUES (?, ?, ?, ?, ?)
	`, req.Name, req.Description, req.Intent, req.YAMLConfig, req.Status)
	if err != nil {
		return nil, fmt.Errorf("failed to create workflow: %w", err)
	}

	id, _ := result.LastInsertId()
	req.ID = id

	s.eventBus.Publish(event.Event{
		Type: "workflow.created",
		Data: req,
	})

	return req, nil
}

// Update 更新工作流
func (s *WorkflowService) Update(id int64, req *model.Workflow) error {
	if err := s.validator.ValidateWorkflow(req); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	_, err := s.db.Exec(`
		UPDATE workflows SET
			name = ?, description = ?, intent = ?, yaml_config = ?, status = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.Description, req.Intent, req.YAMLConfig, req.Status, id)
	if err != nil {
		return fmt.Errorf("failed to update workflow: %w", err)
	}

	req.ID = id
	s.eventBus.Publish(event.Event{
		Type: "workflow.updated",
		Data: req,
	})

	return nil
}

// Delete 删除工作流
func (s *WorkflowService) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM workflows WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete workflow: %w", err)
	}

	s.eventBus.Publish(event.Event{
		Type: "workflow.deleted",
		Data: map[string]int64{"id": id},
	})

	return nil
}

// Run 执行工作流
func (s *WorkflowService) Run(id int64, params map[string]interface{}, dryRun bool) (int64, string, error) {
	wf, err := s.Get(id)
	if err != nil {
		return 0, "", err
	}

	if err := s.validator.ValidateWorkflow(wf); err != nil {
		return 0, "", fmt.Errorf("workflow YAML invalid: %w", err)
	}

	result, err := s.db.Exec(`
		INSERT INTO executions (workflow_id, status, trigger, started_at)
		VALUES (?, ?, ?, ?)
	`, id, "running", "manual", time.Now())
	if err != nil {
		return 0, "", fmt.Errorf("failed to create execution: %w", err)
	}

	execID, _ := result.LastInsertId()

	s.setExecutionMetadata(execID, "running", "manual", nil, nil, "")

	go s.runWorkflow(execID, wf)

	return execID, fmt.Sprintf("/api/v1/executions/%d/stream", execID), nil
}

func (s *WorkflowService) runWorkflow(execID int64, wf *model.Workflow) {
	ctx := context.Background()
	startTime := time.Now()

	s.db.Exec("UPDATE executions SET status = ?, started_at = ? WHERE id = ?",
		"running", startTime, execID)

	s.eventBus.Publish(event.Event{
		Type: "execution.started",
		Data: map[string]interface{}{
			"execution_id": execID,
			"workflow_id":    wf.ID,
			"status":         "running",
		},
	})

	err := s.runtime.ExecuteWorkflow(ctx, execID, wf.YAMLConfig)
	if err != nil {
		s.db.Exec("UPDATE executions SET status = ?, completed_at = ?, error_message = ? WHERE id = ?",
			"failed", time.Now(), err.Error(), execID)
		s.setExecutionMetadata(execID, "failed", "manual", nil, nil, err.Error())
		s.eventBus.Publish(event.Event{
			Type: "execution.completed",
			Data: map[string]interface{}{
				"execution_id": execID,
				"workflow_id":  wf.ID,
				"status":       "failed",
				"error":        err.Error(),
			},
		})
		return
	}

	// 轮询等待完成
	for {
		status, err := s.runtime.GetPipelineStatus(execID)
		if err != nil {
			break
		}
		if status == "SUCCESS" || status == "FAILED" || status == "CANCELLED" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	status, _ := s.runtime.GetPipelineStatus(execID)
	finalStatus := strings.ToLower(status)
	if finalStatus == "" {
		finalStatus = "success"
	}

	s.db.Exec("UPDATE executions SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
		finalStatus, time.Now(), int(time.Since(startTime).Milliseconds()), execID)

	s.eventBus.Publish(event.Event{
		Type: "execution.completed",
		Data: map[string]interface{}{
			"execution_id": execID,
			"workflow_id":  wf.ID,
			"status":       finalStatus,
		},
	})
}

// ListExecutions 获取执行历史
func (s *WorkflowService) ListExecutions(workflowID int64, status string, page, pageSize int) (*model.PaginatedResponse, error) {
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
	if err := s.db.Get(&total, "SELECT COUNT(*) FROM executions "+whereClause, args...); err != nil {
		return nil, fmt.Errorf("failed to count executions: %w", err)
	}

	query := "SELECT * FROM executions " + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	var executions []model.Execution
	if err := s.db.Select(&executions, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list executions: %w", err)
	}

	return &model.PaginatedResponse{
		Items:    executions,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// GetExecution 获取执行详情
func (s *WorkflowService) GetExecution(id int64) (*model.Execution, error) {
	var exec model.Execution
	if err := s.db.Get(&exec, "SELECT * FROM executions WHERE id = ?", id); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("execution not found")
		}
		return nil, fmt.Errorf("failed to get execution: %w", err)
	}
	return &exec, nil
}

// GetExecutionLogs 获取执行日志
func (s *WorkflowService) GetExecutionLogs(id int64, nodeID, level string, limit, offset int) (map[string]interface{}, error) {
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
	if err := s.db.Get(&total, "SELECT COUNT(*) FROM execution_logs "+whereClause, args...); err != nil {
		return nil, fmt.Errorf("failed to count logs: %w", err)
	}

	query := "SELECT * FROM execution_logs " + whereClause + " ORDER BY timestamp ASC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	var logs []model.ExecutionLog
	if err := s.db.Select(&logs, query, args...); err != nil {
		return nil, fmt.Errorf("failed to get logs: %w", err)
	}

	return map[string]interface{}{
		"items":  logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	}, nil
}

// SubscribeEvents 订阅事件
func (s *WorkflowService) SubscribeEvents() chan event.Event {
	ch, _ := s.eventBus.Subscribe()
	return ch
}

// UnsubscribeEvents 取消订阅事件
func (s *WorkflowService) UnsubscribeEvents(ch chan event.Event) {
	s.eventBus.Unsubscribe(ch)
}

// GetExecutionNodes 获取执行节点状态
func (s *WorkflowService) GetExecutionNodes(executionID int64) ([]model.ExecutionNode, error) {
	var nodes []model.ExecutionNode
	if err := s.db.Select(&nodes, "SELECT * FROM execution_nodes WHERE execution_id = ? ORDER BY id", executionID); err != nil {
		return nil, fmt.Errorf("failed to get execution nodes: %w", err)
	}
	return nodes, nil
}

// handleLogEntry 持久化运行时日志
func (s *WorkflowService) handleLogEntry(entry logger.Entry) {
	execIDStr := strings.TrimPrefix(entry.Pipeline, "exec-")
	execID, err := strconv.ParseInt(execIDStr, 10, 64)
	if err != nil || execID <= 0 {
		return
	}

	ts := entry.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}

	_, _ = s.db.Exec(`
		INSERT INTO execution_logs (execution_id, node_id, node_name, step_name, level, message, output, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, execID, entry.Node, entry.Node, entry.Step, strings.ToLower(string(entry.Level)), entry.Message, entry.Output, ts)

	s.eventBus.Publish(event.Event{
		Type: "execution.log",
		Data: map[string]interface{}{
			"execution_id": execID,
			"node_id":      entry.Node,
			"node_name":    entry.Node,
			"step_name":    entry.Step,
			"level":        strings.ToLower(string(entry.Level)),
			"message":      entry.Message,
			"output":       entry.Output,
			"timestamp":    entry.Timestamp,
		},
	})
}

// persistRuntimeEvent 持久化运行时事件并转发到事件总线
func (s *WorkflowService) persistRuntimeEvent(evt runtime.ExecutionEvent) {
	data := map[string]interface{}{
		"type":         evt.Type,
		"execution_id": evt.ExecutionID,
	}
	if evt.NodeID != "" {
		data["node_id"] = evt.NodeID
	}
	if evt.NodeName != "" {
		data["node_name"] = evt.NodeName
	}
	if evt.Status != "" {
		data["status"] = evt.Status
	}
	if evt.DurationMs > 0 {
		data["duration_ms"] = evt.DurationMs
	}
	for k, v := range evt.Data {
		data[k] = v
	}

	switch evt.Type {
	case "execution_start":
		_, _ = s.db.Exec("UPDATE executions SET status = ?, started_at = ? WHERE id = ?",
			"running", time.Now(), evt.ExecutionID)
		if params, ok := evt.Data["params"].(map[string]interface{}); ok {
			s.setExecutionMetadata(evt.ExecutionID, "running", "", params, nil, "")
		}
	case "node_start":
		nodeName := evt.NodeName
		if nodeName == "" {
			nodeName = evt.NodeID
		}
		_, _ = s.db.Exec(`
			INSERT INTO execution_nodes (execution_id, node_id, node_name, status, started_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(execution_id, node_id) DO UPDATE SET
				status = excluded.status,
				started_at = excluded.started_at,
				completed_at = NULL,
				duration_ms = NULL
		`, evt.ExecutionID, evt.NodeID, nodeName, "running", time.Now())
	case "node_complete":
		status := evt.Status
		if status == "" {
			status = "success"
		}
		var startedAt time.Time
		if err := s.db.Get(&startedAt,
			"SELECT started_at FROM execution_nodes WHERE execution_id = ? AND node_id = ?",
			evt.ExecutionID, evt.NodeID); err == nil {
			duration := int(time.Since(startedAt).Milliseconds())
			_, _ = s.db.Exec(`
				UPDATE execution_nodes
				SET status = ?, completed_at = ?, duration_ms = ?
				WHERE execution_id = ? AND node_id = ?
			`, status, time.Now(), duration, evt.ExecutionID, evt.NodeID)
		}
	case "execution_complete":
		status := evt.Status
		if status == "" {
			status = "success"
		}
		var startedAt *time.Time
		if err := s.db.Get(&startedAt, "SELECT started_at FROM executions WHERE id = ?", evt.ExecutionID); err == nil && startedAt != nil {
			duration := int(time.Since(*startedAt).Milliseconds())
			_, _ = s.db.Exec("UPDATE executions SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
				status, time.Now(), duration, evt.ExecutionID)
		} else {
			_, _ = s.db.Exec("UPDATE executions SET status = ?, completed_at = ? WHERE id = ?",
				status, time.Now(), evt.ExecutionID)
		}
		params, _ := evt.Data["params"].(map[string]interface{})
		metadata, _ := evt.Data["metadata"].(map[string]interface{})
		s.setExecutionMetadata(evt.ExecutionID, strings.ToLower(status), "", params, metadata, "")
		delete(s.metaCache, evt.ExecutionID)
	}

	s.eventBus.Publish(event.Event{
		Type: evt.Type,
		Data: data,
	})
}

// setExecutionMetadata 保存运行时元数据快照
func (s *WorkflowService) setExecutionMetadata(execID int64, status, trigger string, params, runtimeMetadata map[string]interface{}, errStr string) {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()

	cache, ok := s.metaCache[execID]
	if !ok {
		cache = make(map[string]interface{})
		s.metaCache[execID] = cache
	}
	if status != "" {
		cache["status"] = status
	}
	if trigger != "" {
		cache["trigger"] = trigger
	}
	if errStr != "" {
		cache["error"] = errStr
	}
	if params != nil {
		cache["params"] = params
	}
	if runtimeMetadata != nil {
		cache["metadata"] = runtimeMetadata
	}

	metadataJSON, _ := json.Marshal(cache)
	_, _ = s.db.Exec("UPDATE executions SET metadata_json = ? WHERE id = ?", string(metadataJSON), execID)
}

// StartEventBridge 将 FlowX Runtime 事件转发到事件总线
func (s *WorkflowService) StartEventBridge(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case evt, ok := <-s.runtime.GetEvents():
				if !ok {
					return
				}
				s.persistRuntimeEvent(evt)
			}
		}
	}()
}
