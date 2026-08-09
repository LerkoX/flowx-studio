# FlowX Studio 实现状态跟踪文档

> 本文档记录 FlowX Studio 各模块的实现状态，区分「已实现」和「待实现」功能。
> 最后更新：2026-08-02

---

## 近期重要变更（2026-07-12）

### 架构方向调整
- 项目定位从“AI 驱动 + 外部 MCP 客户端”调整为 **“FlowX 运行时可视化查看器 + stdio MCP 服务器”**。
- 已移除后端 AI 对话、MCP 连接管理、加密/聊天相关模块，以及前端 AI 聊天、节点生成、外部 MCP 配置界面。
- 保留 MCP 服务端能力（`internal/mcpserver`），通过 stdio 对外提供工具调用。

### 新增 / 已落地功能
- **运行时元数据**：`executions` 表新增 `metadata_json` 字段，工作流执行结束后保存渲染后的参数、运行时输出、节点状态等快照。
- **执行节点状态 API**：新增 `GET /api/v1/executions/:id/nodes`，返回每次执行中各节点的起止时间、状态、耗时。
- **执行历史面板**：右侧面板新增“历史”Tab，可查看历史执行、点击节点过滤日志，并自动回显节点状态到画布。
- **日志节点过滤**：日志查看器支持按节点过滤，并提供清除过滤按钮。
- **画布方向切换**：顶部状态面板增加横向/竖向布局切换按钮，节点和终端节点的连接点会随方向自适应。
- **终端节点渲染**：Mermaid `stateDiagram-v2` 中的 `[*]` 不再显示为星号节点，而是渲染为圆形 `Start` / `End` 节点，并移除断线。
- **移动端适配**：修复左侧 48px 空白边框；底部 Tab 栏再次点击当前 Tab 可关闭抽屉；节点添加弹窗等全屏弹窗关闭后不再因透明容器遮挡主界面。
- **单例锁与优雅重启**：`flowx-studio server` 通过 PID 文件保证单例，HTTP 与 FlowX Runtime 均支持优雅关闭。

### 仍在完善 / V2 目标
- 真正的 `mermaid` npm 库渲染（当前为手写 `stateDiagram-v2` 解析器）。
- Docker 沙箱与请求限流等安全增强。

---

## 整体进度概览

| 章节 | 模块 | 状态 | 说明 |
|------|------|------|------|
| 1 | 项目概述 | ✅ 已完成 | 前端 Phase 1-5 + 后端 V1 已完成 |
| 2 | 系统架构 | ✅ 已完成 | 目录结构、模块划分、依赖关系已落地 |
| 3 | 数据库设计 | ✅ 已完成 | SQLite Schema + 自动迁移已实现 |
| 4 | API 设计 | ✅ 已完成 | 基础 CRUD + FlowX Runtime 集成已完成 |
| 5 | 前端设计 | ✅ 已完成 | React + TS + Vite 前端已完成并构建 |
| 6 | AI 服务层 | ❌ 已移除 | AI Provider/对话模块已删除；06 章内容转向 MCP 服务端 |
| 7 | 节点系统 | ✅ 已完成 | CRUD + Mock 子进程执行已实现 |
| 8 | FlowX 运行时 | ✅ 已完成 | RuntimeAdapter + EventBridge + LogPusher 已实现 |
| 9 | 运行时与部署 | ✅ 已完成 | 单二进制 + go:embed + Cobra CLI 已完成 |
| 10 | 安全设计 | 🟡 部分实现 | CORS 限制 + Mock 代码安全校验已实现，请求限流/沙箱待实现 |
| 11 | 核心库依赖 | ✅ 已完成 | FlowX 引擎接口调研完成，replace 引用已配置 |
| 12 | 节点包规范 | 🟡 部分实现 | `flowx.json` 导入、Mock 多文件、运行时展开已实现；工作流节点镜像执行待 FlowX 核心增强 |
| 13 | MCP 服务端工具 | 🟡 部分实现 | 新增 `flowx-studio mcp` 子命令；`server` 仅保留 HTTP；SQLite WAL 支持多会话并发 |

---

## 详细实现状态

### ✅ 已完全实现

#### 1. 基础设施
- [x] Go Module 初始化 (`go.mod` + `replace github.com/LerkoX/flowx => ../flowx`)
- [x] 目录结构 (`cmd/`, `internal/*`, `migrations/`)
- [x] SQLite 数据库连接 (`modernc.org/sqlite`，纯 Go，无 CGO)
- [x] 自动迁移系统 (`schema_migrations` 表 + 版本化 SQL 脚本)
- [x] 配置加载 (Cobra + Viper，支持命令行/环境变量/配置文件)
- [x] Gin HTTP 服务器 + CORS 中间件
- [x] 统一 API 响应格式 (`{code, data, message}`)
- [x] `go:embed` 嵌入前端资源
- [x] SPA fallback 到 `index.html`
- [x] Cobra CLI（`server` / `mcp` 子命令；**无 `version` 子命令**。已知问题：`Makefile` 的 `version` 目标调用 `./flowx-studio version` 会失败）
- [x] Makefile (`build`, `run`, `clean`)

#### 2. 数据模型
- [x] Node 模型（代码节点 + 镜像节点双模式）
- [x] Workflow 模型
- [x] WorkflowNode 关联表模型
- [x] Execution / ExecutionNode / ExecutionLog 模型
- [x] SystemConfig 模型

#### 3. 节点管理 API
- [x] `GET /api/v1/nodes` — 列表 + 分页 + 过滤（language/tag/search/node_type）
- [x] `POST /api/v1/nodes` — 创建节点
- [x] `GET /api/v1/nodes/:id` — 获取详情
- [x] `PUT /api/v1/nodes/:id` — 更新节点
- [x] `DELETE /api/v1/nodes/:id` — 删除节点
- [x] `POST /api/v1/nodes/:id/mock` — Mock 测试 API（真实子进程执行）

#### 4. 配置管理 API
- [x] `GET/PUT /api/v1/config/system` — 系统配置

#### 5. 工作流 API
- [x] `GET/POST/PUT/DELETE /api/v1/workflows` — 工作流 CRUD
- [x] `POST /api/v1/workflows/:id/run` — 触发执行
- [x] `GET /api/v1/executions` — 执行历史
- [x] `GET /api/v1/executions/:id` — 执行详情
- [x] `GET /api/v1/executions/:id/stream` — SSE 实时日志流（FlowX Runtime 真实事件）
- [x] `GET /api/v1/executions/:id/logs` — 查询执行日志

#### 6. AI 对话 API — ❌ 已移除

AI 对话相关 API（`/api/v1/ai/chat`、`generate-node`、`generate-workflow`、`chat_history` 表）已随架构调整全部删除。

#### 7. 前端服务层
- [x] `web/src/services/api.ts` — axios 统一客户端 + 响应拦截器
- [x] `web/src/services/nodeService.ts` — 节点 API 封装
- [x] `web/src/services/configService.ts` — 配置 API 封装
- [x] `web/src/services/workflowService.ts` — 工作流 + 执行 API 封装
- [x] `web/src/services/eventService.ts` — SSE 事件订阅封装
- [x] `web/src/stores/nodeStore.ts` — 替换 mock 为真实 API
- [x] `web/src/stores/settingsStore.ts` — 替换 mock 为真实 API

---

### 🟡 部分实现 / V1 占位

#### 1. AI Provider 真实调用 — ❌ 已移除

AI Provider（OpenAI/Anthropic/Ollama）与 AI Service 层已随架构调整全部删除（原 `internal/ai` 已不存在）。

#### 2. FlowX 引擎集成
- [x] `replace github.com/LerkoX/flowx => ../flowx` 已配置
- [x] `flowx.NewRuntime()` 调研完成
- [x] `Runtime.RunAsync()` 接口调研完成
- [x] `dag.Listener` 事件监听接口调研完成
- [x] `logger.Pusher` 日志推送接口调研完成
- [x] **RuntimeAdapter 真实实现** (`internal/runtime/adapter.go`)
- [x] **EventBridge 真实实现** (Listener → SSE 桥接)
- [x] **LogPusher 真实实现** (logger.Pusher 接口实现)
- [x] 工作流执行时 YAML 配置注入节点代码（`workflow.go` 调用 `runtime.ExpandWorkflowConfig` 展开 `nodeRef`）
- [x] 执行状态实时持久化 (`executions`, `execution_nodes`, `execution_logs`，见 `workflow.go` 执行生命周期)

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

#### 4. MCP 连接管理 — ❌ 已移除

外部 MCP 客户端连接管理（配置 CRUD、本地命令/远程 SSE 连接、工具发现与调用，原 `internal/mcp`）已随架构调整全部删除。保留的是 **MCP 服务端** 能力（`internal/mcpserver`，见下文「内部 MCP 服务端工具」）。

#### 5. 日志系统
- [x] `execution_logs` 表结构
- [x] 日志查询 API
- [x] **真实 SSE 日志流**（FlowX Runtime 事件桥接，`adapter.go` EventBridge → SSE）
- [x] **真实日志收集** (FlowX `logger.Pusher` 桥接，`adapter.go` LogPusher)
- [ ] **内存环形缓冲区** (每个执行 1000 条)
- [ ] **日志自动清理** (按保留天数)

#### 6. 安全增强
- [x] CORS 本地来源限制
- [ ] **请求限流** (AI API 10/min, 其他 100/min)
- [ ] **参数输入验证** (类型/长度/范围检查)
- [ ] **Docker 沙箱** (只读 rootfs + 网络隔离 + 资源限制)
- [ ] **审计日志** (`audit_logs` 表)

#### 7. 其他 V1 占位
- [ ] 自动打开浏览器（未实现；配置项 `auto_open_browser` 已预留但未接线）
- [x] 单实例 PID 文件锁（`internal/singleton/lock.go`，`main.go` 中 server 启动时获取）
- [ ] 数据备份与恢复 API
- [ ] 日志导出 (`POST /api/v1/executions/:id/logs/export`)
- [ ] 工作流 Mock 执行 (`POST /api/v1/workflows/:id/mock`)

#### 8. 内部 MCP 服务端工具
- [x] `stdio` JSON-RPC 2.0 MCP 服务 (`internal/mcpserver`)
- [x] 工具列表：`create_pipeline`、`update_pipeline`、`delete_pipeline`、`list_pipelines`、`run_pipeline`、`import_node`、`delete_node`、`list_nodes`
- [x] `import_node` 支持从 `git` / `folder` 读取 `flowx.json` 并导入节点包
- [x] 新增 `flowx-studio mcp` 子命令，仅启动 stdio MCP 服务，不持有 PID 单例锁，可多会话并发
- [x] `flowx-studio server` 仅启动 HTTP 服务，保留 PID 单例锁且只杀 `server` 进程
- [x] SQLite 启用 WAL + busy timeout，支持多个 `mcp` 进程同时访问同一数据库
- [ ] MCP 工具调用认证与限流

---

### ❌ 未实现（V2 或后续迭代）

#### 1. 节点包规范（flowx.json）
- [x] `model.Node.Files` 字段与数据库迁移
- [x] `model.Node.PackageConfig` 字段与数据库迁移
- [x] `POST /api/v1/nodes/import` 接口
- [x] git / folder 节点包导入服务
- [x] `flowx.json` 解析、校验与字段映射
- [x] 节点包 → `flowx/core.NodeConfig` 运行时展开
- [x] 工作流 YAML 预处理（`nodeRef` 展开）
- [x] 前端 `NodeImportModal` 对接真实导入接口
- [ ] 工作流节点镜像执行（依赖 FlowX 核心 Docker 执行器支持 `image` 配置）

#### 2. FAP (FlowX Action Protocol)
- [ ] `[[ACTION:create_node]]` 标签解析
- [ ] `[[ACTION:update_workflow]]` 标签解析
- [ ] `[[ACTION:ask_input]]` 交互式表单
- [ ] `[[ACTION:show_info]]` 信息卡片
- [ ] 操作确认/取消/编辑机制
- [ ] 多轮对话状态机

#### 3. 高级 AI 功能
- [ ] 节点代码语法验证
- [ ] AI 自动诊断执行错误
- [ ] AI 自动修复工作流
- [ ] 意图识别分类器

#### 4. 前端增强
- [ ] React Query 服务端状态管理
- [ ] Monaco Editor 代码编辑
- [ ] 日志虚拟滚动
- [ ] 执行日志导出 (JSON/TXT/Markdown)

#### 5. 部署与运维
- [ ] 自动备份机制
- [ ] 健康检查详细指标
- [ ] Prometheus 指标暴露

---

## 文件清单

### 后端已创建文件
```
flowx-studio/
├── cmd/flowx-studio/main.go          # CLI 入口（server / mcp 子命令）
├── internal/                         # 共 12 个包
│   ├── server/server.go              # Gin HTTP 服务器 + go:embed 前端资源
│   ├── handler/
│   │   ├── common.go                 # 统一响应
│   │   ├── node_handler.go           # 节点 API（含 POST /nodes/import）
│   │   ├── config_handler.go         # 系统配置 API
│   │   ├── workflow_handler.go       # 工作流 + 执行 API
│   │   └── event_handler.go          # SSE 事件订阅 API
│   ├── runtime/
│   │   ├── adapter.go                # FlowX RuntimeAdapter + EventBridge + LogPusher
│   │   └── node_expander.go          # 节点包 → NodeConfig 运行时展开
│   ├── sandbox/
│   │   └── executor.go               # 子进程沙箱执行器 (os/exec + 安全校验 + 多文件写入)
│   ├── mcpserver/
│   │   ├── server.go                 # stdio JSON-RPC 2.0 MCP 服务
│   │   ├── tools.go                  # 8 个 MCP 工具实现
│   │   └── import_node_test.go
│   ├── service/
│   │   ├── node.go                   # 节点 CRUD + MockTest
│   │   ├── node_import.go            # flowx.json 节点包导入
│   │   ├── node_import_test.go
│   │   ├── node_list_test.go
│   │   └── workflow.go               # 工作流执行 + ExpandWorkflowConfig 调用
│   ├── event/bus.go                  # 进程内事件总线
│   ├── singleton/lock.go             # 单实例 PID 文件锁
│   ├── validator/workflow.go         # 工作流 YAML 校验
│   ├── db/
│   │   ├── db.go                     # SQLite + 自动迁移
│   │   └── migrations/               # 迁移脚本 001-006
│   ├── model/model.go                # 所有数据模型
│   └── config/config.go              # 应用配置
├── go.mod / go.sum                   # Go 模块（replace => ../flowx）
└── Makefile                          # 构建脚本
```

> 已删除：`internal/ai`、`internal/mcp`、`internal/crypto`、`handler/ai_handler.go`、`handler/mcp_handler.go`（架构调整移除）。

### 前端已修改文件
```
web/src/services/
├── api.ts                            # axios 客户端
├── nodeService.ts                    # 节点 API（含导入接口）
├── configService.ts                  # 配置 API
├── workflowService.ts                # 工作流 API
└── eventService.ts                   # SSE 事件订阅

web/src/stores/
├── appStore.ts
├── executionStore.ts
├── nodeStore.ts                      # 真实 API 集成
├── settingsStore.ts                  # 真实 API 集成
└── workflowStore.ts

web/src/features/                     # 按领域拆分的功能模块
├── executor-config/
├── node-manager/
├── settings/
└── workflow-canvas/

web/src/pages/
├── ExecutorConfigPage.tsx
├── NodeManagerPage.tsx
├── SettingsPage.tsx
├── WorkflowCanvasPage.tsx
└── WorkflowListPage.tsx
```

---

## 下一步建议（按优先级）

1. **🔥 高优先级**：实现安全增强（请求限流、参数验证、审计日志）
2. **中优先级**：内存环形缓冲区、日志自动清理、日志导出
3. **中优先级**：FAP 标签解析、自动打开浏览器接线、数据备份等增强功能
4. **低优先级**：MCP 工具调用认证与限流、Prometheus 指标暴露
