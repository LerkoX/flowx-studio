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
