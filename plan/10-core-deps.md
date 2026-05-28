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

### 10.2.4 Listener 事件机制 —— **已增强** ✅

type Listener interface {
    Handle(p Pipeline, event Event)
    Events() []Event
}

**现有事件类型**：
```go
PipelineInit                // 流水线初始化
PipelineStart               // 流水线开始执行
PipelineFinish              // 流水线完成
PipelineExecutorPrepare     // 流水线执行器开始准备
PipelineExecutorPrepareDone // 流水线执行器准备完毕
PipelineNodeStart           // 节点开始
PipelineNodeFinish          // 节点完成
PipelineNodeFailed          // 节点执行失败（新增）
PipelinePaused              // 流水线暂停
PipelineResumed             // 流水线恢复
PipelineGraphModified       // 图被修改
```

**解决方案**：通过 `Pipeline.CurrentNode()` 获取当前节点上下文

在 `pipeline_execution.go` 中，`executeNodeWithLifecycle` 执行期间会在 Pipeline 上设置当前节点：
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
}
```

Listener 可通过 `p.CurrentNode()` 直接获取触发事件的节点：
```go
func (l *studioListener) Handle(p dag.Pipeline, event dag.Event) {
    switch event {
    case dag.PipelineNodeStart:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_start",
                NodeID: node.Id(),
            }
        }
    case dag.PipelineNodeFinish:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_complete",
                NodeID: node.Id(),
                Status: node.GetRuntimeStatus().Status,
            }
        }
    case dag.PipelineNodeFailed:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_failed",
                NodeID: node.Id(),
            }
        }
    }
}
```

**评估结论**：通过 `CurrentNode()` 接口，Listener 可精确获取事件关联的节点，无需遍历全图。完全满足 flowx-studio 的节点级事件需求。

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

## 10.3 已实现增强项 ✅

### 10.3.1 Pipeline 接口新增 CurrentNode() 方法 —— **已实现**

**状态**：✅ 已在 `feat/studio-enhancements` 分支实现并合并

**实现文件**：
- `dag/pipeline.go` —— Pipeline 接口添加 `CurrentNode() Node`
- `dag/pipeline_impl.go` —— PipelineImpl 添加 `currentNode` 字段 + 线程安全实现
- `dag/pipeline_execution.go` —— `executeNodeWithLifecycle` 中设置/清理

**验证**：通过单元测试 `TestCurrentNode_*`

**使用方式**：
```go
func (l *studioListener) Handle(p dag.Pipeline, event dag.Event) {
    switch event {
    case dag.PipelineNodeStart:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{Type: "node_start", NodeID: node.Id()}
        }
    case dag.PipelineNodeFinish:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{Type: "node_complete", NodeID: node.Id()}
        }
    }
}
```

### 10.3.2 新增 PipelineNodeFailed 事件 —— **已实现**

**状态**：✅ 已实现

**实现文件**：
- `core/const.go` —— 新增 `EventPipelineNodeFailed = "pipeline-node-failed"`
- `dag/pipeline.go` —— 新增 `PipelineNodeFailed` 事件变量
- `dag/pipeline_execution.go` —— 节点执行失败时触发该事件

**使用方式**：
```go
case dag.PipelineNodeFailed:
    if node := p.CurrentNode(); node != nil {
        l.eventCh <- Event{Type: "node_failed", NodeID: node.Id()}
    }
```

### 10.3.3 Runtime 接口新增 ListPipelines() 方法 —— **已实现**

**状态**：✅ 已实现

**实现文件**：
- `runtime.go` —— Runtime 接口添加 `ListPipelines() []string`
- `runtime_impl.go` —— RuntimeImpl 实现方法

**使用方式**：
```go
activeIDs := runtime.ListPipelines()
for _, id := range activeIDs {
    pipeline, _ := runtime.Get(id)
    fmt.Printf("Pipeline %s status: %s\n", id, pipeline.Status())
}
```

## 10.4 事件桥接实现策略

### 10.4.1 推荐方案：基于 CurrentNode() 的精确事件推送

由于核心库已增强 `CurrentNode()` 和 `PipelineNodeFailed` 事件，flowx-studio 可直接采用精确事件方案：

```go
type studioListener struct {
    eventCh chan Event
}

func (l *studioListener) Handle(p dag.Pipeline, event dag.Event) {
    switch event {
    case dag.PipelineNodeStart:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_start",
                NodeID: node.Id(),
                Status: node.GetRuntimeStatus().Status,
            }
        }
    case dag.PipelineNodeFinish:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_complete",
                NodeID: node.Id(),
                Status: node.GetRuntimeStatus().Status,
            }
        }
    case dag.PipelineNodeFailed:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_failed",
                NodeID: node.Id(),
                Status: core.StatusFailed,
            }
        }
    case dag.PipelinePaused:
        l.eventCh <- Event{Type: "pipeline_paused"}
    case dag.PipelineResumed:
        l.eventCh <- Event{Type: "pipeline_resumed"}
    }
}
```

**优势**：
- 无需遍历全图，O(1) 获取当前节点
- 精确的节点级事件，支持实时状态高亮
- 原生支持失败事件，无需状态推断

## 10.5 版本兼容性矩阵

| flowx-studio 版本 | 依赖 FlowX 版本 | 兼容性说明 |
|-------------------|----------------|-----------|
| v0.1.0 | v1.3.0+ | 初始版本，直接使用 `CurrentNode()` 和 `PipelineNodeFailed` 接口 |

> **注意**：所有增强功能已合并到 FlowX 主分支，flowx-studio v0.1.0 可直接依赖最新版本，无需过渡方案。

## 10.6 实现记录

所有增强功能已在 `github.com/LerkoX/flowx` 的 `feat/studio-enhancements` 分支实现并验证：

### 已实现功能清单

| # | 功能 | 状态 | 验证 |
|---|------|------|------|
| 1 | `Pipeline.CurrentNode()` | ✅ 已合并 | `TestCurrentNode_*` |
| 2 | `PipelineNodeFailed` 事件 | ✅ 已合并 | `TestPipelineNodeFailed_*` |
| 3 | `Runtime.ListPipelines()` | ✅ 已合并 | `TestListPipelines_*` |

### 相关提交

- **分支**: `feat/studio-enhancements`
- **修改文件**:
  - `dag/pipeline.go` —— 接口扩展
  - `dag/pipeline_impl.go` —— `currentNode` 字段 + 实现
  - `dag/pipeline_execution.go` —— 生命周期中设置/清理
  - `core/const.go` —— 新增事件常量
  - `runtime.go` —— 接口扩展
  - `runtime_impl.go` —— `ListPipelines()` 实现
  - `dag/pipeline_studio_test.go` —— 新增测试（新增文件）
  - `runtime_test.go` —— 新增测试

### 向后兼容性

所有增强均为**新增接口/方法**，不修改现有接口签名，完全向后兼容。现有代码无需任何调整。
