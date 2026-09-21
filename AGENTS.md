# FlowX Studio 项目约定

## 修改代码前必须先咨询

在开始修改任何代码之前，必须先向用户说明方案并征得同意。用户同意后，
同一话题内可持续修改，无需重复征询；仅当方案发生变更或开启新话题时，
才需要再次咨询确认。

## 修改后必须重新编译并重启服务

前端通过 `go:embed` 嵌入 `internal/server/web/dist`（见 `internal/server/server.go`），
**仅执行 `npm run build` 或仅执行 `go build` 都不会让改动生效**。任何前端或后端修改后，
必须按以下完整流程操作：

```bash
# 1. 完整构建（含前端编译 → 拷贝 dist 到 embed 目录 → 编译二进制）
make build

# 2. 重启服务
./flowx-studio server stop
./flowx-studio server start

# 3. 验证服务已加载新前端（hash 应与 web/dist 中最新的 index-*.js 一致）
curl -s http://127.0.0.1:8080/ | grep -o 'index-[^"]*\.js'
```

注意事项：

- **不要直接 `go build`**：embed 的是 `internal/server/web/dist`（构建时从 `web/dist`
  拷贝的副本），跳过 `make build` 中的 copy 步骤会嵌入旧前端。
- **pid 文件可能失效**：若 `server stop` 报 "Server not running" 但进程仍在
  （`ps aux | grep "flowx-studio server"`），需手动 `kill <pid>` 后再 `server start`。
- 仅改后端 Go 代码时可跳过前端编译，但仍需重新编译二进制并重启服务。
- 端口冲突（`bind: address already in use`）说明旧进程未被停止，先确认旧进程已退出。
- **禁用 `pkill -f "flowx-studio server"`**：该模式会匹配当前 shell 自己的命令行
  （含此字面量）导致 shell 自杀——后续 `cp` 新二进制等命令根本不会执行，重启的
  还是旧二进制（真实事故：参数校验改动看似未生效，实为陈旧二进制在跑）。
  手动清理用 `kill <pid>`（先 `pgrep -x flowx-studio` 确认）。

## 前端坑：AnimatePresence 退出子树内禁用 framer-motion 的 layoutId

**症状**：弹窗/抽屉里切换 tab（layoutId 共享布局动画进行中）后立即关闭，
整个页面无法点击——全屏遮罩层残留在 DOM 中拦截所有事件。

**根因**：`layoutId` 元素在切换时会触发跨元素 crossfade（spring 动画持续约 1 秒）。
若动画进行期间父级 `AnimatePresence` 开始退出，它会等待子树内所有动画完成才卸载，
而被 crossfade 「接管」的 layoutId 元素会导致退出动画永远卡住，遮罩层停在接近透明
但始终不移除。

**规则**：

- 任何会被 `AnimatePresence` 卸载的子树（弹窗、抽屉、移动端侧边栏等）内部
  **禁止使用 `layoutId`**，tab 下划线/指示条改用普通淡入动画
  （`initial={{ opacity: 0 }} animate={{ opacity: 1 }}`）。
- 常驻组件（不经过 AnimatePresence 退出路径，如桌面端 Sidebar 的
  `sidebarIndicator`）可以保留 `layoutId` 滑动动画。
- 新增弹窗/抽屉时检查子树内不得引入 `layoutId`；全局排查用
  `grep -rn "layoutId" web/src/`。

参考修复：`NodeImportModal.tsx` / `NodeDetailModal.tsx` / `WorkflowCanvasPage.tsx`
/ `Sidebar.tsx`（移动端抽屉）。

## 架构红线：Studio 不得耦合任何具体节点生态

Studio 是**通用工作流引擎**。核心代码（`internal/`、`web/src/`）不得认识
任何具体节点生态（如 pixelforge 推理服务）的业务概念。新增能力时先问：
"换一个节点生态（TTS、视频剪辑、任意第三方服务），这个机制还成立吗？"
不成立就说明放错了地方——业务知识应下沉到节点包（执行器 + widget）。

### 禁止事项（出现即耦合）

- **硬编码第三方服务的 API 路径**：`internal/` 里不得出现 `/jobs/xxx`、
  `/op`、`/images/{id}`、`/models/files` 这类对端路径拼串。
- **业务语义进路由/类型/错误命名**：路由、函数、哨兵错误不得含
  `inference`、`op`、`image`、`model` 等某生态专有概念
  （历史反例：`interrupt-inference`、`op-replay`、`ErrNoInferenceSource`，已清除）。
- **反解节点参数私有约定**：不得假定节点一定有某参数（如 `service_url`）
  并据此做业务推断。通用约定（节点自己上报的连接值）除外。
- **替 widget 做业务解析**：widget 能从 `outputs`/`preview` prop 拿到的数据，
  服务端不得再解析一遍封装成专用端点。

### 正确做法（通用机制优先）

新需求优先用以下既有通用机制表达，不够时再扩展通用层（而非加业务端点）：

| 需求 | 通用机制 |
|------|---------|
| widget 调第三方服务（设计期，如选项下拉） | `POST /api/v1/service-proxy`（base 显式给定） |
| widget 调第三方服务（运行期，如取资源/发动作） | `ANY /executions/{id}/nodes/{nodeId}/service-proxy`（base 服务端按节点记录解析，防 SSRF） |
| 节点执行中上报进度帧/连接信息 | stdout `FLOWX_PREVIEW` 标记（url/progress/base/token/job_id 均为不透明值） |
| 节点向 widget 传生态私有数据 | emit `__` 前缀输出键（widget 从 `outputs` prop 自取自解析） |
| widget 向执行器传参 | 节点 `params`（Studio 不透视内容） |

原则：**第三方 API 的路径与语义由节点包的 widget/执行器自持**；Studio 只提供
管道（代理转发、事件透传、帧中转），管道里流动的内容对 Studio 是不透明的。

### 提交前自查

```bash
# internal/ 与 web/src/ 不应出现某生态专有的路径或概念（历史豁免见 git log）
grep -rn "jobs/\|/op\"\|models-files\|inference\|op-replay" internal/ web/src/ --include="*.go" --include="*.ts" --include="*.tsx"
```

参考改造：commit `6ef5768`（4 个推理业务端点 → 2 个通用服务代理）。
