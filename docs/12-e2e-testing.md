# 12. E2E 测试计划

> 本文档描述 FlowX Studio 的端到端（E2E）测试计划，供 AI Agent 自动驱动验证 CLI 与服务端全链路功能。
> 配套可执行脚本：[`tests/e2e/run.sh`](https://github.com/LerkoX/flowx-studio/blob/main/tests/e2e/run.sh)。

## 12.1 目标与原则

- **AI 可自动驱动**：每个用例都有明确的命令、预期输出与退出码，Agent 可逐步执行并比对；也可以直接运行 `bash tests/e2e/run.sh` 看汇总结果。
- **环境隔离**：测试使用独立的 `FLOWX_STUDIO_DATA_DIR`（临时目录）与专用端口，**不触碰用户真实数据**；结束后自动清理。
- **无外部依赖**：不依赖网络、Docker 或第三方服务；Mock 节点使用 bash。
- **黑盒验证**：只通过 CLI 与 HTTP API 验证，不调用内部 Go 接口。

## 12.2 环境隔离约定

| 项目 | 约定 |
|------|------|
| 数据目录 | `FLOWX_STUDIO_DATA_DIR=$(mktemp -d)`，测试结束删除 |
| 端口 | 默认 `18099`，被占用时用 `E2E_PORT` 环境变量覆盖 |
| 二进制 | 测试前 `go build` 到临时路径（可用 `E2E_BINARY` 覆盖） |
| 清理 | `trap EXIT` 中 `server stop` + 删除临时目录 |

## 12.3 用例

### 12.3.1 CLI 基础

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 1.1 | 命令树可用 | `flowx-studio --help` | 退出 0，输出含 `server`、`pipeline`、`node`、`ask`、`info`、`version` |
| 1.2 | 参数契约可解析 | `flowx-studio pipeline create --schema` | 退出 0，stdout 是合法 JSON 且含 `"required"` |
| 1.3 | 版本输出 | `flowx-studio version` | 退出 0，输出含 `flowx-studio` |

### 12.3.2 server 生命周期

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 2.1 | 初始状态 | `flowx-studio server status` | 退出 0，输出 `stopped` |
| 2.2 | 后台启动 | `flowx-studio server start --port $E2E_PORT` | 退出 0，输出含 `Server started` 与 `url=http://127.0.0.1:$E2E_PORT` |
| 2.3 | 运行状态 | `flowx-studio server status` | 退出 0，输出含 `running` |
| 2.4 | 启动幂等 | 再次 `server start --port $E2E_PORT` | 退出 0，输出含 `already running` |
| 2.5 | 优雅停止 | `flowx-studio server stop` | 退出 0，输出含 `Server stopped` |
| 2.6 | 停止后状态 | `flowx-studio server status` | 输出 `stopped` |
| 2.7 | 重复停止 | 再次 `server stop` | 退出 0，输出含 `not running` |

> 生命周期用例通过后，重新 `server start` 供后续用例使用。

### 12.3.3 节点管理

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 3.1 | 创建节点 | `node create --file node.yaml`（bash 节点，参数 `greeting`） | 退出 0，输出含 `Created node id=` |
| 3.2 | 非法定义报错 | `node create --file bad.yaml`（非 YAML 内容） | 退出 1，stderr 含 `invalid node definition` |
| 3.3 | 列表（表格） | `node list` | 退出 0，输出含节点名 |
| 3.4 | 列表（JSON） | `node list --json` | 退出 0，stdout 可 JSON 解析且含节点名 |
| 3.5 | Mock 测试 | `node mock --id <N> --params '{"greeting":"e2e"}'` | 退出 0，输出含 `status=success`；`FLOWX_PARAM_GREETING` 与裸名 `GREETING` 均可读 |
| 3.6 | 节点包导入 | `node import --type folder --path <pkg>`（临时构造含 `flowx.json` 的目录） | 退出 0，输出含 `Imported node id=` |
| 3.7 | 删除节点 | `node delete --id <N>` | 退出 0，输出含 `Deleted node id=` |

### 12.3.4 流水线管理

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 4.1 | 创建流水线 | `pipeline create --name e2e-wf --file wf.yaml`（单节点 echo 工作流） | 退出 0，输出含 `Created pipeline id=` |
| 4.2 | 非法 YAML 重试指引 | `pipeline create --name bad --file bad.yaml`（缺 `Nodes`） | 退出 1，stderr 含 `Please regenerate the YAML and retry.` |
| 4.3 | 更新合并语义 | `pipeline update --id <N> --status active`（不传 `--file`） | 退出 0；随后 `GET /workflows/<N>` 的 `yamlConfig` 保持不变 |
| 4.4 | 列表 | `pipeline list --json` | 退出 0，含 `e2e-wf` |
| 4.5 | 执行并跟随日志 | `pipeline run --id <N> --follow` | 退出 0，输出含节点名与 `Execution finished: SUCCESS` |
| 4.6 | 失败执行退出码 | 创建必失败工作流（`run: exit 1`）后 `pipeline run --id <M> --follow` | 退出 1，输出含 `FAILED` |
| 4.7 | 删除流水线 | `pipeline delete --id <N>` | 退出 0，输出含 `Deleted pipeline id=` |

### 12.3.5 交互命令

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 5.1 | ask 默认值 | `echo "" \| ask --key env --prompt "?" --default prod` | 退出 0，stdout 为 `env=prod` |
| 5.2 | ask 选项校验 | `printf "bad\nstaging\n" \| ask --key env --prompt "?" --options prod,staging` | 退出 0，最终 stdout 含 `env=staging`（非法输入被拒绝后重试） |
| 5.3 | ask EOF | `ask --key k --prompt "?" </dev/null` | 退出非 0 或输出默认值 |
| 5.4 | info 卡片 | `info --title T --message M --level warn` | 退出 0，输出含 `T`、`M`、`WARN` |

### 12.3.6 错误路径

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 6.1 | server 未启动 | 停掉 server 后 `pipeline list` | 退出 1，stderr 含 `cannot connect to server` 和 `` `flowx-studio server` `` 提示 |
| 6.2 | 未知 flag | `pipeline list --nope` | 退出 2，stderr 含 `unknown flag` |
| 6.3 | 缺必填参数 | `pipeline create`（无 flag） | 退出 1，stderr 提示 `--schema` |

### 12.3.7 审计日志

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 7.1 | 审计记录生成 | `audit list` | 退出 0，含此前用例产生的 `create_node`、`run_workflow` 记录 |
| 7.2 | 按动作过滤 | `audit list --action create_node --json` | 退出 0，结果均为 `create_node` |

### 12.3.8 输入验证

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 8.1 | 非法节点名 | `node create`（name 以数字开头含特殊字符） | 退出 1，stderr 含 `name must start with a letter` |
| 8.2 | 不支持的语言 | `node create`（language: cobol） | 退出 1，stderr 含 `unsupported language` |

### 12.3.9 备份与恢复

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 9.1 | 创建备份 | `backup create` | 退出 0，输出含 `Created backup` |
| 9.2 | 备份列表 | `backup list` | 退出 0，含 `.db` 文件 |
| 9.3 | 下载备份 | `backup download --name <f> -o dl.db` | 退出 0，本地文件非空 |
| 9.4 | 运行中拒绝恢复 | server 运行中执行 `backup restore --file dl.db` | 退出 1，stderr 提示先 `server stop` |
| 9.5 | 停止后恢复 | `server stop` 后 `backup restore --file dl.db` | 退出 0，输出含 `Restored database`，自动生成 `.pre-restore` 回滚副本 |

### 12.3.10 健康检查与自动备份

| # | 目的 | 命令 | 预期 |
|---|------|------|------|
| 10.1 | 免认证健康检查 | `curl $BASE/api/v1/health`（不带 token） | HTTP 200，`status` 为 `ok`，含 db 计数指标 |
| 10.2 | 启动自动备份 | `server start` 后检查 `<data.dir>/backups/` | 存在至少一个 `.db` 备份文件 |

## 12.4 AI 驱动方式

**方式一：直接运行脚本（推荐）**

```bash
bash tests/e2e/run.sh
# 可选覆盖：
E2E_PORT=19099 E2E_BINARY=/path/to/flowx-studio bash tests/e2e/run.sh
```

脚本输出每个用例的 `PASS`/`FAIL`，结尾打印汇总；任一失败则以退出码 1 结束。

**方式二：逐步执行**

按 12.3 的表格逐条执行命令，比对「预期」列。适合脚本失败后定位具体用例，或 Agent 需要在步骤间插入额外检查（如查询数据库、查看 server.log）时使用。

## 12.5 维护约定

- 新增 CLI 命令或改变输出格式时，必须同步更新本文档表格与 `tests/e2e/run.sh`。
- 用例的预期文本尽量断言**稳定片段**（如 `Created pipeline id=`），不断言易变部分（时间戳、绝对路径）。
