package runtime

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/LerkoX/flowx"
	"github.com/LerkoX/flowx/core"
	"github.com/LerkoX/flowx/dag"
	"github.com/LerkoX/flowx/logger"
	"github.com/LerkoX/flowx/metadata"
)

// Adapter FlowX 运行时适配器
type Adapter struct {
	runtime   flowx.Runtime
	eventCh   chan ExecutionEvent
	logPusher *LogPusher
	mu        sync.RWMutex
}

// exportHandler 执行完成时的快照导出回调（atomic 存储，启动时注册一次）
var exportHandler atomic.Value // func(executionID int64, snapshotYAML string)

// ExecutionEvent 执行事件
type ExecutionEvent struct {
	Type        string                 `json:"type"`
	ExecutionID int64                  `json:"execution_id"`
	NodeID      string                 `json:"node_id,omitempty"`
	NodeName    string                 `json:"node_name,omitempty"`
	Status      string                 `json:"status,omitempty"`
	DurationMs  int                    `json:"duration_ms,omitempty"`
	Timestamp   time.Time              `json:"timestamp"`
	Data        map[string]interface{} `json:"data,omitempty"`
}

// NewAdapter 创建运行时适配器
func NewAdapter() *Adapter {
	rt := flowx.NewRuntime(context.Background())
	rt.StartBackground()

	adapter := &Adapter{
		runtime:   rt,
		eventCh:   make(chan ExecutionEvent, 100),
		logPusher: NewLogPusher(),
	}

	// 设置日志推送器
	rt.SetPusher(adapter.logPusher)

	return adapter
}

// OnLog 注册日志回调
func (a *Adapter) OnLog(handler func(entry logger.Entry)) {
	a.logPusher.OnLog(handler)
}

// ExecuteWorkflow 执行工作流。
// 实例在完成时即从 flowx Runtime 删除；PipelineFinish 事件回调内同步导出
// 运行时快照（ExportConfig）并回调 exportHandler，供上层持久化以支持无状态续跑。
func (a *Adapter) ExecuteWorkflow(ctx context.Context, executionID int64, configYAML string) error {
	id := fmt.Sprintf("exec-%d", executionID)

	// 创建监听器
	listener := &studioListener{
		adapter:     a,
		executionID: executionID,
	}

	// 异步执行
	pipeline, err := a.runtime.RunAsync(ctx, id, configYAML, listener)
	if err != nil {
		return fmt.Errorf("failed to start workflow: %w", err)
	}

	// 将 pipeline 内部 ID 映射到 execution ID，便于日志推送器定位
	if pipeline != nil {
		a.logPusher.RegisterPipeline(pipeline.Id(), executionID)
	}

	return nil
}

// SetExportHandler 注册运行时快照导出回调（在执行完成的 PipelineFinish 事件内同步调用）
func (a *Adapter) SetExportHandler(h func(executionID int64, snapshotYAML string)) {
	exportHandler.Store(h)
}

// LoadExecution 从运行时快照 YAML 恢复已完成的执行实例（不运行），
// 并注入历史 metadata（恢复下游节点 {{ NodeId.key }} 引用的数据来源）。
// 用于续跑前重建实例；同 ID 旧实例存在时先移除（DB 快照总是最新的）。
func (a *Adapter) LoadExecution(ctx context.Context, executionID int64, snapshotYAML string, metadataValues map[string]interface{}) error {
	id := fmt.Sprintf("exec-%d", executionID)

	// 同名旧实例（如同进程多次续跑）先释放；DB 快照在每次完成时更新，重建总是最新
	a.runtime.Rm(id)

	listener := &studioListener{
		adapter:     a,
		executionID: executionID,
	}
	pipeline, err := a.runtime.LoadPipeline(ctx, id, snapshotYAML, listener)
	if err != nil {
		return fmt.Errorf("failed to load execution snapshot: %w", err)
	}

	// 注入历史 metadata：flowx 渲染上下文（buildRenderContext）会合并
	// InConfigMetadataStore 的全部数据，续跑中新提取的数据也会写回该 store
	if len(metadataValues) > 0 {
		store, err := metadata.NewInConfigMetadataStore(core.MetadataConfig{
			Type: "in-config",
			Data: metadataValues,
		})
		if err != nil {
			return fmt.Errorf("failed to build metadata store: %w", err)
		}
		pipeline.SetMetadata(store)
	}

	a.logPusher.RegisterPipeline(pipeline.Id(), executionID)
	return nil
}

// UpdateExecutionConfig 用新的 FlowX YAML 更新已完成/可修改状态的执行实例图结构。
// 由 flowx UpdateConfig 自动比对差异：已执行节点不可删除/替换，仅允许修改未运行节点。
func (a *Adapter) UpdateExecutionConfig(ctx context.Context, executionID int64, configYAML string) error {
	id := fmt.Sprintf("exec-%d", executionID)
	if err := a.runtime.UpdateConfig(ctx, id, configYAML); err != nil {
		return fmt.Errorf("failed to update execution config: %w", err)
	}
	return nil
}

// ContinueExecution 重新运行已完成的执行实例（配合 UpdateExecutionConfig 追加节点后调用）。
// 已终结状态的节点跳过，仅执行新增/未运行节点。
func (a *Adapter) ContinueExecution(ctx context.Context, executionID int64) error {
	id := fmt.Sprintf("exec-%d", executionID)
	if err := a.runtime.Rerun(ctx, id); err != nil {
		return fmt.Errorf("failed to continue execution: %w", err)
	}
	return nil
}

// PauseExecution 暂停运行中的执行实例。引擎为层边界暂停：Pause 立即将状态
// 置为 PAUSED，当前并发层的节点执行完后在层边界挂起（不中断运行中的节点）。
func (a *Adapter) PauseExecution(ctx context.Context, executionID int64) error {
	id := fmt.Sprintf("exec-%d", executionID)
	if err := a.runtime.Pause(ctx, id); err != nil {
		return fmt.Errorf("failed to pause execution: %w", err)
	}
	return nil
}

// ResumeExecution 恢复已暂停的执行实例。实例在内存时直接 Resume；
// 暂停时会导出运行时快照（见 PauseExecution 与 listener 的 PipelinePaused 分支），
// server 重启后可由上层从快照重建实例再 Rerun 恢复。
func (a *Adapter) ResumeExecution(ctx context.Context, executionID int64) error {
	id := fmt.Sprintf("exec-%d", executionID)
	if err := a.runtime.Resume(ctx, id); err != nil {
		return fmt.Errorf("failed to resume execution: %w", err)
	}
	return nil
}

// ExportExecutionConfig 导出执行实例当前的配置快照（图结构 + 节点定义 + 运行时状态）。
// 用于续跑修改图后立即持久化新快照，避免“改完未跑”期间 DB 快照落后于实例实际图
func (a *Adapter) ExportExecutionConfig(executionID int64) (string, error) {
	id := fmt.Sprintf("exec-%d", executionID)
	return a.runtime.ExportConfig(id)
}

// GetEvents 获取事件通道
func (a *Adapter) GetEvents() <-chan ExecutionEvent {
	return a.eventCh
}

// CancelExecution 取消执行
func (a *Adapter) CancelExecution(ctx context.Context, executionID int64) error {
	id := fmt.Sprintf("exec-%d", executionID)
	return a.runtime.Cancel(ctx, id)
}

// GetPipelineStatus 获取流水线状态
func (a *Adapter) GetPipelineStatus(executionID int64) (string, error) {
	id := fmt.Sprintf("exec-%d", executionID)
	p, err := a.runtime.Get(id)
	if err != nil {
		return "", err
	}
	return p.Status(), nil
}

// Stop 停止运行时
func (a *Adapter) Stop() {
	a.runtime.StopBackground()
}

// PushEvent 推送事件到通道
func (a *Adapter) PushEvent(event ExecutionEvent) {
	select {
	case a.eventCh <- event:
	default:
		// 通道满，丢弃旧事件
	}
}

// studioListener 实现 dag.Listener 接口
type studioListener struct {
	adapter     *Adapter
	executionID int64
}

func metadataToMap(m dag.Metadata) map[string]interface{} {
	if m == nil {
		return nil
	}
	result := make(map[string]interface{}, len(m))
	for k, v := range m {
		result[k] = v.Value
	}
	return result
}

// nodeOutputs 从流水线 metadata 中提取某个节点的输出字段（键为 <nodeID>.<field> 扁平结构），
// 返回去掉节点前缀的字段 map。节点完成时其 extract 输出已写入 metadata store，
// 随 node_complete 事件下发，供前端画布实时展示节点输出
func nodeOutputs(m dag.Metadata, nodeID string) map[string]interface{} {
	if m == nil || nodeID == "" {
		return nil
	}
	prefix := nodeID + "."
	var result map[string]interface{}
	for k, v := range m {
		if field, ok := strings.CutPrefix(k, prefix); ok {
			if result == nil {
				result = make(map[string]interface{})
			}
			result[field] = v.Value
		}
	}
	return result
}

// Handle 处理事件
func (l *studioListener) Handle(p dag.Pipeline, event dag.Event) {
	fmt.Printf("[debug] listener exec-%d event=%s\n", l.executionID, event)
	switch event {
	case dag.PipelineStart:
		l.adapter.PushEvent(ExecutionEvent{
			Type:        "execution_start",
			ExecutionID: l.executionID,
			Status:      "running",
			Timestamp:   time.Now(),
			Data: map[string]interface{}{
				"params": metadataToMap(p.GetParam()),
			},
		})
	case dag.PipelineFinish:
		fmt.Printf("[debug] finish-case exec-%d entered\n", l.executionID)
		// 实例在 Run 返回后即被 RunAsync 删除，快照导出必须在事件回调内同步完成
		if h, ok := exportHandler.Load().(func(int64, string)); ok && h != nil {
			id := fmt.Sprintf("exec-%d", l.executionID)
			if snapshotYAML, err := l.adapter.runtime.ExportConfig(id); err == nil {
				fmt.Printf("[debug] export ok exec-%d len=%d\n", l.executionID, len(snapshotYAML))
				h(l.executionID, snapshotYAML)
			} else {
				fmt.Printf("[debug] export snapshot failed for exec-%d: %v\n", l.executionID, err)
			}
		} else {
			fmt.Printf("[debug] no export handler registered (exec-%d)\n", l.executionID)
		}
		l.adapter.PushEvent(ExecutionEvent{
			Type:        "execution_complete",
			ExecutionID: l.executionID,
			Status:      p.Status(),
			Timestamp:   time.Now(),
			Data: map[string]interface{}{
				"params":   metadataToMap(p.GetParam()),
				"metadata": metadataToMap(p.Metadata()),
			},
		})
	case dag.PipelinePaused:
		// 层边界暂停生效时同步导出快照（此刻当前层节点已全部终结，状态干净），
		// 供 server 重启后从暂停点重建实例恢复运行
		if h, ok := exportHandler.Load().(func(int64, string)); ok && h != nil {
			id := fmt.Sprintf("exec-%d", l.executionID)
			if snapshotYAML, err := l.adapter.runtime.ExportConfig(id); err == nil {
				h(l.executionID, snapshotYAML)
			}
		}
		l.adapter.PushEvent(ExecutionEvent{
			Type:        "execution_paused",
			ExecutionID: l.executionID,
			Status:      "paused",
			Timestamp:   time.Now(),
		})
	case dag.PipelineResumed:
		l.adapter.PushEvent(ExecutionEvent{
			Type:        "execution_resumed",
			ExecutionID: l.executionID,
			Status:      "running",
			Timestamp:   time.Now(),
		})
	case dag.PipelineNodeStart:
		node := p.CurrentNode()
		nodeID := ""
		if node != nil {
			nodeID = node.Id()
		}
		l.adapter.PushEvent(ExecutionEvent{
			Type:        "node_start",
			ExecutionID: l.executionID,
			NodeID:      nodeID,
			Timestamp:   time.Now(),
		})
	case dag.PipelineNodeFinish:
		node := p.CurrentNode()
		nodeID := ""
		if node != nil {
			nodeID = node.Id()
		}
		l.adapter.PushEvent(ExecutionEvent{
			Type:        "node_complete",
			ExecutionID: l.executionID,
			NodeID:      nodeID,
			Status:      "success",
			Timestamp:   time.Now(),
			Data: map[string]interface{}{
				"outputs": nodeOutputs(p.Metadata(), nodeID),
			},
		})
	case dag.PipelineNodeFailed:
		node := p.CurrentNode()
		nodeID := ""
		if node != nil {
			nodeID = node.Id()
		}
		l.adapter.PushEvent(ExecutionEvent{
			Type:        "node_complete",
			ExecutionID: l.executionID,
			NodeID:      nodeID,
			Status:      "failed",
			Timestamp:   time.Now(),
			Data: map[string]interface{}{
				"outputs": nodeOutputs(p.Metadata(), nodeID),
			},
		})
	}
}

// Events 返回订阅的事件列表
func (l *studioListener) Events() []dag.Event {
	return []dag.Event{
		dag.PipelineStart,
		dag.PipelineFinish,
		dag.PipelineNodeStart,
		dag.PipelineNodeFinish,
		dag.PipelineNodeFailed,
	}
}

// LogPusher 实现 logger.Pusher 接口
type LogPusher struct {
	mu          sync.RWMutex
	handlers    []func(entry logger.Entry)
	pipelineMap map[string]int64
}

// NewLogPusher 创建日志推送器
func NewLogPusher() *LogPusher {
	return &LogPusher{
		handlers:    make([]func(logger.Entry), 0),
		pipelineMap: make(map[string]int64),
	}
}

// RegisterPipeline 注册 pipeline ID 到 execution ID 的映射
func (p *LogPusher) RegisterPipeline(pipelineID string, execID int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pipelineMap[pipelineID] = execID
}

// Push 推送单条日志
func (p *LogPusher) Push(ctx context.Context, entry logger.Entry) error {
	p.mu.RLock()
	pipelineMap := make(map[string]int64, len(p.pipelineMap))
	for k, v := range p.pipelineMap {
		pipelineMap[k] = v
	}
	handlers := make([]func(logger.Entry), len(p.handlers))
	copy(handlers, p.handlers)
	p.mu.RUnlock()

	if execID, ok := pipelineMap[entry.Pipeline]; ok {
		entry.Pipeline = fmt.Sprintf("exec-%d", execID)
	}

	for _, h := range handlers {
		h(entry)
	}
	return nil
}

// PushBatch 批量推送
func (p *LogPusher) PushBatch(ctx context.Context, entries []logger.Entry) error {
	for _, entry := range entries {
		if err := p.Push(ctx, entry); err != nil {
			return err
		}
	}
	return nil
}

// Close 关闭
func (p *LogPusher) Close() error {
	return nil
}

// OnLog 注册日志回调
func (p *LogPusher) OnLog(handler func(entry logger.Entry)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.handlers = append(p.handlers, handler)
}

// UnregisterPipeline 解除 pipeline ID 映射（可选）
func (p *LogPusher) UnregisterPipeline(pipelineID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.pipelineMap, pipelineID)
}
