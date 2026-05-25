# 10. FlowX 核心库依赖评估与增强建议

## 10.1 评估范围

基于 FlowX 核心库现有代码（`github.com/LerkoX/flowx`），评估其公开接口对 flowx-studio 的支持程度。

评估涉及的关键文件：
- `runtime.go` / `runtime_impl.go` —— Runtime 接口与实现
- `dag/pipeline.go` / `dag/pipeline_impl.go` —— Pipeline 接口与实现
- `dag/pipeline_execution.go` —— 执行逻辑
- `dag/node.go` / `dag/node_impl.go` —— Node 接口与实现
- `logger/logger.go` —— 日志推送接口
- `core/config.go` / `core/const.go` —— 核心模型

## 10.2 接口能力逐项评估

### 10.2.1 Runtime 接口 —— 满足

```go
type Runtime interface {
    Get(id string) (dag.Pipeline, error)
    Cancel(ctx context.Context, id string) error
    RunAsync(ctx context.Context, id string, config string, listener dag.Listener) (dag.Pipeline, error)
    RunSync(ctx context.Context, id string, config string, listener dag.Listener) (dag.Pipeline, error)
    Rm(id string)
    Done() chan struct{}
    Notify(data interface{}) error
    Ctx() context.Context
    StopBackground()
    StartBackground()
    SetPusher(pusher logger.Pusher)
    SetTemplateEngine(engine template.TemplateEngine)
    GetTemplateEngine() template.TemplateEngine
    ExportConfig(id string) (string, error)
    Pause(ctx context.Context, id string) error
    Resume(ctx context.Context, id string) error
    ModifyGraph(ctx context.Context, id string, modifications dag.GraphModifications) error
    UpdateConfig(ctx context.Context, id string, newConfigYAML string) error
}
```

**评估结论**：Runtime 接口功能完善，满足 flowx-studio 对执行、取消、暂停、恢复、配置导出、动态修改的全部需求。

### 10.2.2 Pipeline 接口 —— 基本满足

```go
type Pipeline interface {
    Id() string
    GetGraph() Graph
    SetGraph(graph Graph)
    Status() string
    SetMetadata(store metadata.MetadataStore)
    Metadata() Metadata
    Listening(listener Listener)
    Done() <-chan struct{}
    Run(ctx context.Context) error
    Notify()
    Cancel()
    SetExecutorProvider(provider ExecutorProvider)
    SetTemplateEngine(engine template.TemplateEngine)
    GetTemplateEngine() template.TemplateEngine
    SetPusher(pusher logger.Pusher)
    Pause() error
    Resume(ctx context.Context) error
    IsModifiable() bool
}
```

**评估结论**：
- `GetGraph()` + 遍历节点可以获取完整图结构和节点状态 —— 满足
- `Status()` 返回流水线整体状态 —— 满足
- `Done()` 通知执行完成 —— 满足
- `Listening(Listener)` 事件监听 —— **缺少节点上下文，见 10.3.1**
- `Cancel/Pause/Resume` —— 满足

### 10.2.3 Node 接口 —— 满足

```go
type Node interface {
    Id() string
    PipelineId() string
    Status() string
    Get(key string) string
    Set(key string, value any)
    GetExecutor() string
    GetSteps() []core.Step
    GetConfig() map[string]any
    GetRuntimeStatus() *core.NodeRuntimeStatus
    SetRuntimeStatus(status *core.NodeRuntimeStatus)
    GetStepRuntimeStatus(stepName string) *core.StepRuntimeStatus
    SetStepRuntimeStatus(stepStatus *core.StepRuntimeStatus)
    EnsureIds()
}
```

**评估结论**：节点状态管理能力完善。`GetRuntimeStatus()` 返回的 `NodeRuntimeStatus` 包含：
- `Status` —— 节点状态
- `StartTime/EndTime` —— 起止时间
- `Steps` —— 步骤状态列表（含 `Output` 字段）
- `Executor` —— 执行器信息
- `Custom` —— 自定义扩展字段

完全满足 Web 层对节点状态监控的需求。

### 10.2.4 Listener 事件机制 —— **建议增强**

```go
type Listener interface {
    Handle(p Pipeline, event Event)
    Events() []Event
}
```

**现有事件类型**：
```go
PipelineInit                // 流水线初始化
PipelineStart               // 流水线开始执行
PipelineFinish              // 流水线完成
PipelineExecutorPrepare     // 流水线执行器开始准备
PipelineExecutorPrepareDone // 流水线执行器准备完毕
PipelineNodeStart           // 节点开始
PipelineNodeFinish          // 节点完成
PipelinePaused              // 流水线暂停
PipelineResumed             // 流水线恢复
PipelineGraphModified       // 图被修改
```

**问题分析**：

在 `pipeline_execution.go` 中：
```go
func (p *PipelineImpl) executeNodeWithLifecycle(ctx context.Context, node Node) error {
    // ...
    p.NotifyEvent(PipelineNodeStart)  // 未传入 node
    // ...
    p.NotifyEvent(PipelineNodeFinish) // 未传入 node
}
```

`NotifyEvent` 触发事件时**没有传入当前节点信息**，导致 Listener 的 `Handle` 方法只能收到 Pipeline 和 Event 类型，无法直接判断是哪个节点触发了事件。

**对 flowx-studio 的影响**：
- Web 层收到 `PipelineNodeStart` 时，需要遍历所有节点，对比前后状态变化来推断哪个节点开始执行 —— 效率低且不可靠
- 实时工作流图的状态高亮（节点变蓝/绿/红）需要精确的节点级事件

### 10.2.5 Logger Pusher —— 满足

```go
type Pusher interface {
    Push(ctx context.Context, entry Entry) error
    PushBatch(ctx context.Context, entries []Entry) error
    Close() error
}

type Entry struct {
    Pipeline  string    `json:"pipeline"`
    BuildID   string    `json:"buildId"`
    Node      string    `json:"node"`      // 节点ID
    Step      string    `json:"step"`      // 步骤名称
    Timestamp time.Time `json:"timestamp"`
    Level     Level     `json:"level"`
    Message   string    `json:"message"`
    Output    string    `json:"output"`    // 命令标准输出/错误
}
```

**评估结论**：`Entry` 包含 `Node` 和 `Step` 字段，flowx-studio 可通过自定义 Pusher 实现实时日志捕获和 SSE 推送。完全满足需求。

### 10.2.6 执行输出获取 —— 满足

节点执行输出通过两个途径获取：

1. **实时日志**：通过 `logger.Pusher` 的 `Entry.Output` 字段捕获
2. **结果输出**：通过 `NodeRuntimeStatus.Steps[].Output` 获取步骤输出摘要

**评估结论**：满足 Web 层对执行日志和输出结果展示的需求。

### 10.2.7 执行取消与超时 —— 满足

- `Runtime.Cancel()` 可取消运行中的流水线
- Pipeline 内部已检查 `ctx.Done()` 信号（见 `runLevelByLevel` 和 `executeNodeWithLifecycle`）
- flowx-studio 可通过 `context.WithTimeout` 控制执行超时

**评估结论**：满足需求，无需核心库增强。

## 10.3 建议增强项

### 10.3.1 【建议】Pipeline 接口新增 CurrentNode() 方法

**问题**：Listener 事件缺少节点上下文

**建议方案**（最小侵入式）：

在 `Pipeline` 接口中新增一个方法：

```go
type Pipeline interface {
    // 现有方法...
    
    // 新增：返回当前正在执行的节点（如有）
    CurrentNode() Node
}
```

在 `PipelineImpl` 中实现：

```go
func (p *PipelineImpl) CurrentNode() Node {
    p.mu.RLock()
    defer p.mu.RUnlock()
    return p.currentNode
}
```

在 `executeNodeWithLifecycle` 中设置：

```go
func (p *PipelineImpl) executeNodeWithLifecycle(ctx context.Context, node Node) error {
    p.mu.Lock()
    p.currentNode = node
    p.mu.Unlock()
    
    p.NotifyEvent(PipelineNodeStart)
    // ... 执行 ...
    p.NotifyEvent(PipelineNodeFinish)
    
    p.mu.Lock()
    p.currentNode = nil
    p.mu.Unlock()
    
    return nil
}
```

**flowx-studio 使用方式**：

```go
func (l *studioListener) Handle(p dag.Pipeline, event dag.Event) {
    switch event {
    case dag.PipelineNodeStart:
        node := p.CurrentNode()
        if node != nil {
            l.eventCh <- Event{
                Type:   "node_start",
                NodeID: node.Id(),
            }
        }
    case dag.PipelineNodeFinish:
        node := p.CurrentNode()
        if node != nil {
            l.eventCh <- Event{
                Type:   "node_complete",
                NodeID: node.Id(),
                Status: node.GetRuntimeStatus().Status,
            }
        }
    }
}
```

**影响范围**：新增方法，不影响现有接口的兼容性。

### 10.3.2 【可选】新增 PipelineNodeFailed 事件

**问题**：节点失败时只触发 `PipelineNodeFinish`，需要额外判断状态才能区分成功/失败

**建议**：在节点执行失败时单独触发 `PipelineNodeFailed` 事件：

```go
// dag/pipeline.go
var (
    // 现有事件...
    PipelineNodeFailed Event = core.EventPipelineNodeFailed // 节点执行失败
)
```

**优先级**：低，可通过 `PipelineNodeFinish` + 状态判断替代。

### 10.3.3 【可选】Runtime 接口新增 ListPipelines() 方法

**问题**：Runtime 内部维护了 `pipelines` map，但没有公开方法列出所有活跃的流水线

**建议**：

```go
type Runtime interface {
    // 现有方法...
    
    // 新增：列出所有活跃的流水线
    ListPipelines() []string
}
```

**优先级**：低，flowx-studio 可自行维护执行 ID 列表。

## 10.4 适配层实现策略

### 10.4.1 事件桥接（基于现有接口）

在核心库未增强前，flowx-studio 可通过以下策略处理节点事件：

**方案 A：状态对比法**

```go
type studioListener struct {
    eventCh       chan Event
    pipelineID    string
    prevNodeStates map[string]string // 记录上一轮节点状态
}

func (l *studioListener) Handle(p dag.Pipeline, event dag.Event) {
    switch event {
    case dag.PipelineNodeStart, dag.PipelineNodeFinish:
        // 遍历所有节点，对比状态变化
        graph := p.GetGraph()
        for nodeID, node := range graph.Nodes() {
            status := ""
            if rs := node.GetRuntimeStatus(); rs != nil {
                status = rs.Status
            }
            
            prevStatus := l.prevNodeStates[nodeID]
            if status != prevStatus {
                l.prevNodeStates[nodeID] = status
                l.eventCh <- Event{
                    Type:   "node_status_change",
                    NodeID: nodeID,
                    Status: status,
                }
            }
        }
    }
}
```

**缺点**：效率较低，每次事件触发都要遍历所有节点。

**方案 B：Pusher + 状态轮询法**

```go
// 1. 自定义 Pusher 捕获日志（已知 Node 字段）
type ssePusher struct {
    eventCh chan Event
}

func (p *ssePusher) Push(ctx context.Context, entry logger.Entry) error {
    p.eventCh <- Event{
        Type:   "node_log",
        NodeID: entry.Node,
        Level:  string(entry.Level),
        Message: entry.Message,
    }
    return nil
}

// 2. 定期轮询 Pipeline 状态
func (ra *RuntimeAdapter) pollPipelineStatus(pipelineID string) {
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()
    
    for range ticker.C {
        pipeline, err := ra.runtime.Get(pipelineID)
        if err != nil {
            return // 流水线已结束
        }
        
        // 遍历节点状态并推送变更
        for nodeID, node := range pipeline.GetGraph().Nodes() {
            status := ""
            if rs := node.GetRuntimeStatus(); rs != nil {
                status = rs.Status
            }
            // 推送状态...
        }
    }
}
```

**推荐**：采用方案 B 作为过渡方案，同时向 FlowX 核心库提交增强建议（10.3.1）。

## 10.5 版本兼容性矩阵

| flowx-studio 版本 | 依赖 FlowX 版本 | 兼容性说明 |
|-------------------|----------------|-----------|
| v0.1.0 | v1.2.0+ | 初始版本，使用过渡方案处理节点事件 |
| v0.2.0 | v1.3.0+ | 利用 FlowX 新增 `CurrentNode()` 接口，优化事件处理 |

## 10.6 向 FlowX 核心库提交的建议

建议以 Issue/PR 形式向 `github.com/LerkoX/flowx` 提交以下改进：

1. **Issue**: "Pipeline 接口缺少 CurrentNode() 方法，导致外部监听器无法识别事件关联的节点"
   - 说明使用场景（可视化工作流监控）
   - 提供建议的实现方案（10.3.1）
   - 强调向后兼容性（新增方法，不影响现有代码）

2. **PR**: 实现 `CurrentNode()` 方法
   - 修改 `dag/Pipeline` 接口
   - 在 `PipelineImpl` 中实现
   - 在 `executeNodeWithLifecycle` 中设置/清理
   - 添加单元测试
