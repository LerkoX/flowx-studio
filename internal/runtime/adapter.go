package runtime

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/LerkoX/flowx"
	"github.com/LerkoX/flowx/dag"
	"github.com/LerkoX/flowx/logger"
)

// Adapter FlowX 运行时适配器
type Adapter struct {
	runtime   flowx.Runtime
	eventCh   chan ExecutionEvent
	logPusher *LogPusher
	mu        sync.RWMutex
}

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

// ExecuteWorkflow 执行工作流
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

// Handle 处理事件
func (l *studioListener) Handle(p dag.Pipeline, event dag.Event) {
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
