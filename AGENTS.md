# FlowX Studio 项目约定

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
