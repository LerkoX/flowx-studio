---
name: flowx-studio
description: 管理 FlowX Studio 流水线与节点。当用户要求创建/修改/运行工作流（pipeline）、导入或创建节点、Mock 测试节点、查询执行实例的日志/节点返回数据/metadata、或续跑已结束的执行（追加节点）时使用。server 未运行时先执行 `flowx-studio server start` 启动（见「Server 生命周期」）。
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
| 原地更新节点（YAML 定义，保持 ID） | `flowx-studio node update --id <N> --file node.yaml` |
| 导入节点包（flowx.json） | `flowx-studio node import --type git --url <repo>` 或 `--type folder --path <dir>`；同名存在时加 `--overwrite` 原地更新 |
| Mock 测试节点 | `flowx-studio node mock --id <N> [--params '{...}']` |
| 删除节点 | `flowx-studio node delete --id <N>` |
| 列出流水线 | `flowx-studio pipeline list [--json]` |
| 创建流水线 | `flowx-studio pipeline create --name <n> --file wf.yaml` |
| 更新流水线 | `flowx-studio pipeline update --id <N> [--file wf.yaml] [--status active]` |
| 运行流水线 | `flowx-studio pipeline run --id <N> [--follow]` |
| 删除流水线 | `flowx-studio pipeline delete --id <N>` |
| 列出执行器实例（查 executor.ref 名称） | `flowx-studio executor list [--json]` |
| 创建执行器（docker 可多个，支持远程 host） | `flowx-studio executor create --file exec.yaml` |
| 设为全局默认执行器 | `flowx-studio executor set-default --id <N>` |
| 列出执行实例 | `flowx-studio execution list [--pipeline <N>] [--status success] --json` |
| 查询执行详情（metadata/参数） | `flowx-studio execution get --id <E> --json` |
| 导出执行的快照 YAML（独立图定义） | `flowx-studio execution yaml --id <E> > snap.yaml` |
| 查询节点状态与返回数据 | `flowx-studio execution nodes --id <E> --json` |
| 查询节点日志 | `flowx-studio execution logs --id <E> [--node <节点ID>] [--level error] --json` |
| 续跑已结束的执行（可追加节点） | `flowx-studio execution continue --id <E> [--file wf.yaml] [--follow]` |
| 暂停运行中的执行（层边界生效） | `flowx-studio execution pause --id <E>` |
| 恢复已暂停的执行 | `flowx-studio execution resume --id <E> [--follow]` |
| 向用户提问 | `flowx-studio ask --key <k> --prompt "<问题>" [--options a,b,c] [--default v]` |
| 展示信息卡片 | `flowx-studio info --title <t> --message <m> [--level info\|warn\|error]` |

## 约定

- 认证：CLI 自动读取 `<data-dir>/auth.token`（或 `FLOWX_STUDIO_AUTH_TOKEN`），无需手动配置；401 时提示用户检查 token。
- 退出码：`0` 成功；`1` 业务/校验失败（stderr 含错误详情与重试指引，修正后重试同一命令）；`2` 用法错误。
- YAML 校验失败时按 stderr 的错误详情修正 YAML 后重试（错误文本即重试指令）。
- 生成 FlowX YAML 时优先用 `config.nodeRef` 引用 `node list` 查到的已有节点，不要内联节点代码。
- 节点间传参：flowx.json 模板只允许 `{{ Param.* }}`；上游节点数据在 pipeline YAML 节点 `config.params` 中绑定（如 `weatherCity: "{{ GetWeather.city }}"`，实例 ID 用本 YAML `Nodes` 的键）。节点参数上的 `source` 字段标注了推荐来源节点包和输出字段，可依此接线；未绑定的参数回退到 pipeline 级 `Param`。详见 `docs/11-node-package.md` 11.7 节。
- YAML 要求：`Name` 非空；`Nodes` 为非空 map；`Graph` 以 `stateDiagram-v2` 开头且至少一条迁移（支持 `[*]` 起止节点）；节点声明的 `executor` 必须在 `Executors` 中定义。
- **节点 ID 仅支持 ASCII**（字母/数字/下划线/连字符）：`Nodes` 的键与 `Graph` 中的节点名禁止使用中文等非 ASCII 字符（底层 mermaid 解析器会静默丢弃含非 ASCII 标识符的边，导致接线断裂、节点变孤立起点）。显示名可用中文——通过节点的 `name` 字段设置（如 `name: 回声`），不影响图解析。
- `ask` 的回答从 stdout 以 `key=value` 形式输出；`info` 为纯终端卡片，两者都不访问 server。
- `pipeline update` 省略的字段会保留原值（CLI 自动合并）。
- `execution pause` / `execution resume`：暂停/恢复运行中的执行。层边界暂停——状态立即置为 `paused`，当前并发层节点执行完后挂起（不中断运行中的节点）。暂停时自动导出运行时快照，**server 重启后 resume 会从快照重建并增量续跑**（已终结节点跳过，崩溃时 RUNNING 的节点重跑）。`paused` 状态不可 `continue`
- `execution continue` 用于已结束（success/failed/cancelled）的执行实例：不带 `--file` 时增量重跑（已终结节点跳过）；带 `--file` 时更新该执行的**运行时快照**（可追加节点）再继续运行。续跑沿用同一执行 ID，日志与节点记录追加，可通过 `execution logs/nodes/get` 查询。
- **执行实例是独立于模板的个体**：续跑修改的是该执行的快照（DB `runtime_yaml`），不是流水线定义；前端回放态画布也按快照渲染。标准改法：`execution yaml --id <E> > snap.yaml` 导出快照 → 编辑（Graph 加边、Nodes 加节点）→ `execution continue --id <E> --file snap.yaml`。
- **快照编辑规则**：快照中已有的节点保持原样（物化形式，带 steps，展开器会跳过）；**新增节点直接写编写态**（`config.nodeRef` + `config.params`，无需 steps/executor，展开器自动物化并复用快照中同类型的执行器条目）；`Version`/`Name` 不可变、已执行节点不可删改、`Executors` 已有条目不可改删但**允许新增**（追加 docker 等异构节点时）。

## 节点编写指南（创建/修改节点包时必读）

节点包 = 一个目录：`flowx.json`（清单，必需）+ 入口代码 + 可选 `ui/`（自定义画布组件）。完整规范见仓库 `docs/11-node-package.md`，以下为速查：

### flowx.json 规范

- 必填：`name`（字母开头，snake_case/kebab-case）、`language`、`entry`（文件必须存在）、`parameters`（可为空数组）
- 每个参数的 `description` 必须详细说明所需数据（格式/单位/取值），这是 pipeline 接线的依据；推荐加 `source: { nodeRef, output }` 标注推荐来源节点包
- 参数注入优先 `env`（`{"CITY": "{{ Param.city }}"}`），模板只允许 `{{ Param.* }}` 或字面量，禁止引用节点实例 ID
- 输出用 `extract: {"type": "codec-block"}`（代码打印 ```flowx-yaml 块）或 `regex`
- Mock 测试：`mock: {enabled: true, entry: "mock.py"}`，可用 `FLOWX_PARAM_*` 或裸大写参数名读参

### 自定义 UI 组件（可选，module 模式）

画布节点可内嵌节点包自带的前端组件。flowx.json 声明：

```json
"ui": { "entry": "ui/node-widget.js", "width": 300, "height": 230, "collapsed": false, "apiVersion": 1 }
```

- `entry`：包内预编译单文件 `.js` bundle（≤10MB），格式不限——ESM 默认导出 `mount`，或 IIFE 调用 `window.FlowXNodeWidget.define(mount)`
- 契约：`mount(el, props) => { update(props), unmount() }`；`props` 只读，含 `status`/`inputs`/`outputs`/`execution`（流水线实时 metadata，无运行实例为 null）
- 参考实现：免构建原生 JS 示例 `tests/e2e/testdata/ui-demo-node/ui/node-widget.js`；React+Vite 工程模板 `templates/node-widget/`
- 改组件后只需重新 `node import` 生效，无需重启 server；在「节点管理→测试」面板有 UI 预览
- 安全：组件代码在 Studio 前端上下文执行，只导入可信来源

### 导入与验证

1. `node import --type folder --path <dir>`（校验失败按 stderr 修正重试）
2. `node mock --id <N>` 验证节点逻辑（有 mock 时）
3. 同名节点已存在时：`node import ... --overwrite` 原地更新（保持节点 ID，pipeline 按 nodeRef 名称引用不受影响）；或 `node update --id <N> --file node.yaml` 更新 YAML 定义的节点
4. 画布验证：pipeline YAML 用 `config.nodeRef: <name>` 引用后运行，浏览器查看内嵌 UI

## 典型流程

0. `server status` 确认 server 运行中；若 `stopped` 则 `server start`
1. `node list --json` 查询可用节点 → 生成 YAML 写入临时文件
2. `pipeline create --name ... --file wf.yaml`（失败则按 stderr 修正重试）
3. 需要新节点时：编写 `flowx.json` + 代码 → `node import --type folder --path <dir>` → 回到第 2 步
4. 需要用户决策时：`ask --key ... --prompt ...`，读取 stdout 的 `key=value`
5. `pipeline run --id <N> --follow` 执行并跟随日志
6. 执行后排查/取数：`execution get`（metadata）、`execution nodes`（节点返回）、`execution logs`（节点日志）
7. 需要在已结束的执行上追加节点继续跑：`execution yaml --id <E> > snap.yaml` 导出快照 → 编辑（新节点写编写态即可）→ `execution continue --id <E> --file snap.yaml --follow`
8. `info --title 执行完成 --message ...` 向用户汇报结果
