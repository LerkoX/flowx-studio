# 6. AI 服务层设计

## 6.1 设计目标

- **多提供商支持**：统一接口封装 OpenAI、Anthropic、Ollama 等
- **模型能力抽象**：自动识别模型能力（函数调用、JSON 模式等）
- **Prompt 工程**：标准化 Prompt 模板，确保 AI 输出符合 FlowX 规范
- **容错机制**：重试、降级、超时控制
- **流式响应**：支持 SSE 流式输出，提升用户体验

## 6.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Service Layer                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    AIService                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │  │
│  │  │ NodeGenerator│  │WorkflowGen   │  │  ChatService│  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Provider Interface                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │  │
│  │  │  OpenAI  │ │Anthropic │ │  Ollama  │ │  Custom  │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Prompt Engine                       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │  │
│  │  │   Templates  │  │  Variables   │  │   Parser    │  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 6.3 Provider 接口设计

```go
// Provider 是所有 AI 提供商的通用接口
type Provider interface {
    // 基本信息
    Name() string
    AvailableModels() []ModelInfo
    
    // 核心能力
    Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)
    ChatStream(ctx context.Context, req ChatRequest) (StreamIterator, error)
    
    // 健康检查
    HealthCheck(ctx context.Context) error
}

type ModelInfo struct {
    Name                  string
    DisplayName           string
    MaxContextLength      int
    SupportsFunctionCall  bool
    SupportsJSONMode      bool
    SupportsVision        bool
    MaxOutputTokens       int
}

type ChatRequest struct {
    Model       string
    Messages    []Message
    Temperature float64
    MaxTokens   int
    JSONMode    bool  // 要求返回 JSON 格式
}

type Message struct {
    Role    string // system | user | assistant
    Content string
}

type ChatResponse struct {
    Content      string
    Usage        TokenUsage
    FinishReason string
}

type StreamIterator interface {
    Next() (StreamChunk, error)
    Close() error
}

type StreamChunk struct {
    Content string
    Done    bool
}
```

## 6.4 提供商实现

### 6.4.1 OpenAI Provider

```go
type OpenAIProvider struct {
    apiKey   string
    baseURL  string // 支持自定义代理地址
    client   *http.Client
}

func (p *OpenAIProvider) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
    // 构建 OpenAI 格式的请求
    // 调用 /v1/chat/completions
    // 解析响应为通用 ChatResponse
}

func (p *OpenAIProvider) ChatStream(ctx context.Context, req ChatRequest) (StreamIterator, error) {
    // 调用 /v1/chat/completions?stream=true
    // 返回 SSE 流迭代器
}
```

### 6.4.2 Anthropic Provider

```go
type AnthropicProvider struct {
    apiKey  string
    baseURL string
    client  *http.Client
}

// Anthropic API 格式与 OpenAI 不同，需要转换：
// - messages 格式差异
// - system prompt 位置不同
// - 响应结构差异
// 在 Provider 内部完成所有转换，对外暴露统一接口
```

### 6.4.3 Ollama Provider

```go
type OllamaProvider struct {
    baseURL string // 默认 http://localhost:11434
    client  *http.Client
}

// Ollama 特点：
// - 本地运行，无需 API Key
// - 模型需要预先拉取
// - API 兼容 OpenAI 格式（/api/chat）
// - 支持流式响应
```

## 6.5 Prompt 工程

### 6.5.1 节点生成 Prompt

```markdown
你是一个 FlowX 节点开发专家。FlowX 是一个工作流引擎，节点是可复用的执行单元。

## 任务
根据用户描述，生成一个符合 FlowX 规范的节点。

## 节点规范
1. **输入**：节点通过环境变量接收参数，参数名使用大写+下划线格式，如 `URL`、`TIMEOUT`
2. **输出**：节点将结果输出到 stdout，使用 JSON 格式
3. **错误**：错误信息输出到 stderr，进程 exit code 非 0
4. **语言**：支持 Python、Go、Bash 等

## 输出格式
必须以 JSON 格式返回，包含以下字段：
- name: 节点名称（蛇形命名，如 image_downloader）
- description: 节点描述
- language: 编程语言
- parameters: 参数列表，每个参数包含 name, type, description, required, default
- code: 完整实现代码
- mock_code: Mock 测试代码（不依赖外部服务，返回模拟数据）

## 用户描述
{{user_description}}

## 上下文
{{context}}

请生成节点：
```

### 6.5.2 工作流生成 Prompt

```markdown
你是一个工作流编排专家。FlowX 使用 YAML 配置定义工作流，图结构使用 Mermaid stateDiagram-v2 语法。

## 可用节点
{{available_nodes}}

## 用户需求
{{user_description}}

## 输出要求
1. 生成完整的 FlowX YAML 配置
2. 如果现有节点不够用，列出需要新建的节点
3. 图结构必须正确，使用 Mermaid stateDiagram-v2 语法
4. 节点配置必须引用正确的参数

## YAML 结构示例
```yaml
name: workflow_name
version: "1.0"
graph: |
  stateDiagram-v2
    [*] --> node1
    node1 --> node2
    node2 --> [*]
nodes:
  node1:
    steps:
      - name: step1
        executor: local
        commands:
          - python {{.node.code}}
```

请生成工作流配置：
```

### 6.5.3 对话 Prompt

```markdown
你是 FlowX AI 助手，一个帮助用户创建和管理工作流的智能助手。

## 能力
1. 理解用户的自动化需求
2. 生成可复用的工作流节点
3. 编排复杂的工作流
4. 诊断和修复工作流错误

## 原则
1. 主动询问缺失的关键信息
2. 提供清晰的操作建议
3. 如果用户描述模糊，给出示例帮助澄清
4. 保持对话简洁，聚焦工作流主题

## 当前上下文
{{context}}

用户消息：{{user_message}}
```

## 6.6 高阶服务封装

### 6.6.1 NodeGenerator

```go
type NodeGenerator struct {
    aiService *AIService
    nodeRepo  db.NodeRepository
}

// GenerateNode 根据用户描述生成节点
func (g *NodeGenerator) GenerateNode(ctx context.Context, description string, opts GenerateOptions) (*db.Node, error) {
    // 1. 组装 Prompt（包含节点规范和上下文）
    prompt := g.buildPrompt(description, opts)
    
    // 2. 调用 AI，要求 JSON 模式输出
    response, err := g.aiService.Chat(ctx, ChatRequest{
        Messages: []Message{{Role: "user", Content: prompt}},
        JSONMode: true,
    })
    
    // 3. 解析 JSON 响应
    var nodeData GeneratedNode
    if err := json.Unmarshal([]byte(response.Content), &nodeData); err != nil {
        return nil, fmt.Errorf("parse node data failed: %w", err)
    }
    
    // 4. 验证节点数据完整性
    if err := g.validateNode(nodeData); err != nil {
        return nil, fmt.Errorf("validate node failed: %w", err)
    }
    
    // 5. 保存到数据库
    node := &db.Node{
        Name:        nodeData.Name,
        Description: nodeData.Description,
        Language:    nodeData.Language,
        Code:        nodeData.Code,
        MockCode:    nodeData.MockCode,
        Parameters:  nodeData.Parameters,
    }
    
    if err := g.nodeRepo.Create(ctx, node); err != nil {
        return nil, fmt.Errorf("save node failed: %w", err)
    }
    
    return node, nil
}
```

### 6.6.2 WorkflowGenerator

```go
type WorkflowGenerator struct {
    aiService     *AIService
    nodeRepo      db.NodeRepository
    workflowRepo  db.WorkflowRepository
}

// GenerateWorkflow 根据用户描述生成工作流
func (g *WorkflowGenerator) GenerateWorkflow(ctx context.Context, description string, opts GenerateOptions) (*db.Workflow, error) {
    // 1. 获取所有可用节点作为上下文
    nodes, _ := g.nodeRepo.List(ctx)
    
    // 2. 组装 Prompt
    prompt := g.buildPrompt(description, nodes, opts)
    
    // 3. 调用 AI 生成
    response, err := g.aiService.Chat(ctx, ChatRequest{
        Messages: []Message{{Role: "user", Content: prompt}},
        JSONMode: false, // YAML 不是 JSON
    })
    
    // 4. 从响应中提取 YAML
    yamlConfig := g.extractYAML(response.Content)
    
    // 5. 验证 YAML 结构
    if err := g.validateYAML(yamlConfig); err != nil {
        return nil, fmt.Errorf("validate yaml failed: %w", err)
    }
    
    // 6. 保存工作流
    workflow := &db.Workflow{
        Name:       g.generateName(description),
        Description: description,
        YAMLConfig: yamlConfig,
        Status:     "draft",
    }
    
    if err := g.workflowRepo.Create(ctx, workflow); err != nil {
        return nil, fmt.Errorf("save workflow failed: %w", err)
    }
    
    return workflow, nil
}
```

## 6.7 容错与优化

### 6.7.1 重试机制

```go
type RetryConfig struct {
    MaxRetries  int
    BaseDelay   time.Duration
    MaxDelay    time.Duration
    Multiplier  float64
}

func (p *BaseProvider) callWithRetry(ctx context.Context, fn func() error) error {
    var lastErr error
    delay := p.retryConfig.BaseDelay
    
    for i := 0; i <= p.retryConfig.MaxRetries; i++ {
        if err := fn(); err != nil {
            lastErr = err
            
            // 判断是否需要重试
            if !isRetryable(err) {
                return err
            }
            
            // 指数退避
            if i < p.retryConfig.MaxRetries {
                time.Sleep(delay)
                delay = min(time.Duration(float64(delay)*p.retryConfig.Multiplier), p.retryConfig.MaxDelay)
            }
        } else {
            return nil
        }
    }
    
    return fmt.Errorf("max retries exceeded: %w", lastErr)
}
```

### 6.7.2 故障转移

```go
type AIService struct {
    providers []Provider
    // 按优先级排序，主模型在前
}

func (s *AIService) Chat(ctx context.Context, req ChatRequest) (ChatResponse, error) {
    for _, provider := range s.providers {
        if !provider.IsEnabled() {
            continue
        }
        
        resp, err := provider.Chat(ctx, req)
        if err == nil {
            return resp, nil
        }
        
        // 记录失败，尝试下一个提供商
        log.Printf("Provider %s failed: %v", provider.Name(), err)
    }
    
    return ChatResponse{}, fmt.Errorf("all providers failed")
}
```

### 6.7.3 流式响应处理

```go
func (s *AIService) ChatStream(ctx context.Context, req ChatRequest, onChunk func(string)) error {
    iterator, err := s.primaryProvider.ChatStream(ctx, req)
    if err != nil {
        return err
    }
    defer iterator.Close()
    
    for {
        chunk, err := iterator.Next()
        if err != nil {
            return err
        }
        
        if chunk.Done {
            break
        }
        
        onChunk(chunk.Content)
    }
    
    return nil
}
```

## 6.8 AI 配置管理

### 6.8.1 配置模型

```go
type AIConfig struct {
    ID           int64
    Provider     string  // openai | anthropic | ollama
    Name         string  // 用户自定义名称
    Model        string  // 模型名称
    APIKey       string  // 加密存储
    BaseURL      string  // 自定义地址
    Temperature  float64
    MaxTokens    int
    IsActive     bool    // 是否为默认配置
    IsEnabled    bool    // 是否启用
    Capabilities string  // JSON 模型能力
}
```

### 6.8.2 配置优先级

1. 用户显式指定的配置
2. `is_active = true` 的默认配置
3. 第一个启用的配置
4. 本地 Ollama（如果可用）

### 6.8.3 API Key 加密

使用 AES-GCM 加密存储 API Key：

```go
// 加密密钥从环境变量或系统密钥链获取
var encryptionKey = os.Getenv("FLOWX_ENCRYPTION_KEY")

func encryptAPIKey(key string) (string, error) {
    block, err := aes.NewCipher([]byte(encryptionKey))
    if err != nil {
        return "", err
    }
    
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }
    
    nonce := make([]byte, gcm.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return "", err
    }
    
    ciphertext := gcm.Seal(nonce, nonce, []byte(key), nil)
    return base64.StdEncoding.EncodeToString(ciphertext), nil
}
```

## 6.9 监控与日志

### 6.9.1 AI 调用日志

记录每次 AI 调用的关键信息：

```sql
CREATE TABLE ai_call_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    operation       TEXT NOT NULL,        -- generate_node | generate_workflow | chat
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    latency_ms      INTEGER,
    success         BOOLEAN,
    error_message   TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 6.9.2 性能指标

监控以下指标：
- AI 调用延迟（P50、P95、P99）
- Token 使用量
- 生成成功率
- 各提供商可用性

## 6.10 安全考虑

1. **API Key 保护**：加密存储，不在日志中明文输出
2. **输入过滤**：对用户输入进行基本的 XSS 和注入过滤
3. **输出验证**：AI 生成的代码在存储前进行语法验证
4. **沙箱执行**：Mock 测试在隔离环境运行，防止恶意代码
5. **速率限制**：对 AI 调用进行速率限制，防止滥用

## 6.11 业务逻辑流程

### 6.11.1 概述

FlowX Studio 的核心交互模式是**对话式配置**：用户通过与 AI 助手自然语言对话，完成节点生成、工作流编排、执行监控等所有操作。整个过程中**不提供传统的手动配置界面**。

### 6.11.2 节点生成的业务流

#### 正常流程

```
用户输入需求
    │
    ▼
[AI 理解]
  ├── 识别：用户想要创建什么类型的节点
  ├── 识别：需要什么编程语言
  └── 识别：需要什么参数
    │
    ▼
[Prompt 组装]
  ├── 系统提示词（FlowX 节点规范）
  ├── 用户需求原文
  ├── 上下文（可用节点列表、当前工作流）
  └── 约束条件（必须提供 Mock 代码）
    │
    ▼
[AI 生成节点代码]
  ├── 节点名称（蛇形命名）
  ├── 节点描述
  ├── 参数定义（JSON Schema）
  ├── 实现代码（Python/Go/Bash）
  └── Mock 测试代码
    │
    ▼
[后端验证]
  ├── 语法检查（代码能否解析）
  ├── 规范检查（是否符合 FlowX 输入输出规范）
  └── 安全扫描（是否有危险操作）
    │
    ▼
[保存到节点注册中心]
    │
    ▼
[前端展示]
  ├── 节点参数面板
  ├── 代码查看器（Monaco）
  └── [Mock 测试] 按钮
    │
    ▼
用户点击 [Mock 测试]
    │
    ▼
[Mock 执行]
  ├── 在隔离环境运行 Mock 代码
  ├── 返回模拟结果
  └── 展示执行日志和输出
    │
    ▼
用户确认（通过对话或点击按钮）
    │
    ▼
[节点可用]
  └── 可被工作流引用
```

#### 异常流程

**场景 1：AI 生成失败**
```
AI 生成 → 返回格式不符合 JSON 规范
    │
    ▼
[后端解析失败]
    │
    ▼
[自动重试]（最多 3 次）
    │
    ├── 成功 → 继续正常流程
    └── 失败 → 返回错误给用户
              "AI 生成节点时遇到了问题，请重试或调整描述"
```

**场景 2：Mock 测试失败**
```
用户点击 [Mock 测试]
    │
    ▼
[Mock 执行失败]
  ├── 代码语法错误
  ├── 缺少依赖
  └── 运行时异常
    │
    ▼
[前端展示错误信息]
    │
    ▼
用户选择：
  ├── [让 AI 修复] → AI 分析错误并重新生成代码
  └── [手动修改]（仅查看代码，不编辑，用户通过对话告诉 AI 修改意见）
```

**场景 3：用户描述模糊**
```
用户："帮我做个下载东西的节点"
    │
    ▼
[AI 识别：信息不足]
    │
    ▼
[AI 追问]
  "好的！为了生成准确的节点，我需要确认几个信息：
   1. 你要下载什么类型的东西？（图片、文件、网页？）
   2. 从哪个来源下载？（URL、API、云存储？）
   3. 用什么编程语言实现？（Python/Go/Bash）"
    │
    ▼
用户补充信息
    │
    ▼
[继续生成流程]
```

### 6.11.3 工作流生成的业务流

#### 正常流程

```
用户输入需求
    │
    ▼
[AI 理解]
  ├── 识别：工作流目标
  ├── 识别：需要哪些步骤
  └── 识别：步骤之间的依赖关系
    │
    ▼
[检查节点注册中心]
  ├── 分析现有可用节点
  ├── 匹配需求所需的节点
  └── 识别缺失的节点
    │
    ├── 所有节点都已存在 → 直接进入编排
    └── 有缺失节点
          │
          ▼
    [询问用户]
      "我发现缺少以下节点：xxx_downloader、yyy_compressor。
       需要我帮你生成这些节点吗？"
          │
          ├── 用户同意 → 递归执行【节点生成流程】
          └── 用户拒绝 → 仅使用现有节点编排
    │
    ▼
[编排工作流]
  ├── 确定节点执行顺序（DAG）
  ├── 确定数据传递方式
  ├── 生成 Mermaid stateDiagram-v2 图定义
  └── 生成 FlowX YAML 配置
    │
    ▼
[后端验证]
  ├── YAML 语法检查
  ├── 图结构合法性（无环或有合法回边）
  ├── 节点引用检查（引用的节点是否都存在）
  └── 参数传递检查
    │
    ▼
[保存工作流]
    │
    ▼
[前端展示]
  ├── 右侧渲染工作流图（ReactFlow）
  ├── 左侧 AI 返回操作按钮：
  │     [查看YAML] [Mock测试] [立即运行]
  └── 用户可点击节点查看详情
    │
    ▼
用户选择操作
    │
    ├── [查看YAML] → 展示/复制 YAML 配置
    ├── [Mock测试] → 使用各节点 Mock 代码串联执行
    └── [立即运行] → 正式执行工作流
```

#### 多轮迭代流程

```
第一轮：生成初版工作流
    │
    ▼
用户查看后提出修改
  "把压缩节点改成支持多种格式"
    │
    ▼
[AI 理解修改需求]
    │
    ▼
[更新工作流]
  ├── 修改节点参数
  ├── 或生成新节点替换旧节点
  └── 更新 YAML 配置
    │
    ▼
[展示更新后的工作流]
    │
    ▼
用户满意 → 保存并运行
    │
    或继续迭代修改...
```

### 6.11.4 对话交互的业务流

#### 核心原则

AI 助手不是简单的问答机器人，而是**主动的工作流构建搭档**。它会：
1. **主动询问**：发现信息缺失时主动追问
2. **主动建议**：根据上下文推荐下一步操作
3. **主动诊断**：执行失败时主动分析原因并给出修复方案

#### 对话状态机

```
                    ┌─────────────────┐
                    │   等待用户输入   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐ ┌──────────┐ ┌──────────────┐
    │   生成节点意图   │ │生成工作流 │ │   执行意图    │
    │  (node_generate) │ │意图      │ │(run_workflow)│
    └────────┬────────┘ └────┬─────┘ └──────┬───────┘
             │               │              │
             ▼               ▼              ▼
    ┌─────────────────┐ ┌──────────┐ ┌──────────────┐
    │   节点生成流程   │ │工作流生成│ │   执行流程    │
    └────────┬────────┘ └────┬─────┘ └──────┬───────┘
             │               │              │
             └───────────────┼──────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  展示结果+操作按钮 │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐ ┌──────────┐ ┌──────────────┐
    │   用户确认完成   │ │ 用户修改  │ │  用户执行    │
    │   (结束对话)    │ │ (重新生成)│ │  (运行/Mock) │
    └─────────────────┘ └──────────┘ └──────────────┘
```

#### 意图识别

AI 需要识别用户的意图类型：

| 意图类型 | 关键词/模式 | 示例 |
|---------|-----------|------|
| **生成节点** | "创建节点"、"生成"、"做个...功能" | "帮我做一个下载图片的节点" |
| **生成工作流** | "工作流"、"流水线"、"流程" | "做一个图片处理工作流" |
| **修改现有** | "修改"、"改成"、"替换" | "把压缩节点改成 WebP 格式" |
| **执行** | "运行"、"执行"、"测试" | "运行这个工作流" |
| **诊断** | "为什么失败"、"报错"、"错误" | "为什么上传节点失败了？" |
| **查询** | "查看"、"显示"、"是什么" | "查看所有可用节点" |

#### 多轮对话的上下文维护

```
对话轮次 1
  用户："帮我做一个图片处理工作流"
  AI："好的！我为你生成了一个包含下载→压缩→上传的工作流。
       [查看工作流] [Mock测试]"
    │
    ▼
对话轮次 2（引用上轮上下文）
  用户："把压缩改成支持 WebP"
  AI：识别到"修改工作流"意图
      找到上轮生成的 "image_processing" 工作流
      修改 compress 节点参数
      更新工作流 YAML
      "已更新！压缩节点现在支持 WebP 格式。
       [查看更新] [重新Mock测试]"
    │
    ▼
对话轮次 3（引用上轮上下文）
  用户："运行"
  AI：识别到"执行工作流"意图
      找到当前活跃工作流 "image_processing"
      触发执行
      "正在执行..."
      [实时推送执行状态]
```

### 6.11.5 执行与监控的业务流

#### 工作流执行流程

```
用户点击 [立即运行] 或发送"运行"
    │
    ▼
[前端发送请求]
  POST /api/v1/workflows/{id}/run
    │
    ▼
[后端处理]
  ├── 从数据库读取工作流 YAML
  ├── 调用 FlowX RuntimeAdapter
  ├── 注册事件监听器
  └── 启动异步执行
    │
    ▼
[SSE 实时推送]
  event: execution_start
    data: {"execution_id": 42, "timestamp": "..."}
    │
  event: node_start
    data: {"node_id": "download", "timestamp": "..."}
    │
  event: node_log
    data: {"node_id": "download", "level": "info", "message": "开始下载..."}
    │
  event: node_complete
    data: {"node_id": "download", "status": "success", "duration_ms": 30000}
    │
  ...（后续节点）
    │
  event: execution_complete
    data: {"execution_id": 42, "status": "success", "result": {...}}
    │
    ▼
[前端更新]
  ├── 工作流图节点变色（运行中→成功/失败）
  ├── 执行日志实时追加
  └── 结果展示面板弹出
    │
    ▼
用户查看结果
  ├── 成功 → AI 返回："工作流执行成功！结果已保存到..."
  └── 失败 → AI 自动诊断：
        "upload 节点失败了，错误是...需要我帮你修复吗？"
        [让 AI 修复] [查看详细日志]
```

#### Mock 测试流程

```
用户点击 [Mock 测试] 或发送"Mock测试"
    │
    ▼
[前端发送请求]
  POST /api/v1/workflows/{id}/mock
    │
    ▼
[后端处理]
  ├── 解析工作流 YAML，提取所有节点
  ├── 按执行顺序遍历节点
  ├── 对每个节点：
  │     ├── 读取节点的 mock_code
  │     ├── 在隔离环境运行（Docker 或受限进程）
  │     ├── 收集 Mock 输出
  │     └── 将输出作为参数传递给下游节点
  └── 返回完整的 Mock 执行结果
    │
    ▼
[前端展示]
  ├── 每个节点的 Mock 输出
  ├── 数据传递链路可视化
  └── Mock 执行日志
    │
    ▼
用户判断
  ├── Mock 结果符合预期 → "好的，工作流没问题"
  └── Mock 结果不符合 → "xxx 节点的输出格式不对"
        │
        ▼
        [AI 分析]
          ├── 识别问题节点
          ├── 分析问题原因
          └── 重新生成该节点代码
```

### 6.11.6 异常处理的业务流

#### 生成超时

```
AI 生成请求超时（默认 60 秒）
    │
    ▼
[前端展示]
  "AI 生成时间较长，请稍候..."
    │
    ▼
超过 60 秒
    │
    ▼
[后端返回 504 超时]
    │
    ▼
[前端处理]
  ├── 展示："生成超时了，可能是因为需求比较复杂。
  │     建议：
  │     1. 将需求拆分成更小的部分
  │     2. 使用更强大的 AI 模型（如 GPT-4）
  │     3. 重试一次"
  └── 提供 [重试] 按钮
```

#### AI 理解错误

```
用户："帮我做个工作流，每天要自动备份"
    │
    ▼
[AI 误解]
  生成了一个"数据备份"节点，但用户其实想要的是"数据库备份工作流"
    │
    ▼
用户："不是这个意思，我说的是数据库备份"
    │
    ▼
[AI 纠正]
  ├── 道歉并确认正确理解
  ├── 重新生成符合需求的内容
  └── "抱歉理解错了！我重新为你生成数据库备份工作流..."
    │
    ▼
[覆盖之前的生成结果]
  └── 用新的工作流替换旧的工作流
```

#### 依赖缺失

```
用户："做一个 OCR 识别图片文字的工作流"
    │
    ▼
[AI 分析]
  需要节点：image_loader、ocr_processor、text_exporter
  发现 ocr_processor 不存在
    │
    ▼
[AI 决策]
  ├── 询问用户："需要我先生成 OCR 处理节点吗？"
  └── 或自动生成（如果用户之前设置过"自动补全缺失节点"）
    │
    ▼
用户同意
    │
    ▼
[先执行节点生成]
  生成 ocr_processor 节点
    │
    ▼
[再执行工作流生成]
  使用新生成的节点编排工作流
```

### 6.11.7 业务状态流转图

```
┌──────────────────────────────────────────────────────────────────┐
│                        业务状态流转                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [等待输入]                                                       │
│      │                                                           │
│      ├─→ 用户输入需求 ──→ [意图识别]                             │
│      │                      │                                    │
│      │         ┌───────────┼───────────┐                        │
│      │         ▼           ▼           ▼                        │
│      │   [生成节点]   [生成工作流]   [其他操作]                  │
│      │         │           │           │                        │
│      │         ▼           ▼           ▼                        │
│      │   [AI生成中]   [AI生成中]   [执行操作]                   │
│      │         │           │           │                        │
│      │         ▼           ▼           ▼                        │
│      │   [生成完成]   [生成完成]   [执行中]                     │
│      │         │           │           │                        │
│      │         ▼           ▼           ▼                        │
│      │   [Mock测试]   [Mock测试]   [执行完成]                   │
│      │         │           │           │                        │
│      │         ▼           ▼           ▼                        │
│      │   [测试通过?]  [测试通过?]   [成功?]                     │
│      │      │  │        │  │        │  │                        │
│      │      │  └─Yes──→[保存可用]   │  └─Yes──→[展示结果]      │
│      │      │                       │                           │
│      │      └─No──→[AI诊断修复]    └─No──→[AI诊断修复]         │
│      │                                   │                      │
│      │                                   └───────────────┐      │
│      │                                                   │      │
│      └────────────────← 用户不满意，要求修改 ───────────┘      │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 6.11.8 关键业务规则

1. **零手动配置**：用户只能通过自然语言与 AI 交互，不提供任何表单、拖拽、参数输入框
2. **Mock 先行**：每个新生成的节点必须先通过 Mock 测试，才能被工作流引用执行
3. **原子性生成**：节点和工作流的生成是原子操作，生成失败不会留下半成品
4. **版本覆盖**：同一工作流多次生成时，新结果覆盖旧结果，但保留历史执行记录
5. **上下文继承**：多轮对话中，AI 始终记得当前工作流和节点的上下文，无需用户重复说明
6. **自动补全**：AI 检测到缺失节点时，默认询问用户是否需要自动生成（可配置为自动）
