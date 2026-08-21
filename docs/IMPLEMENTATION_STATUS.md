# FlowX Studio 实现状态跟踪文档

> 本文档记录 FlowX Studio 各模块的实现状态，区分「已实现」和「待实现」功能。
> 最后更新：2026-08-17

---

## 近期重要变更（2026-08-17）

### 架构方向调整：MCP 服务端 → SKILL + CLI 渐进式披露（已落地）
- 移除 `internal/mcpserver` 与 `flowx-studio mcp` 子命令，不再以 stdio MCP 服务端形式集成 AI。
- 新增 **`internal/cli` CLI 客户端子命令**：`pipeline list/create/update/delete/run`、`node list/create/delete/import/mock`，作为 `flowx-studio server` 的 HTTP 客户端。
- 新增 **终端交互命令** `ask` / `info`，承接原 FAP 的 `ask_input` / `show_info` 动作语义；原 FAP 的 `create_node` / `update_workflow` 由 `node create` / `pipeline update` 承接。**FAP 协议整体废弃，不再实现标签解析**。
- 新增 **`skills/flowx-studio/SKILL.md`**：AI Agent 技能速查表；配合 CLI 的 `--help`（用法层）与 `--schema`（参数 JSON Schema 契约层）实现渐进式披露。
- 约定：查询类子命令支持 `--json`；校验失败退出码 1、stderr 含重试指引；flag 用法错误退出码 2；`--server` flag / `FLOWX_STUDIO_SERVER_URL` 指定 server 地址。
- 收益：所有写操作收敛到 HTTP server 单进程，Web UI 经 SSE 可实时感知 Agent 操作（旧 MCP 模式跨进程事件不可达的问题消失）。

### 一致性修复（2026-08-17）
- 新增 `version` 子命令，版本信息由 `-ldflags` 注入（修复 `Makefile` `version` 目标报错）。
- `boot.sh` 改用 `FLOWX_STUDIO_DATA_DIR` 环境变量传递数据目录（不再传二进制不支持的 `--data-dir` flag）；`config.Load` 中 `data.db_path` 未显式配置时自动归入数据目录。
- Mock 测试环境变量统一为 `FLOWX_PARAM_` 前缀（保留裸大写名兼容别名），Mock 与运行时展开行为一致。
- `opencode.json` 移除已删除的 `flowx-studio mcp` 配置。

### server daemon 管理与 E2E 测试（2026-08-21）
- 新增 `server start / stop / status` 守护管理子命令：`start` 后台启动（Setsid）并阻塞轮询就绪（超时 10s），幂等；`status` 输出 running/stopped（退出码恒 0，支持 `--json`）；`stop` SIGTERM 优雅停止。
- `runServer` 启动后写入 `<data.dir>/server.json`（pid/host/port），`status`/`stop` 据此探测真实端口。
- `singleton` 抽出 `FindRunning`，进程身份校验改为 `/proc/<pid>/exe` 与当前可执行文件比对（对二进制重命名健壮）+ cmdline 子命令匹配。
- `skills/flowx-studio/SKILL.md` 新增「Server 生命周期」段落：Agent 调用 CLI 前先 `server status`，未运行则 `server start` 自动拉起。
- 新增 E2E 测试计划文档 `docs/12-e2e-testing.md` 与可执行断言脚本 `tests/e2e/run.sh`。

### 安全与运维增强（2026-08-21）
- **审计日志**：迁移 007 新增 `audit_logs` 表；`AuditService` 以 `SetAudit` 可选注入 NodeService/WorkflowService/ConfigHandler，覆盖节点增删改/导入/Mock、工作流增删改/执行、配置变更；审计失败不影响主流程。新增 `GET /api/v1/audit-logs` 与 `flowx-studio audit list`。
- **参数输入验证**：`internal/validator/node.go`（名称格式/长度、nodeType 枚举、语言白名单、参数类型与重名、tag 长度），接入节点创建/更新。
- **日志自动清理**：`internal/service/cleanup.go`，按 `retention.log_days`（默认 30）/ `retention.audit_days`（默认 90）清理，每 24h 一轮。
- **内存环形缓冲区**：`internal/service/ringbuffer.go`，每个执行保留最近 1000 条日志；SSE 连接时先回放缓冲区，支持断线重连。
- **备份与恢复**：`POST/GET /api/v1/backups` + 下载（`VACUUM INTO`，运行中安全）；CLI `backup create/list/download/restore`，restore 要求 server 停止并自动保留 `.pre-restore` 回滚副本。
- E2E 脚本扩充至 89 个用例（新增审计、输入验证、备份恢复分组）。

### 自动备份与健康检查（2026-08-21）
- **自动备份**：`backup.on_startup`（默认开）启动时 `VACUUM INTO` 备份；`backup.keep`（默认 3）自动清理旧备份；失败只记日志不阻断启动。
- **健康检查**：`GET /api/v1/health` 免认证，返回 status/version/uptime/DB 计数与文件大小/goroutine/堆内存；daemon 探测改用此端点。
- E2E 增至 92 个用例（新增健康检查与自动备份分组）。

### 安全与功能补全（2026-08-18）
- **本地 token 认证**：`/api/v1` 全部路由要求 `Authorization: Bearer <token>` 或 `flowx_token` cookie；token 存放于 `<data-dir>/auth.token`（0600，首次启动自动生成），可用 `FLOWX_STUDIO_SERVER_AUTH_TOKEN` 覆盖；返回 `index.html` 时自动种 cookie，Web UI 零改动；CLI 自动读取 token（`FLOWX_STUDIO_AUTH_TOKEN` > token 文件）。
- **请求限流**：`x/time/rate` 每 IP 100 请求/分钟（突发 50），超限返回 429。
- **工作流 Mock 执行**：`POST /api/v1/workflows/:id/mock`，校验 YAML + 展开 nodeRef，返回展开后配置，不创建执行记录。
- **日志导出**：`GET /api/v1/executions/:id/logs/export?format=json|txt|markdown`，带 `Content-Disposition` 下载头。
- **自动打开浏览器**：接线 `auto_open_browser`/`no_open` 配置与 `--no-open` flag，headless 环境自动跳过。

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
| 6 | AI 服务层 | ✅ 已完成 | 后端 AI 与 MCP 服务端均已移除；SKILL + CLI 渐进式披露已落地（见 06 章） |
| 7 | 节点系统 | ✅ 已完成 | CRUD + Mock 子进程执行已实现 |
| 8 | FlowX 运行时 | ✅ 已完成 | RuntimeAdapter + EventBridge + LogPusher 已实现 |
| 9 | 运行时与部署 | ✅ 已完成 | 单二进制 + go:embed + Cobra CLI 已完成 |
| 10 | 安全设计 | ✅ 已完成 | CORS + token 认证 + 请求限流 + 参数验证 + 审计日志 + Mock 代码安全校验已实现；Docker 沙箱为 V2 目标 |
| 11 | 核心库依赖 | ✅ 已完成 | FlowX 引擎接口调研完成，replace 引用已配置 |
| 12 | 节点包规范 | 🟡 部分实现 | `flowx.json` 导入、Mock 多文件、运行时展开已实现；工作流节点镜像执行待 FlowX 核心增强 |
| 13 | CLI 客户端与 SKILL | ✅ 已完成 | `internal/cli`（pipeline/node/ask/info）+ `skills/flowx-studio/SKILL.md` 已落地；`mcp` 子命令已移除 |

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
- [x] Cobra CLI（`server` / `version` 子命令 + 客户端子命令 `pipeline`/`node`/`ask`/`info`；版本信息由 `-ldflags` 注入）
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

外部 MCP 客户端连接管理（原 `internal/mcp`）已于 2026-07-12 删除；stdio MCP **服务端**（原 `internal/mcpserver`）也于 2026-08-17 移除，AI 集成改为 SKILL + CLI 模式（见上文「CLI 客户端与 SKILL」）。

#### 5. 日志系统
- [x] `execution_logs` 表结构
- [x] 日志查询 API
- [x] **真实 SSE 日志流**（FlowX Runtime 事件桥接，`adapter.go` EventBridge → SSE）
- [x] **真实日志收集** (FlowX `logger.Pusher` 桥接，`adapter.go` LogPusher)
- [x] **内存环形缓冲区** (每个执行 1000 条，`internal/service/ringbuffer.go`；SSE 连接时回放，支持断线重连)
- [x] **日志自动清理** (按保留天数，`internal/service/cleanup.go`；`retention.log_days` 默认 30 天、`retention.audit_days` 默认 90 天，每 24h 执行)

#### 6. 安全增强
- [x] CORS 本地来源限制
- [x] **本地 token 认证**（Bearer / cookie，2026-08-18）
- [x] **请求限流**（每 IP 100/min，突发 50；原 AI API 10/min 已随 AI 层移除而废止）
- [x] **参数输入验证** (类型/长度/范围检查，`internal/validator/node.go`：名称格式/长度、语言白名单、参数类型与重名、tag 长度)
- [ ] **Docker 沙箱** (只读 rootfs + 网络隔离 + 资源限制)
- [x] **审计日志** (`audit_logs` 表，迁移 007；`AuditService` 可选注入，审计失败不影响主流程；`GET /api/v1/audit-logs` + `flowx-studio audit list`)

#### 7. 其他 V1 占位
- [x] 自动打开浏览器（2026-08-18 接线：`auto_open_browser` / `no_open` / `--no-open`）
- [x] 单实例 PID 文件锁（`internal/singleton/lock.go`，`main.go` 中 server 启动时获取）
- [x] 数据备份与恢复（`POST/GET /api/v1/backups` + 下载；CLI `backup create/list/download/restore`，restore 要求 server 停止且自动保留 `.pre-restore` 回滚副本）
- [x] 日志导出 (`GET /api/v1/executions/:id/logs/export?format=json|txt|markdown`)
- [x] 工作流 Mock 执行 (`POST /api/v1/workflows/:id/mock`，校验 + 展开，不真实运行)

#### 8. CLI 客户端与 SKILL（替代原 MCP 服务端）
- [x] `internal/cli` HTTP 客户端封装（`--server` flag / `FLOWX_STUDIO_SERVER_URL`，默认 `http://127.0.0.1:8080`）
- [x] `pipeline list / create / update / delete / run` 子命令（`run --follow` 跟随 SSE 日志）
- [x] `node list / create / delete / import / mock` 子命令
- [x] `ask` / `info` 终端交互命令（承接原 FAP `ask_input` / `show_info`）
- [x] 全局 `--json` 机器可读输出、写命令 `--schema` 参数 JSON Schema 输出
- [x] 校验失败退出码 1 + stderr 重试指引；flag 用法错误退出码 2
- [x] `skills/flowx-studio/SKILL.md` 技能速查表
- [x] ~~`flowx-studio mcp` stdio MCP 服务~~（2026-08-17 移除，`internal/mcpserver` 已删除，测试用例由 `internal/service/node_import_test.go` 承接）
- [x] `flowx-studio server` 仅启动 HTTP 服务，保留 PID 单例锁且只杀 `server` 进程
- [x] SQLite 启用 WAL + busy timeout（保留，支撑 CLI 高频调用下的并发读写）
- [x] CLI 调用认证（本地 token，`auth.token` 文件自动解析）与 server 侧请求限流（2026-08-18 落地）

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

#### 2. FAP (FlowX Action Protocol) — ❌ 已废弃

FAP 标签协议不再实现（2026-08-17 架构调整）。其动作语义由 CLI 客户端子命令承接：

| 原 FAP 标签 | CLI 等价物 |
| --- | --- |
| `[[ACTION:create_node]]` | `flowx-studio node create --file node.yaml` |
| `[[ACTION:update_workflow]]` | `flowx-studio pipeline update --id N --file wf.yaml` |
| `[[ACTION:ask_input]]` | `flowx-studio ask --key k --prompt "..."`（终端交互提问） |
| `[[ACTION:show_info]]` | `flowx-studio info --title t --message m`（终端信息卡片） |

操作确认/取消与多轮对话状态由外部 AI Agent 的会话能力承担，服务端不维护对话状态。

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
- [x] 自动备份机制（启动时备份，`backup.on_startup` 默认开；`backup.keep` 默认保留最近 3 个）
- [x] 健康检查详细指标（`GET /api/v1/health` 免认证：status/version/uptime/db 计数/DB 文件大小/goroutine/堆内存）
- [ ] Prometheus 指标暴露

---

## 文件清单

### 后端已创建文件
```
flowx-studio/
├── cmd/flowx-studio/main.go          # CLI 入口（server + 客户端子命令）
├── internal/                         # 共 12 个包
│   ├── server/server.go              # Gin HTTP 服务器 + go:embed 前端资源
│   ├── handler/
│   │   ├── common.go                 # 统一响应
│   │   ├── node_handler.go           # 节点 API（含 POST /nodes/import）
│   │   ├── config_handler.go         # 系统配置 API
│   │   ├── workflow_handler.go       # 工作流 + 执行 API
│   │   └── event_handler.go          # SSE 事件订阅 API
│   ├── cli/                          # CLI 客户端子命令（HTTP client）
│   │   ├── client.go                 # HTTP 客户端封装（--server / FLOWX_STUDIO_SERVER_URL）
│   │   ├── pipeline.go               # pipeline list/create/update/delete/run
│   │   ├── node.go                   # node list/create/delete/import/mock
│   │   ├── interact.go               # ask / info 终端交互命令
│   │   ├── daemon.go                 # server start/stop/status 守护管理
│   │   ├── audit.go                  # audit list 审计日志查询
│   │   ├── backup.go                 # backup create/list/download/restore
│   │   └── schema.go                 # --schema 参数 JSON Schema 输出
│   ├── runtime/
│   │   ├── adapter.go                # FlowX RuntimeAdapter + EventBridge + LogPusher
│   │   └── node_expander.go          # 节点包 → NodeConfig 运行时展开
│   ├── sandbox/
│   │   └── executor.go               # 子进程沙箱执行器 (os/exec + 安全校验 + 多文件写入)
│   ├── service/
│   │   ├── node.go                   # 节点 CRUD + MockTest
│   │   ├── node_import.go            # flowx.json 节点包导入
│   │   ├── node_import_test.go
│   │   ├── node_list_test.go
│   │   ├── workflow.go               # 工作流执行 + ExpandWorkflowConfig 调用
│   │   ├── audit.go                  # 审计日志记录与查询
│   │   ├── backup.go                 # SQLite 备份（VACUUM INTO）
│   │   ├── cleanup.go                # 按保留天数自动清理日志
│   │   └── ringbuffer.go             # 执行日志内存环形缓冲区
│   ├── event/bus.go                  # 进程内事件总线
│   ├── singleton/lock.go             # 单实例 PID 文件锁
│   ├── validator/workflow.go         # 工作流 YAML 校验
│   ├── db/
│   │   ├── db.go                     # SQLite + 自动迁移
│   │   └── migrations/               # 迁移脚本 001-006
│   ├── model/model.go                # 所有数据模型
│   └── config/config.go              # 应用配置
├── skills/flowx-studio/SKILL.md      # AI Agent 技能速查表（含 server 生命周期）
├── tests/e2e/run.sh                  # E2E 断言脚本（见 docs/12-e2e-testing.md）
├── go.mod / go.sum                   # Go 模块（replace => ../flowx）
└── Makefile                          # 构建脚本
```

> 已删除：`internal/ai`、`internal/mcp`、`internal/mcpserver`、`internal/crypto`、`handler/ai_handler.go`、`handler/mcp_handler.go`（架构调整移除）。

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

1. **中优先级**：Docker 沙箱（只读 rootfs + 网络隔离 + 资源限制）、受限进程回退（seccomp/cgroup）
2. **低优先级**：Prometheus 指标暴露、前端增强（React Query / Monaco / 日志虚拟滚动）
