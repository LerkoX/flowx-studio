# FlowX Studio 实现状态跟踪文档

> 本文档记录 FlowX Studio 各模块的实现状态，区分「已实现」和「待实现」功能。
> 最后更新：2026-06-08

---

## 整体进度概览

| 章节 | 模块 | 状态 | 说明 |
|------|------|------|------|
| 1 | 项目概述 | ✅ 已完成 | 前端 Phase 1-5 + 后端 V1 已完成 |
| 2 | 系统架构 | ✅ 已完成 | 目录结构、模块划分、依赖关系已落地 |
| 3 | 数据库设计 | ✅ 已完成 | SQLite Schema + 自动迁移已实现 |
| 4 | API 设计 | ✅ 已完成 | 基础 CRUD + AI Provider 真实调用 + FlowX Runtime 集成已完成 |
| 5 | 前端设计 | ✅ 已完成 | React + TS + Vite 前端已完成并构建 |
| 6 | AI 服务层 | ✅ 已完成 | OpenAI/Anthropic/Ollama Provider + SSE 流式已实现 |
| 7 | 节点系统 | ✅ 已完成 | CRUD + Mock 子进程执行已实现 |
| 8 | FlowX 运行时 | ✅ 已完成 | RuntimeAdapter + EventBridge + LogPusher 已实现 |
| 9 | 运行时与部署 | ✅ 已完成 | 单二进制 + go:embed + Cobra CLI 已完成 |
| 10 | 安全设计 | 🟡 部分实现 | 加密 + 黑名单已完成，完整沙箱待实现 |
| 11 | 核心库依赖 | ✅ 已完成 | FlowX 引擎接口调研完成，replace 引用已配置 |

---

## 详细实现状态

### ✅ 已完全实现

#### 1. 基础设施
- [x] Go Module 初始化 (`go.mod` + `replace github.com/LerkoX/flowx => ../flowx`)
- [x] 目录结构 (`cmd/`, `internal/*`, `migrations/`)
- [x] SQLite 数据库连接 (`modernc.org/sqlite`，纯 Go，无 CGO)
- [x] 自动迁移系统 (`schema_migrations` 表 + 版本化 SQL 脚本)
- [x] AES-GCM 加密模块 (`internal/crypto/crypto.go`)
- [x] 配置加载 (Cobra + Viper，支持命令行/环境变量/配置文件)
- [x] Gin HTTP 服务器 + CORS 中间件
- [x] 统一 API 响应格式 (`{code, data, message}`)
- [x] `go:embed` 嵌入前端资源
- [x] SPA fallback 到 `index.html`
- [x] Cobra CLI (`server` 默认命令、`version` 命令)
- [x] Makefile (`build`, `run`, `clean`)

#### 2. 数据模型
- [x] Node 模型（代码节点 + 镜像节点双模式）
- [x] Workflow 模型
- [x] WorkflowNode 关联表模型
- [x] Execution / ExecutionNode / ExecutionLog 模型
- [x] AIConfig / MCPConfig / SystemConfig 模型
- [x] ChatMessage 模型

#### 3. 节点管理 API
- [x] `GET /api/v1/nodes` — 列表 + 分页 + 过滤（language/tag/search/node_type）
- [x] `POST /api/v1/nodes` — 创建节点
- [x] `GET /api/v1/nodes/:id` — 获取详情
- [x] `PUT /api/v1/nodes/:id` — 更新节点
- [x] `DELETE /api/v1/nodes/:id` — 删除节点
- [x] `POST /api/v1/nodes/:id/mock` — Mock 测试 API（V1 占位）

#### 4. 配置管理 API
- [x] `GET/POST/PUT/DELETE /api/v1/config/ai` — AI 配置 CRUD
- [x] `GET/POST/PUT/DELETE /api/v1/config/mcp` — MCP 配置 CRUD
- [x] `GET/PUT /api/v1/config/system` — 系统配置
- [x] `api_key` AES-GCM 加密存储，列表接口脱敏
- [x] `auth_header_value` AES-GCM 加密存储
- [x] MCP 本地命令黑名单校验（默认黑名单 + 可配置）

#### 5. 工作流 API
- [x] `GET/POST/PUT/DELETE /api/v1/workflows` — 工作流 CRUD
- [x] `POST /api/v1/workflows/:id/run` — 触发执行
- [x] `GET /api/v1/executions` — 执行历史
- [x] `GET /api/v1/executions/:id` — 执行详情
- [x] `GET /api/v1/executions/:id/stream` — SSE 实时日志流（FlowX Runtime 真实事件）
- [x] `GET /api/v1/executions/:id/logs` — 查询执行日志

#### 6. AI 对话 API
- [x] `POST /api/v1/ai/chat` — SSE 流式对话（V1 模拟响应）
- [x] `GET /api/v1/ai/chat/:session_id/history` — 对话历史
- [x] `POST /api/v1/ai/generate-node` — SSE 流式生成节点（V1 模拟）
- [x] `POST /api/v1/ai/generate-workflow` — SSE 流式生成工作流（V1 模拟）
- [x] 对话历史持久化到 `chat_history` 表

#### 7. 前端服务层
- [x] `web/src/services/api.ts` — axios 统一客户端 + 响应拦截器
- [x] `web/src/services/nodeService.ts` — 节点 API 封装
- [x] `web/src/services/configService.ts` — 配置 API 封装
- [x] `web/src/services/workflowService.ts` — 工作流 + 执行 API 封装
- [x] `web/src/services/aiService.ts` — AI 对话 SSE 流式封装
- [x] `web/src/stores/nodeStore.ts` — 替换 mock 为真实 API
- [x] `web/src/stores/settingsStore.ts` — 替换 mock 为真实 API

---

### 🟡 部分实现 / V1 占位

#### 1. AI Provider 真实调用
- [x] Provider 接口设计（文档中已定义）
- [x] SSE 流式响应框架（事件推送机制）
- [x] **OpenAI Provider 真实 HTTP 调用** (`/v1/chat/completions`，覆盖 OpenAI/Ollama/Custom)
- [x] **Anthropic Provider 真实 HTTP 调用** (`/v1/messages`)
- [x] **Ollama Provider 真实 HTTP 调用** (`/api/chat`)
- [x] 重试机制（指数退避）
- [ ] 故障转移（主模型失败切换备用）
- [ ] Token 使用量统计

**当前行为**：AI 对话调用真实 LLM API，支持 SSE 流式返回。

#### 2. FlowX 引擎集成
- [x] `replace github.com/LerkoX/flowx => ../flowx` 已配置
- [x] `flowx.NewRuntime()` 调研完成
- [x] `Runtime.RunAsync()` 接口调研完成
- [x] `dag.Listener` 事件监听接口调研完成
- [x] `logger.Pusher` 日志推送接口调研完成
- [x] **RuntimeAdapter 真实实现** (`internal/runtime/adapter.go`)
- [x] **EventBridge 真实实现** (Listener → SSE 桥接)
- [x] **LogPusher 真实实现** (logger.Pusher 接口实现)
- [ ] 工作流执行时 YAML 配置注入节点代码
- [ ] 执行状态实时持久化 (`executions`, `execution_nodes`, `execution_logs`)

**当前行为**：工作流执行调用 FlowX Runtime，`workflow_handler.go` 已接入真实适配器。

#### 3. Mock 执行沙箱
- [x] Mock 测试 API 端点
- [x] 黑名单校验（危险命令拦截）
- [x] **真实子进程执行** (`os/exec` + 环境变量注入)
- [x] **执行超时控制** (默认 30s, 最大 5min)
- [x] **代码安全校验** (危险模式/敏感路径检测)
- [ ] **Docker 沙箱隔离** (V2 目标)
- [ ] **受限进程回退** (Linux seccomp/cgroup)

**当前行为**：Mock 测试真实执行节点代码，支持 Python/Go/Bash/JS/TS/Ruby/PHP。

#### 4. MCP 连接管理
- [x] MCP 配置 CRUD + 加密存储
- [x] 本地命令黑名单校验
- [ ] **本地命令模式真实启动** (`os/exec` 启动 MCP server)
- [ ] **远程 SSE 模式真实连接** (HTTP SSE 长连接)
- [ ] **MCP 工具发现与调用**
- [ ] **连接状态心跳检测**

**当前行为**：MCP 配置仅存储，不建立真实连接。

#### 5. 日志系统
- [x] `execution_logs` 表结构
- [x] 日志查询 API
- [x] SSE 日志流端点（模拟事件）
- [ ] **真实日志收集** (FlowX `logger.Pusher` 桥接)
- [ ] **内存环形缓冲区** (每个执行 1000 条)
- [ ] **日志自动清理** (按保留天数)

#### 6. 安全增强
- [x] API Key 加密存储 (AES-GCM)
- [x] MCP 命令黑名单
- [x] CORS 本地来源限制
- [ ] **请求限流** (AI API 10/min, 其他 100/min)
- [ ] **参数输入验证** (类型/长度/范围检查)
- [ ] **Docker 沙箱** (只读 rootfs + 网络隔离 + 资源限制)
- [ ] **审计日志** (`audit_logs` 表)

#### 7. 其他 V1 占位
- [ ] 自动打开浏览器 (`openBrowser` 函数为空)
- [ ] 单实例 PID 文件锁
- [ ] 数据备份与恢复 API
- [ ] 日志导出 (`POST /api/v1/executions/:id/logs/export`)
- [ ] 工作流 Mock 执行 (`POST /api/v1/workflows/:id/mock`)

---

### ❌ 未实现（V2 或后续迭代）

#### 1. FAP (FlowX Action Protocol)
- [ ] `[[ACTION:create_node]]` 标签解析
- [ ] `[[ACTION:update_workflow]]` 标签解析
- [ ] `[[ACTION:ask_input]]` 交互式表单
- [ ] `[[ACTION:show_info]]` 信息卡片
- [ ] 操作确认/取消/编辑机制
- [ ] 多轮对话状态机

#### 2. 高级 AI 功能
- [ ] 节点代码语法验证
- [ ] AI 自动诊断执行错误
- [ ] AI 自动修复工作流
- [ ] 意图识别分类器

#### 3. 前端增强
- [ ] React Query 服务端状态管理
- [ ] Monaco Editor 代码编辑
- [ ] 日志虚拟滚动
- [ ] 执行日志导出 (JSON/TXT/Markdown)

#### 4. 部署与运维
- [ ] 自动备份机制
- [ ] 健康检查详细指标
- [ ] Prometheus 指标暴露

---

## 文件清单

### 后端已创建文件
```
flowx-studio/
├── cmd/flowx-studio/main.go          # CLI 入口
├── internal/
│   ├── server/server.go              # Gin HTTP 服务器
│   ├── handler/
│   │   ├── common.go                 # 统一响应
│   │   ├── node_handler.go           # 节点 API
│   │   ├── config_handler.go         # 配置 API
│   │   ├── workflow_handler.go       # 工作流 + 执行 API
│   │   └── ai_handler.go             # AI 对话 API
│   ├── ai/
│   │   ├── provider.go               # OpenAI/Anthropic/Ollama Provider
│   │   └── service.go                # AI Service + Prompt 模板 + 重试
│   ├── runtime/
│   │   └── adapter.go                # FlowX RuntimeAdapter + EventBridge + LogPusher
│   ├── sandbox/
│   │   └── executor.go               # 子进程沙箱执行器 (os/exec + 安全校验)
│   ├── db/db.go                      # SQLite + 迁移
│   ├── model/model.go                # 所有数据模型
│   ├── crypto/crypto.go              # AES-GCM 加密
│   └── config/config.go              # 应用配置
├── migrations/001_init.sql           # 初始 Schema
├── go.mod / go.sum                   # Go 模块
└── Makefile                          # 构建脚本
```

### 前端已修改文件
```
web/src/services/
├── api.ts                            # axios 客户端
├── nodeService.ts                    # 节点 API
├── configService.ts                  # 配置 API
├── workflowService.ts                # 工作流 API
└── aiService.ts                      # AI SSE 流式

web/src/stores/
├── nodeStore.ts                      # 真实 API 集成
└── settingsStore.ts                  # 真实 API 集成
```

---

## 下一步建议（按优先级）

1. **🔥 高优先级**：实现 MCP 本地命令真实启动 + 远程 SSE 连接，让 MCP 工具可用
2. **🔥 高优先级**：实现日志系统完整桥接（FlowX `logger.Pusher` → 数据库 + SSE）
3. **中优先级**：实现安全增强（请求限流、参数验证、审计日志）
4. **中优先级**：AI Provider 故障转移 + Token 使用量统计
5. **低优先级**：FAP 标签解析、自动打开浏览器、数据备份等增强功能
