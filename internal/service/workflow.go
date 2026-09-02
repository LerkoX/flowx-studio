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
	nodeSvc   *NodeService
	audit     *AuditService
	executors *ExecutorService
	sysCfg    *SystemConfigService
	logRing   *LogRingBuffer
	metaMu    sync.Mutex
	metaCache map[int64]map[string]interface{}
}

// NewWorkflowService 创建工作流服务
func NewWorkflowService(database *db.DB, rt *runtime.Adapter, bus *event.Bus, nodeSvc *NodeService) *WorkflowService {
	svc := &WorkflowService{
		db:        database,
		runtime:   rt,
		eventBus:  bus,
		validator: validator.NewWorkflowValidator(),
		nodeSvc:   nodeSvc,
		logRing:   NewLogRingBuffer(1000),
		metaCache: make(map[int64]map[string]interface{}),
	}
	rt.OnLog(svc.handleLogEntry)
	// 执行完成时持久化运行时快照（含各节点/步骤状态），供无状态续跑恢复
	rt.SetExportHandler(svc.saveRuntimeSnapshot)
	return svc
}

// saveRuntimeSnapshot 在执行完成的 PipelineFinish 事件内同步保存快照 YAML
func (s *WorkflowService) saveRuntimeSnapshot(execID int64, snapshotYAML string) {
	fmt.Printf("[debug] saveRuntimeSnapshot exec=%d len=%d\n", execID, len(snapshotYAML))
	if snapshotYAML == "" {
		return
	}
	res, err := s.db.Exec("UPDATE executions SET runtime_yaml = ? WHERE id = ?", snapshotYAML, execID)
	if err != nil {
		fmt.Printf("[debug] saveRuntimeSnapshot exec=%d db error: %v\n", execID, err)
	} else if n, _ := res.RowsAffected(); n == 0 {
		fmt.Printf("[debug] saveRuntimeSnapshot exec=%d no rows affected\n", execID)
	}
}

// SetAudit 注入审计服务（可选）；审计写入失败不影响主流程
func (s *WorkflowService) SetAudit(a *AuditService) {
	s.audit = a
}

// SetExecutors 注入执行器实例服务（可选）；注入后 nodeRef 展开支持
// executor.ref 引用注册实例与全局默认执行器
func (s *WorkflowService) SetExecutors(e *ExecutorService) {
	s.executors = e
}

// SetSystemConfig 注入系统配置服务（可选）；用于最大并发执行数限制
func (s *WorkflowService) SetSystemConfig(cfg *SystemConfigService) {
	s.sysCfg = cfg
}

// executorResolver 供 ExpandWorkflowConfig 解析执行器实例；
// 未注入 ExecutorService 时返回 nil（展开器回退匿名实例合成）
func (s *WorkflowService) executorResolver() runtime.ExecutorResolver {
	if s.executors == nil {
		return nil
	}
	return s.executors.ResolveForNode
}

// auditRecord 静默记录审计日志
func (s *WorkflowService) auditRecord(action, resourceID, detail string) {
	if s.audit != nil {
		_ = s.audit.Record(action, "workflow", resourceID, detail)
	}
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

	s.auditRecord("create_workflow", fmt.Sprintf("%d", id), "name="+req.Name)
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
	s.auditRecord("update_workflow", fmt.Sprintf("%d", id), "name="+req.Name)
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

	s.auditRecord("delete_workflow", fmt.Sprintf("%d", id), "")
	s.eventBus.Publish(event.Event{
		Type: "workflow.deleted",
		Data: map[string]int64{"id": id},
	})

	return nil
}

// ErrTooManyConcurrentExecutions 达到系统配置 max_concurrent_executions 上限
var ErrTooManyConcurrentExecutions = fmt.Errorf("too many concurrent executions")

// Run 执行工作流
func (s *WorkflowService) Run(id int64, params map[string]interface{}, dryRun bool) (int64, string, error) {
	wf, err := s.Get(id)
	if err != nil {
		return 0, "", err
	}

	if err := s.validator.ValidateWorkflow(wf); err != nil {
		return 0, "", fmt.Errorf("workflow YAML invalid: %w", err)
	}

	// 并发执行数限制：running 状态的执行达到上限时直接拒绝（HTTP 409）
	if s.sysCfg != nil {
		maxConcurrent := s.sysCfg.GetInt("max_concurrent_executions", 5)
		var running int
		if err := s.db.Get(&running, "SELECT COUNT(*) FROM executions WHERE status = 'running'"); err != nil {
			return 0, "", fmt.Errorf("failed to count running executions: %w", err)
		}
		if running >= maxConcurrent {
			return 0, "", fmt.Errorf("%w (limit %d)", ErrTooManyConcurrentExecutions, maxConcurrent)
		}
	}

	result, err := s.db.Exec(`
		INSERT INTO executions (workflow_id, status, trigger, started_at)
		VALUES (?, ?, ?, ?)
	`, id, "running", "manual", time.Now())
	if err != nil {
		return 0, "", fmt.Errorf("failed to create execution: %w", err)
	}

	execID, _ := result.LastInsertId()

	s.auditRecord("run_workflow", fmt.Sprintf("%d", id), fmt.Sprintf("name=%s execution=%d", wf.Name, execID))
	s.setExecutionMetadata(execID, "running", "manual", nil, nil, "")

	go s.runWorkflow(execID, wf)

	return execID, fmt.Sprintf("/api/v1/executions/%d/stream", execID), nil
}

// ContinueExecution 继续运行已结束的执行实例（无状态：从 DB 快照重建，server 重启后亦可续跑）。
// 流程：读 executions.runtime_yaml（执行完成时导出的快照）→ LoadExecution 恢复实例
// 并注入 metadata_json 中的历史节点输出 → 有 yaml 时 UpdateConfig 比对更新图 → Rerun
// 增量执行（已终结节点跳过）。执行记录沿用同一 execID：状态回到 running，日志与节点记录追加。
func (s *WorkflowService) ContinueExecution(execID int64, yamlContent string) error {
	exec, err := s.GetExecution(execID)
	if err != nil {
		return err
	}
	switch exec.Status {
	case "running", "pending":
		return fmt.Errorf("execution %d is %s, cannot continue", execID, exec.Status)
	}

	// 读取运行时快照与历史 metadata
	if exec.RuntimeYAML == nil || *exec.RuntimeYAML == "" {
		return fmt.Errorf("execution %d has no runtime snapshot (创建于快照功能上线前)，无法续跑", execID)
	}
	metadataValues := s.executionMetadataValues(exec)

	if err := s.runtime.LoadExecution(context.Background(), execID, *exec.RuntimeYAML, metadataValues); err != nil {
		return err
	}

	if yamlContent != "" {
		// 提交的 YAML 视为「快照的修改版」：已物化的旧节点（带 steps）被展开器
		// 原样跳过，仅新节点（nodeRef 形式、无 steps）展开。展开结果依赖执行器
		// 注册表等可变状态，旧节点不重展开是保证与快照比对一致的关键
		if s.nodeSvc != nil {
			expanded, err := runtime.ExpandWorkflowConfig(yamlContent, s.expandLookup, s.executorResolver())
			if err != nil {
				return fmt.Errorf("failed to expand nodeRef: %w", err)
			}
			yamlContent = expanded
		}
		// 校验放在展开之后：新节点的 executor 由展开器填充，物化旧节点自带 executor
		wf := &model.Workflow{YAMLConfig: yamlContent}
		if src, err := s.Get(exec.WorkflowID); err == nil {
			wf.Name = src.Name
		}
		if err := s.validator.ValidateWorkflow(wf); err != nil {
			return fmt.Errorf("workflow YAML invalid: %w", err)
		}
		if err := s.runtime.UpdateExecutionConfig(context.Background(), execID, yamlContent); err != nil {
			return err
		}
		// 图更新成功后立即持久化新快照：快照是执行实例的单一事实来源，
		// “改完未跑/运行中途”期间前端渲染与再次续跑都应看到新图
		if snapshot, err := s.runtime.ExportExecutionConfig(execID); err == nil && snapshot != "" {
			s.saveRuntimeSnapshot(execID, snapshot)
		}
	}

	if err := s.runtime.ContinueExecution(context.Background(), execID); err != nil {
		return err
	}

	s.auditRecord("continue_execution", fmt.Sprintf("%d", execID),
		fmt.Sprintf("workflow=%d yaml_updated=%v", exec.WorkflowID, yamlContent != ""))
	return nil
}

// GetExecutionYAML 返回执行实例的运行时快照 YAML（已剥离各节点 runtime 状态段）。
// 快照是执行实例的单一事实来源：前端回放态按它渲染图结构与 nodeRef，
// 而非流水线模板。无快照（快照功能上线前的旧执行）时返回空串。
func (s *WorkflowService) GetExecutionYAML(execID int64) (string, error) {
	exec, err := s.GetExecution(execID)
	if err != nil {
		return "", err
	}
	if exec.RuntimeYAML == nil || *exec.RuntimeYAML == "" {
		return "", nil
	}
	return runtime.StripRuntimeSections(*exec.RuntimeYAML), nil
}

// executionMetadataValues 从执行记录的 metadata_json 中提取历史节点输出（扁平 NodeId.key 键值）
func (s *WorkflowService) executionMetadataValues(exec *model.Execution) map[string]interface{} {
	if exec.MetadataJSON == nil || *exec.MetadataJSON == "" {
		return nil
	}
	var snap map[string]interface{}
	if err := json.Unmarshal([]byte(*exec.MetadataJSON), &snap); err != nil {
		return nil
	}
	meta, _ := snap["metadata"].(map[string]interface{})
	if len(meta) == 0 {
		return nil
	}
	return meta
}

// expandLookup 供 ExpandWorkflowConfig 按 nodeRef 名称查找节点，
// 并填充资产目录/签名 URL（展开器据此生成 cp/curl 引导脚本）。
func (s *WorkflowService) expandLookup(name string) (*model.Node, error) {
	node, err := s.nodeSvc.GetByName(name)
	if err != nil {
		return nil, err
	}
	s.nodeSvc.PrepareAssets(node)
	return node, nil
}

// MockRun 工作流 Mock 执行：校验 YAML 并展开 nodeRef，返回展开后的配置，
// 不创建执行记录、不触发 FlowX Runtime。用于在真实运行前验证工作流可被正确装配。
func (s *WorkflowService) MockRun(id int64) (map[string]interface{}, error) {
	wf, err := s.Get(id)
	if err != nil {
		return nil, err
	}

	if err := s.validator.ValidateWorkflow(wf); err != nil {
		return nil, fmt.Errorf("workflow YAML invalid: %w", err)
	}

	expanded := wf.YAMLConfig
	if s.nodeSvc != nil {
		expanded, err = runtime.ExpandWorkflowConfig(wf.YAMLConfig, s.expandLookup, s.executorResolver())
		if err != nil {
			return nil, fmt.Errorf("failed to expand nodeRef: %w", err)
		}
	}

	return map[string]interface{}{
		"valid":        true,
		"expandedYaml": expanded,
	}, nil
}

func (s *WorkflowService) runWorkflow(execID int64, wf *model.Workflow) {
	ctx := context.Background()
	startTime := time.Now()

	yamlConfig := wf.YAMLConfig
	if s.nodeSvc != nil {
		expanded, err := runtime.ExpandWorkflowConfig(yamlConfig, s.expandLookup, s.executorResolver())
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
		yamlConfig = expanded
	}

	s.db.Exec("UPDATE executions SET status = ?, started_at = ? WHERE id = ?",
		"running", startTime, execID)

	s.eventBus.Publish(event.Event{
		Type: "execution.started",
		Data: map[string]interface{}{
			"execution_id": execID,
			"workflow_id":  wf.ID,
			"status":       "running",
		},
	})

	err := s.runtime.ExecuteWorkflow(ctx, execID, yamlConfig)
	if err != nil {
		errMsg := err.Error()
		s.logExecutionError(execID, "", "failed to start workflow: "+errMsg)
		s.db.Exec("UPDATE executions SET status = ?, completed_at = ?, error_message = ? WHERE id = ?",
			"failed", time.Now(), errMsg, execID)
		s.setExecutionMetadata(execID, "failed", "manual", nil, nil, errMsg)
		s.eventBus.Publish(event.Event{
			Type: "execution.completed",
			Data: map[string]interface{}{
				"execution_id": execID,
				"workflow_id":  wf.ID,
				"status":       "failed",
				"error":        errMsg,
			},
		})
		return
	}

	// 轮询等待完成
	var pipelineErr error
	for {
		status, err := s.runtime.GetPipelineStatus(execID)
		if err != nil {
			pipelineErr = err
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
		if pipelineErr != nil {
			finalStatus = "failed"
		} else {
			finalStatus = "success"
		}
	}

	completedAt := time.Now()
	durationMs := int(time.Since(startTime).Milliseconds())
	var errorMsg string
	if pipelineErr != nil {
		// 如果 pipeline 实例已从 runtime 删除（RunAsync 完成即删的正常竞态），
		// 根据执行节点状态兜底判断；仅确实失败时才写错误日志
		nodeStatus, nodeErrMsg := s.resolveFinalStatusFromNodes(execID)
		if nodeStatus != "" {
			finalStatus = nodeStatus
			if nodeErrMsg != "" {
				errorMsg = nodeErrMsg
			}
		} else {
			errorMsg = pipelineErr.Error()
			s.logExecutionError(execID, "", "pipeline execution failed: "+errorMsg)
		}
	}

	s.db.Exec("UPDATE executions SET status = ?, completed_at = ?, duration_ms = ?, error_message = ? WHERE id = ?",
		finalStatus, completedAt, durationMs, errorMsg, execID)

	s.setExecutionMetadata(execID, finalStatus, "manual", nil, nil, errorMsg)

	s.eventBus.Publish(event.Event{
		Type: "execution.completed",
		Data: map[string]interface{}{
			"execution_id": execID,
			"workflow_id":  wf.ID,
			"status":       finalStatus,
			"error":        errorMsg,
		},
	})
}

// logExecutionError 写入兜底错误日志，确保启动失败时前端仍能看到日志
func (s *WorkflowService) logExecutionError(execID int64, nodeName, message string) {
	_, _ = s.db.Exec(`
		INSERT INTO execution_logs (execution_id, node_id, node_name, step_name, level, message, output, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, execID, nodeName, nodeName, "", "error", message, "", time.Now())

	s.eventBus.Publish(event.Event{
		Type: "execution.log",
		Data: map[string]interface{}{
			"execution_id": execID,
			"node_id":      nodeName,
			"node_name":    nodeName,
			"step_name":    "",
			"level":        "error",
			"message":      message,
			"output":       "",
			"timestamp":    time.Now(),
		},
	})
}

// resolveFinalStatusFromNodes 当 pipeline 已被清理时，根据执行节点状态兜底判断最终结果
func (s *WorkflowService) resolveFinalStatusFromNodes(execID int64) (string, string) {
	var nodes []model.ExecutionNode
	if err := s.db.Select(&nodes, "SELECT status FROM execution_nodes WHERE execution_id = ?", execID); err != nil {
		return "failed", err.Error()
	}
	if len(nodes) == 0 {
		return "failed", "no execution nodes found"
	}
	for _, n := range nodes {
		if n.Status == "failed" {
			return "failed", ""
		}
	}
	return "success", ""
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
// order 支持 asc/desc（默认 asc），desc 用于前端「取最后 N 条 + 向上懒加载更旧日志」。
// 排序按 id（自增主键，与写入顺序严格一致），避免同毫秒 timestamp 导致分页错位。
// nodeID 同时匹配 node_id 与 node_name（节点包可能把展示名写入 node_name）。
// search 对 message 做 LIKE 模糊匹配，让搜索覆盖未加载的旧日志。
func (s *WorkflowService) GetExecutionLogs(id int64, nodeID, level, search, order string, limit, offset int) (map[string]interface{}, error) {
	if limit < 1 || limit > 1000 {
		limit = 100
	}

	var conditions []string
	var args []interface{}

	conditions = append(conditions, "execution_id = ?")
	args = append(args, id)

	if nodeID != "" {
		conditions = append(conditions, "(node_id = ? OR node_name = ?)")
		args = append(args, nodeID, nodeID)
	}
	if level != "" {
		conditions = append(conditions, "level = ?")
		args = append(args, level)
	}
	if search != "" {
		conditions = append(conditions, "message LIKE ?")
		args = append(args, "%"+search+"%")
	}

	whereClause := "WHERE " + strings.Join(conditions, " AND ")

	var total int
	if err := s.db.Get(&total, "SELECT COUNT(*) FROM execution_logs "+whereClause, args...); err != nil {
		return nil, fmt.Errorf("failed to count logs: %w", err)
	}

	sortOrder := "ASC"
	if strings.EqualFold(order, "desc") {
		sortOrder = "DESC"
	}
	query := "SELECT * FROM execution_logs " + whereClause + " ORDER BY id " + sortOrder + " LIMIT ? OFFSET ?"
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

// GetAllExecutionLogs 获取执行的全部日志（用于导出）
func (s *WorkflowService) GetAllExecutionLogs(executionID int64) ([]model.ExecutionLog, error) {
	var logs []model.ExecutionLog
	if err := s.db.Select(&logs,
		"SELECT * FROM execution_logs WHERE execution_id = ? ORDER BY timestamp ASC", executionID); err != nil {
		return nil, fmt.Errorf("failed to get logs: %w", err)
	}
	return logs, nil
}

// RecentExecutionLogs 返回执行日志内存环形缓冲区中的最近条目（SSE 重连回放用）。
func (s *WorkflowService) RecentExecutionLogs(executionID int64) []map[string]interface{} {
	return s.logRing.Recent(executionID)
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

	logData := map[string]interface{}{
		"execution_id": execID,
		"node_id":      entry.Node,
		"node_name":    entry.Node,
		"step_name":    entry.Step,
		"level":        strings.ToLower(string(entry.Level)),
		"message":      entry.Message,
		"output":       entry.Output,
		"timestamp":    entry.Timestamp,
	}
	s.logRing.Append(execID, logData)
	s.eventBus.Publish(event.Event{
		Type: "execution.log",
		Data: logData,
	})
}

// persistRuntimeEvent 持久化运行时事件并转发到事件总线
func (s *WorkflowService) persistRuntimeEvent(evt runtime.ExecutionEvent) {
	fmt.Printf("[debug] persist type=%s exec=%d\n", evt.Type, evt.ExecutionID)
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
		// 兼容续跑（ContinueExecution）：状态回到 running 并清空完成时间
		_, _ = s.db.Exec("UPDATE executions SET status = ?, started_at = ?, completed_at = NULL WHERE id = ?",
			"running", time.Now(), evt.ExecutionID)
		if params, ok := evt.Data["params"].(map[string]interface{}); ok {
			s.setExecutionMetadata(evt.ExecutionID, "running", "", params, nil, "")
		}
	case "node_start":
		nodeName := evt.NodeName
		if nodeName == "" {
			nodeName = evt.NodeID
		}
		started := evt.Timestamp
		if started.IsZero() {
			started = time.Now()
		}
		_, _ = s.db.Exec(`
			INSERT INTO execution_nodes (execution_id, node_id, node_name, status, started_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(execution_id, node_id) DO UPDATE SET
				status = excluded.status,
				started_at = excluded.started_at,
				completed_at = NULL,
				duration_ms = NULL
		`, evt.ExecutionID, evt.NodeID, nodeName, "running", started)
	case "node_complete":
		status := evt.Status
		if status == "" {
			status = "success"
		}
		// 用事件产生时刻（而非消费时刻）计算耗时，事件桥积压时不会虚高
		completed := evt.Timestamp
		if completed.IsZero() {
			completed = time.Now()
		}
		var startedAt time.Time
		if err := s.db.Get(&startedAt,
			"SELECT started_at FROM execution_nodes WHERE execution_id = ? AND node_id = ?",
			evt.ExecutionID, evt.NodeID); err == nil {
			duration := int(completed.Sub(startedAt).Milliseconds())
			// 仅当存在进行中的运行记录时才收尾：循环图后续迭代中，上游已终结节点
			// 被跳过时会再次触发 node_complete（无对应 node_start），不能覆盖首轮耗时
			_, _ = s.db.Exec(`
				UPDATE execution_nodes
				SET status = ?, completed_at = ?, duration_ms = ?
				WHERE execution_id = ? AND node_id = ? AND status = 'running'
			`, status, completed, duration, evt.ExecutionID, evt.NodeID)
		}
	case "execution_complete":
		// dag 库返回大写状态（SUCCESS/FAILED/CANCELLED），入库前统一归一化为小写，
		// 与轮询收尾路径（runWorkflowAsync）及前端状态映射保持一致
		status := strings.ToLower(evt.Status)
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
		// 以 DB 中已有快照为合并基础：execution_complete 事件（携带 params 与
		// 节点输出 metadata）由异步事件桥处理并删除缓存，runWorkflow 的收尾
		// 写入若落在其后，不能直接以空快照覆盖 DB（会丢失节点输出）。
		var existing sql.NullString
		if err := s.db.Get(&existing, "SELECT metadata_json FROM executions WHERE id = ?", execID); err == nil && existing.Valid && existing.String != "" {
			_ = json.Unmarshal([]byte(existing.String), &cache)
		}
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
