---
name: flowx-studio
description: 管理 FlowX Studio 流水线与节点。当用户要求创建/修改/运行工作流（pipeline）、导入或创建节点、Mock 测试节点时使用。server 未运行时先执行 `flowx-studio server start` 启动（见「Server 生命周期」）。
---

# FlowX Studio

通过 `flowx-studio` CLI 与本地 server 交互（HTTP REST，默认 `http://127.0.0.1:8080`，可用 `--server` 或 `FLOWX_STUDIO_SERVER_URL` 覆盖）。

每个子命令支持：
- `--help`：查看完整用法与示例（L2 用法层）
- `--schema`：输出参数的 JSON Schema 后退出（L3 契约层，用于精确构造参数）
- `--json`：以 JSON 输出结果（查询类命令）

## Server 生命周期（先读这里）

调用任何 pipeline/node 命令前，先确保 server 在运行：
1. `flowx-studio server status` → 输出 `stopped` 则执行第 2 步
2. `flowx-studio server start` → 后台启动并阻塞到就绪，输出 `Server started pid=N url=...`
3. 启动失败时查看 `~/.flowx-studio/server.log`

（`server stop` 用于显式停止；通常无需停止，server 单例常驻即可。）

## 命令速查

| 任务 | 命令 |
| --- | --- |
| 检查/启动/停止 server | `flowx-studio server status` / `server start` / `server stop` |
| 列出节点（查 nodeRef 名称） | `flowx-studio node list --json` |
| 创建节点 | `flowx-studio node create --file node.yaml` |
| 导入节点包（flowx.json） | `flowx-studio node import --type git --url <repo>` 或 `--type folder --path <dir>` |
| Mock 测试节点 | `flowx-studio node mock --id <N> [--params '{...}']` |
| 删除节点 | `flowx-studio node delete --id <N>` |
| 列出流水线 | `flowx-studio pipeline list [--json]` |
| 创建流水线 | `flowx-studio pipeline create --name <n> --file wf.yaml` |
| 更新流水线 | `flowx-studio pipeline update --id <N> [--file wf.yaml] [--status active]` |
| 运行流水线 | `flowx-studio pipeline run --id <N> [--follow]` |
| 删除流水线 | `flowx-studio pipeline delete --id <N>` |
| 向用户提问 | `flowx-studio ask --key <k> --prompt "<问题>" [--options a,b,c] [--default v]` |
| 展示信息卡片 | `flowx-studio info --title <t> --message <m> [--level info\|warn\|error]` |

## 约定

- 认证：CLI 自动读取 `<data-dir>/auth.token`（或 `FLOWX_STUDIO_AUTH_TOKEN`），无需手动配置；401 时提示用户检查 token。
- 退出码：`0` 成功；`1` 业务/校验失败（stderr 含错误详情与重试指引，修正后重试同一命令）；`2` 用法错误。
- YAML 校验失败时按 stderr 的错误详情修正 YAML 后重试（错误文本即重试指令）。
- 生成 FlowX YAML 时优先用 `config.nodeRef` 引用 `node list` 查到的已有节点，不要内联节点代码。
- YAML 要求：`Name` 非空；`Nodes` 为非空 map；`Graph` 以 `stateDiagram-v2` 开头且至少一条迁移（支持 `[*]` 起止节点）；节点声明的 `executor` 必须在 `Executors` 中定义。
- `ask` 的回答从 stdout 以 `key=value` 形式输出；`info` 为纯终端卡片，两者都不访问 server。
- `pipeline update` 省略的字段会保留原值（CLI 自动合并）。

## 典型流程

0. `server status` 确认 server 运行中；若 `stopped` 则 `server start`
1. `node list --json` 查询可用节点 → 生成 YAML 写入临时文件
2. `pipeline create --name ... --file wf.yaml`（失败则按 stderr 修正重试）
3. 需要新节点时：编写 `flowx.json` + 代码 → `node import --type folder --path <dir>` → 回到第 2 步
4. 需要用户决策时：`ask --key ... --prompt ...`，读取 stdout 的 `key=value`
5. `pipeline run --id <N> --follow` 执行并跟随日志
6. `info --title 执行完成 --message ...` 向用户汇报结果
