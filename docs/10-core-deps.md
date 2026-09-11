# 10. FlowX 核心库依赖评估与增强建议

## 10.1 评估范围

基于 FlowX 核心库现有代码（`github.com/LerkoX/flowx`），评估其公开接口对 flowx-studio 的支持程度。

评估涉及的关键文件：
- `runtime.go` / `runtime_impl.go` —— Runtime 接口与实现
- `dag/workflow.go` / `dag/workflow_impl.go` —— Workflow 接口与实现
- `dag/workflow_execution.go` —— 执行逻辑
- `dag/node.go` / `dag/node_impl.go` —— Node 接口与实现
- `logger/logger.go` —— 日志推送接口
- `core/config.go` / `core/const.go` —— 核心模型

## 10.2 接口能力逐项评估

### 10.2.1 Runtime 接口 —— 满足

```go
type Runtime interface {
    Get(id string) (dag.Workflow, error)
    Cancel(ctx context.Context, id string) error
    RunAsync(ctx context.Context, id string, config string, listener dag.Listener) (dag.Workflow, error)
    RunSync(ctx context.Context, id string, config string, listener dag.Listener) (dag.Workflow, error)
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
    ListWorkflows() []string
}
```

**评估结论**：Runtime 接口功能完善，满足 flowx-studio 对执行、取消、暂停、恢复、配置导出、动态修改的全部需求。

### 10.2.2 Workflow 接口 —— 基本满足

```go
type Workflow interface {
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
    SetParam(param map[string]interface{})
    GetParam() Metadata
    Pause() error
    Resume(ctx context.Context) error
    IsModifiable() bool
    CurrentNode() Node
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
    WorkflowId() string
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
    Handle(p Workflow, event Event)
    Events() []Event
}

**现有事件类型**：
```go
WorkflowInit                // 流水线初始化
WorkflowStart               // 流水线开始执行
WorkflowFinish              // 流水线完成
WorkflowExecutorPrepare     // 流水线执行器开始准备
WorkflowExecutorPrepareDone // 流水线执行器准备完毕
WorkflowNodeStart           // 节点开始
WorkflowNodeFinish          // 节点完成
WorkflowNodeFailed          // 节点执行失败（新增）
WorkflowPaused              // 流水线暂停
WorkflowResumed             // 流水线恢复
WorkflowGraphModified       // 图被修改
```

**解决方案**：通过 `Workflow.CurrentNode()` 获取当前节点上下文

在 `workflow_execution.go` 中，`executeNodeWithLifecycle` 执行期间会在 Workflow 上设置当前节点：
```go
func (p *WorkflowImpl) executeNodeWithLifecycle(ctx context.Context, node Node) error {
    p.mu.Lock()
    p.currentNode = node
    p.mu.Unlock()
    
    p.NotifyEvent(WorkflowNodeStart)
    // ... 执行 ...
    p.NotifyEvent(WorkflowNodeFinish)
    
    p.mu.Lock()
    p.currentNode = nil
    p.mu.Unlock()
}
```

Listener 可通过 `p.CurrentNode()` 直接获取触发事件的节点：
```go
func (l *studioListener) Handle(p dag.Workflow, event dag.Event) {
    switch event {
    case dag.WorkflowNodeStart:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_start",
                NodeID: node.Id(),
            }
        }
    case dag.WorkflowNodeFinish:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_complete",
                NodeID: node.Id(),
                Status: node.GetRuntimeStatus().Status,
            }
        }
    case dag.WorkflowNodeFailed:
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
    Workflow  string    `json:"workflow"`
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
- Workflow 内部已检查 `ctx.Done()` 信号（见 `runLevelByLevel` 和 `executeNodeWithLifecycle`）
- flowx-studio 可通过 `context.WithTimeout` 控制执行超时

**评估结论**：满足需求，无需核心库增强。

## 10.3 已实现增强项 ✅

### 10.3.1 Workflow 接口新增 CurrentNode() 方法 —— **已实现**

**状态**：✅ 已在 `feat/studio-enhancements` 分支实现并合并

**实现文件**：
- `dag/workflow.go` —— Workflow 接口添加 `CurrentNode() Node`
- `dag/workflow_impl.go` —— WorkflowImpl 添加 `currentNode` 字段 + 线程安全实现
- `dag/workflow_execution.go` —— `executeNodeWithLifecycle` 中设置/清理

**验证**：通过单元测试 `TestCurrentNode_*`

**使用方式**：
```go
func (l *studioListener) Handle(p dag.Workflow, event dag.Event) {
    switch event {
    case dag.WorkflowNodeStart:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{Type: "node_start", NodeID: node.Id()}
        }
    case dag.WorkflowNodeFinish:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{Type: "node_complete", NodeID: node.Id()}
        }
    }
}
```

### 10.3.2 新增 WorkflowNodeFailed 事件 —— **已实现**

**状态**：✅ 已实现

**实现文件**：
- `core/const.go` —— 新增 `EventWorkflowNodeFailed = "workflow-node-failed"`
- `dag/workflow.go` —— 新增 `WorkflowNodeFailed` 事件变量
- `dag/workflow_execution.go` —— 节点执行失败时触发该事件

**使用方式**：
```go
case dag.WorkflowNodeFailed:
    if node := p.CurrentNode(); node != nil {
        l.eventCh <- Event{Type: "node_failed", NodeID: node.Id()}
    }
```

### 10.3.3 Runtime 接口新增 ListWorkflows() 方法 —— **已实现**

**状态**：✅ 已实现

**实现文件**：
- `runtime.go` —— Runtime 接口添加 `ListWorkflows() []string`
- `runtime_impl.go` —— RuntimeImpl 实现方法

**使用方式**：
```go
activeIDs := runtime.ListWorkflows()
for _, id := range activeIDs {
    workflow, _ := runtime.Get(id)
    fmt.Printf("Workflow %s status: %s\n", id, workflow.Status())
}
```

## 10.4 事件桥接实现策略

### 10.4.1 推荐方案：基于 CurrentNode() 的精确事件推送

由于核心库已增强 `CurrentNode()` 和 `WorkflowNodeFailed` 事件，flowx-studio 可直接采用精确事件方案：

```go
type studioListener struct {
    eventCh chan Event
}

func (l *studioListener) Handle(p dag.Workflow, event dag.Event) {
    switch event {
    case dag.WorkflowNodeStart:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_start",
                NodeID: node.Id(),
                Status: node.GetRuntimeStatus().Status,
            }
        }
    case dag.WorkflowNodeFinish:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_complete",
                NodeID: node.Id(),
                Status: node.GetRuntimeStatus().Status,
            }
        }
    case dag.WorkflowNodeFailed:
        if node := p.CurrentNode(); node != nil {
            l.eventCh <- Event{
                Type:   "node_failed",
                NodeID: node.Id(),
                Status: core.StatusFailed,
            }
        }
    case dag.WorkflowPaused:
        l.eventCh <- Event{Type: "workflow_paused"}
    case dag.WorkflowResumed:
        l.eventCh <- Event{Type: "workflow_resumed"}
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
| v0.1.0 | 伪版本 `v0.0.0-20260527104758-c693505dcf32`（`go.mod:8`），通过 `replace github.com/LerkoX/flowx => ../flowx`（`go.mod:5`）指向本地仓库 | 初始版本，直接使用 `CurrentNode()` 和 `WorkflowNodeFailed` 接口 |

> **注意**：FlowX 核心库目前**没有任何 git tag**，因此 go.mod 中记录的是基于提交时间的伪版本，而非此前预期的 `v1.3.0+`。flowx-studio 通过 `replace` 指令依赖本地 `../flowx` 目录，增强功能（`CurrentNode()`、`WorkflowNodeFailed`、`ListWorkflows()`）均已包含在该本地代码中，无需过渡方案。

## 10.6 实现记录

所有增强功能已在 `github.com/LerkoX/flowx` 的 `feat/studio-enhancements` 分支实现并验证：

### 已实现功能清单

| # | 功能 | 状态 | 验证 |
|---|------|------|------|
| 1 | `Workflow.CurrentNode()` | ✅ 已合并 | `TestCurrentNode_*` |
| 2 | `WorkflowNodeFailed` 事件 | ✅ 已合并 | `TestWorkflowNodeFailed_*` |
| 3 | `Runtime.ListWorkflows()` | ✅ 已合并 | `TestListWorkflows_*` |

### 相关提交

- **分支**: `feat/studio-enhancements`
- **修改文件**:
  - `dag/workflow.go` —— 接口扩展
  - `dag/workflow_impl.go` —— `currentNode` 字段 + 实现
  - `dag/workflow_execution.go` —— 生命周期中设置/清理
  - `core/const.go` —— 新增事件常量
  - `runtime.go` —— 接口扩展
  - `runtime_impl.go` —— `ListWorkflows()` 实现
  - `dag/workflow_studio_test.go` —— 新增测试（新增文件）
  - `runtime_test.go` —— 新增测试

### 向后兼容性

所有增强均为**新增接口/方法**，不修改现有接口签名，完全向后兼容。现有代码无需任何调整。
