---
name: flowx-studio
description: 管理 FlowX Studio 流水线与节点。当用户要求创建/修改/运行工作流（workflow）、导入或创建节点、Mock 测试节点、查询执行实例的日志/节点返回数据/metadata、或续跑已结束的执行（追加节点）时使用。server 未运行时先执行 `flowx-studio server start` 启动（见「Server 生命周期」）。
---

# FlowX Studio

通过 `flowx-studio` CLI 与本地 server 交互（HTTP REST，默认 `http://127.0.0.1:8080`，可用 `--server` 或 `FLOWX_STUDIO_SERVER_URL` 覆盖）。

每个子命令支持：
- `--help`：查看完整用法与示例（L2 用法层）
- `--schema`：输出参数的 JSON Schema 后退出（L3 契约层，用于精确构造参数）
- `--json`：以 JSON 输出结果（查询类命令）

## Server 生命周期（先读这里）

调用任何 workflow/node 命令前，先确保 server 在运行：
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
| 导入节点包（flowx.json） | `flowx-studio node import --type git --url <repo>` 或 `--type folder --path <dir>`；同名同版本存在时加 `--overwrite` 原地更新；同名不同版本直接并存 |
| Mock 测试节点 | `flowx-studio node mock --id <N> [--params '{...}']` |
| 删除节点 | `flowx-studio node delete --id <N>` |
| 列出流水线 | `flowx-studio workflow list [--json]` |
| 创建流水线 | `flowx-studio workflow create --name <n> --file wf.yaml` |
| 更新流水线 | `flowx-studio workflow update --id <N> [--file wf.yaml] [--status active]` |
| 运行流水线 | `flowx-studio workflow run --id <N> [--follow]` |
| 删除流水线 | `flowx-studio workflow delete --id <N>` |
| 列出执行器实例（查 executor.ref 名称） | `flowx-studio executor list [--json]` |
| 创建执行器（docker 可多个，支持远程 host） | `flowx-studio executor create --file exec.yaml` |
| 设为全局默认执行器 | `flowx-studio executor set-default --id <N>` |
| 禁用/启用执行器（docker 实例；禁用后类型解析跳过、按名引用报错；默认执行器禁止禁用） | `flowx-studio executor disable --id <N>` / `executor enable --id <N>` |
| 测试 docker 执行器与 daemon 的连接状态（不创建容器；仅 docker 实例；失败退出码 1） | `flowx-studio executor test --id <N>` |
| 列出执行实例 | `flowx-studio execution list [--workflow <N>] [--status success] --json` |
| 查询执行详情（metadata/参数） | `flowx-studio execution get --id <E> --json` |
| 导出执行的快照 YAML（独立图定义） | `flowx-studio execution yaml --id <E> > snap.yaml` |
| 查询节点状态与返回数据 | `flowx-studio execution nodes --id <E> --json` |
| 查询节点日志 | `flowx-studio execution logs --id <E> [--node <节点ID>] [--level error] --json` |
| 续跑已结束的执行（可追加节点） | `flowx-studio execution continue --id <E> [--file wf.yaml] [--follow] [--no-run]` |
| 结构化读/改 YAML（局部操作，避免全文进出上下文） | `flowx-studio yaml graph/nodes/get <file>`；`yaml add-node/add-edge/remove-edge <file>` |
| 暂停运行中的执行（层边界生效） | `flowx-studio execution pause --id <E>` |
| 恢复已暂停的执行 | `flowx-studio execution resume --id <E> [--follow]` |

## 约定

- 认证：CLI 自动读取 `<data-dir>/auth.token`（或 `FLOWX_STUDIO_AUTH_TOKEN`），无需手动配置；401 时提示用户检查 token。
- 退出码：`0` 成功；`1` 业务/校验失败（stderr 含错误详情与重试指引，修正后重试同一命令）；`2` 用法错误。
- YAML 校验失败时按 stderr 的错误详情修正 YAML 后重试（错误文本即重试指令）。
- 生成 FlowX YAML 时优先用 `config.nodeRef` 引用 `node list` 查到的已有节点，不要内联节点代码。引用支持版本锁定：`name@version` 精确锁定（生产流水线推荐），裸 `name` 解析到该名称的最新版本（import 新版本后行为会漂移）。
- 节点间传参：flowx.json 模板只允许 `{{ Param.* }}`；上游节点数据在 workflow YAML 节点 `config.params` 中绑定（如 `weatherCity: "{{ GetWeather.city }}"`，实例 ID 用本 YAML `Nodes` 的键）。节点参数上的 `source` 字段标注了推荐来源节点包和输出字段，可依此接线；未绑定的参数回退到 workflow 级 `Param`。详见 `docs/11-node-package.md` 11.7 节。
- YAML 要求：`Name` 非空；`Nodes` 为非空 map；`Graph` 以 `stateDiagram-v2` 开头且至少一条迁移（支持 `[*]` 起止节点）；内联节点声明的 `executor` 必须在 `Executors` 中定义，`nodeRef` 节点由展开器自动补充。
- **节点 ID 仅支持 ASCII**（字母/数字/下划线/连字符）：`Nodes` 的键与 `Graph` 中的节点名禁止使用中文等非 ASCII 字符（底层 mermaid 解析器会静默丢弃含非 ASCII 标识符的边，导致接线断裂、节点变孤立起点）。显示名可用中文——通过节点的 `name` 字段设置（如 `name: 回声`），不影响图解析。
- `workflow update` 省略的字段会保留原值（CLI 自动合并）。
- `execution pause` / `execution resume`：暂停/恢复运行中的执行。层边界暂停——状态立即置为 `paused`，当前并发层节点执行完后挂起（不中断运行中的节点）。暂停时自动导出运行时快照，**server 重启后 resume 会从快照重建并增量续跑**（已终结节点跳过，崩溃时 RUNNING 的节点重跑）。`paused` 状态不可 `continue`
- `execution continue` 用于已结束（success/failed/cancelled）的执行实例：不带 `--file` 时增量重跑（已终结节点跳过）；带 `--file` 时更新该执行的**运行时快照**（可追加节点）再继续运行。续跑沿用同一执行 ID，日志与节点记录追加，可通过 `execution logs/nodes/get` 查询。
- **执行实例是独立于模板的个体**：续跑修改的是该执行的快照（DB `runtime_yaml`），不是流水线定义；前端回放态画布也按快照渲染。标准改法：`execution yaml --id <E> > snap.yaml` 导出快照 → 编辑（Graph 加边、Nodes 加节点）→ `execution continue --id <E> --file snap.yaml`。`--no-run` 仅更新快照不执行（后端校验并展开新节点后持久化），之后 `execution continue --id <E>`（不带 --file）按需执行新增节点。
- **长 YAML 用 `yaml` 子命令做局部读写**（纯本地文件操作）：快照物化节点的 steps 很占篇幅，不要整份读入上下文。`yaml nodes <f>`（节点概要：id/名称/nodeRef，无 steps）、`yaml graph <f>`（仅 mermaid 接线）、`yaml get <f> <节点ID>`（单节点子树）、`yaml add-node <f> --id N --ref echo@1.1.0 [--name 名称] [--param k=v]... [--after A]`（追加编写态节点；--after 自动把 A 的出边改经新节点，含 `[*]`）、`yaml add-edge/remove-edge <f> --from A --to B`（幂等加边/按对删边）。写操作整体重编码（键按字母序、丢注释），语义无影响。
- **快照编辑规则**：快照中已有的节点保持原样（物化形式，带 steps，展开器会跳过）；**新增节点直接写编写态**（`config.nodeRef` + `config.params`，可选 `config.executor`，无需节点级 `executor`/`steps`，展开器自动物化并复用快照中同类型的执行器条目）；`Version`/`Name` 不可变、已执行节点不可删改、`Executors` 已有条目不可改删但**允许新增**（追加 docker 等异构节点时）。

## Workflow YAML 最小契约（无代码库时按此编写）

`workflow create --schema` 返回的是 CLI 入参 schema，不是 Workflow YAML schema。当前核心顶层字段为 `Version`、`Name`、`Metadate`（历史拼写）、`AI`、`Param`、`Executors`、`Logging`、`Graph`、`Nodes`、`MaxLoopIterations`；编排时通常只写 `Name`、`Param`（可选）、`Graph`、`Nodes`、`MaxLoopIterations`（仅回环图），其余高级字段没有用户明确要求或完整文档时不要生成。

### nodeRef 编写态模板（首选）

编排已有节点包时使用此形式；默认不写 `steps`、节点级 `executor`、`Executors`，需要覆盖执行器时仅写 `config.executor`（见下文）：

```yaml
Name: echo-chain
Graph: |
  stateDiagram-v2
    [*] --> FirstEcho
    FirstEcho --> SecondEcho
    SecondEcho --> [*]
Nodes:
  FirstEcho:
    name: 第一个回声
    config:
      nodeRef: echo@1.1.0
      params:
        message: "hello"          # 单节点使用的值直接写字面量，不要提升为 workflow Param
  SecondEcho:
    name: 第二个回声
    config:
      nodeRef: echo@1.1.0
      params:
        message: "{{ FirstEcho.text }}"
```

- `Name`/`Graph`/`Nodes` 必填；`Graph` 必须以 `stateDiagram-v2` 开头且至少一条迁移。
- `Nodes` 的键与 `Graph` 节点名必须是 ASCII；`name`/`description` 可写中文展示名。
- `config.nodeRef` 用 `node list --json` 查询到的 `name` 或 `name@version`；生产流水线优先精确版本。
- `config.params` 的值可为常量、`{{ UpstreamNode.output }}` 或 `{{ Param.key }}`；按节点 `parameters[].source` 推荐接线。未绑定的参数回退到同名 workflow 级 `Param`。

#### Workflow 级 `Param` 使用原则（重要）

**默认把值写死在节点自己的 `config.params` 里（字面量），不要放进 workflow 级 `Param`。** 只有同时满足以下条件的值才提升到 `Param`：

1. **被多个节点引用**（如所有节点都需要的 `service_url`/`service_token`、多个节点共用的 `project_dir`）；或
2. **公共配置类**——用户运行前需要统一调整的全局开关/地址/凭证。

仅被单个节点使用的参数（如某个采样节点的 `steps`/`cfg`、某个编码节点的 prompt）必须直接写为 `config.params` 字面量，不要用 `{{ Param.xxx }}` 绕一层——这只会让 YAML 更散、参数来源更难追踪。判断口诀：**"这个值改的时候是不是希望全流水线一起生效？" 是→`Param`；否→写死在节点里。**

审查/整改既有流水线时同样按此处理：统计每个 `Param` 键被 `Nodes` 引用的节点数，仅 1 个节点引用的内联回该节点并删除 `Param` 条目，无人引用的直接删除；`Param` 清空后移除整个 `Param:` 块。

- 纯 `nodeRef` 流水线通常省略顶层 `Executors` 和节点级 `executor`，运行时按节点包偏好自动选择。需要覆盖时在 `config.executor` 中写已选中的执行器（见下文），不要使用顶层 `Executors` 去覆盖节点包。
- `config.executor` 支持三种写法：`executor: local` / `executor: docker`（类型级选择）、`executor: docker-gpu`（具体实例简写）、`executor: {type: docker, ref: docker-gpu}`（推荐显式写法）。实例类型必须在节点包 `executor.supportedTypes` 中；同一次编排中所有选择 Docker 的节点通常复用同一个已选实例。
- 顶层 `Executors` 一旦存在，校验器会要求**内联节点**都有节点级 `executor` 字段；`nodeRef` 节点由展开器补充，因此混合流水线无需给 nodeRef 节点重复声明。nodeRef-only 模板不要添加空 `Executors`。

显式覆盖单个 nodeRef 节点时写：

```yaml
Nodes:
  Train:
    config:
      nodeRef: train@1.0.0
      executor:
        type: docker
        ref: docker-gpu
```

### 内联节点模板（仅用户明确要求或没有可复用节点包时）

```yaml
Name: inline-demo
Graph: |
  stateDiagram-v2
    [*] --> Echo
    Echo --> [*]
Nodes:
  Echo:
    name: 内联回声
    executor: local-shell
    steps:
      - name: run
        run: |
          printf '```flowx-yaml\n'
          printf 'text: "hello"\n'
          printf '```\n'
    extract:
      type: codec-block
Executors:
  local-shell:
    type: local
    config:
      shell: bash
```

- `Executors` 是 map：键为流水线内执行器名，字段为 `type`（当前用 `local`/`docker`）、可选 `description`、可选 `config`。
- 内联节点必须设置 `executor` 并引用 `Executors` 中已定义的键；`steps[].run` 是 shell 脚本；需要输出时显式设置 `extract.type: codec-block` 并打印 ```flowx-yaml 块。
- local 常用 `config`：`shell`、`workdir`、`timeout`、`env`、`pty`。
- docker 常用 `config`：`image`、`host`、`tlsVerify`、`certPath`、`registry`、`network`、`workdir`、`volumes`、`env`、`tty`。内联 docker 示例：

```yaml
Executors:
  python-docker:
    type: docker
    config:
      image: python:3.11-slim
      workdir: /app
```

- `id`、`runtime` 是快照/运行时字段，编写新流水线时不要手写；已物化的快照节点带 `steps`，按快照编辑规则处理。

## 节点编写指南（创建/修改节点包时必读）

节点包 = 一个目录：`flowx.json`（清单，必需）+ 入口代码 + 可选 `ui/`（自定义画布组件）。完整规范见仓库 `docs/11-node-package.md`，以下为速查：

### flowx.json 规范

- 必填：`name`（字母开头，snake_case/kebab-case）、`language`、`entry`（文件必须存在）、`parameters`（可为空数组）
- 每个参数的 `description` 必须详细说明所需数据（格式/单位/取值），这是 workflow 接线的依据；推荐加 `source: { nodeRef, output }` 标注推荐来源节点包
- 执行器能力用 `executor.supportedTypes` + `executor.preferredType` 声明（不绑定用户实例名）；详见下文「执行器选择」
- 参数注入优先 `env`（`{"CITY": "{{ Param.city }}"}`），模板只允许 `{{ Param.* }}` 或字面量，禁止引用节点实例 ID
- 输出用 `extract: {"type": "codec-block"}`（代码打印 ```flowx-yaml 块）或 `regex`
- Mock 测试：`mock: {enabled: true, entry: "mock.py"}`，可用 `FLOWX_PARAM_*` 或裸大写参数名读参

### 执行器选择（节点包与流水线编排必读）

节点包会被不同用户/环境复用，**flowx.json 不绑定用户自建执行器实例名**。新节点包只声明支持的执行器类型与偏好：

```json
"executor": {
  "supportedTypes": ["local", "docker"],
  "preferredType": "local"
}
```

- `supportedTypes`：节点支持 `local`/`docker` 中的哪些类型；为空时走旧版兼容规则。
- `preferredType`：默认偏好的类型，必须包含在 `supportedTypes` 中；缺省时使用 `supportedTypes[0]`。
- 依赖宿主机 CLI/路径的节点写 `supportedTypes: ["local"]`；必须容器隔离/特定镜像的写 `["docker"]`；两者都能运行才写 `["local", "docker"]`。
- `image` 是 Docker 能力声明，不代表必须 Docker；是否用 Docker 由 `supportedTypes/preferredType` 或 workflow 选择决定。
- 旧字段 `executor.ref`/`executor.type` 仍兼容已有节点；新节点包不要写 `ref`（实例名属于用户环境），也不要用 `type` 替代 portable 声明。

运行时解析优先级：workflow 节点 `config.executor` 显式选择 → 旧版 `executor.ref` → 旧版 `executor.type` → `supportedTypes/preferredType`（偏好类型不可用时按 supportedTypes 顺序降级）→ 仅有 `image` 归 docker → 全局默认执行器。`node list --json` 的顶层 `executor` 字段透出节点包声明，编排前先查看。

创建/更新 workflow 时的 AI 选择策略：

1. 先按各节点 `preferredType` 生成 YAML，**不逐节点询问**。
2. 只有用户明确要求指定/切换执行器，或偏好类型不可用且存在多个可降级类型时才询问；按“执行器类型”聚合询问，不按节点逐个询问。
3. 若选中 `docker` 且系统有多个 Docker 实例，再询问一次以选择具体实例；同一 workflow 中所有被选为 Docker 的节点默认复用该实例。
4. 对单个节点有特殊要求时，只覆盖该节点的 `config.executor`。

nodeRef 节点显式选择写法（推荐对象形式）：

```yaml
config:
  nodeRef: train@1.0.0
  executor:
    type: docker
    ref: docker-gpu
```

也支持简写 `executor: docker`（类型级）或 `executor: docker-gpu`（实例级）。选择必须被节点 `supportedTypes` 允许；未声明 `supportedTypes` 的旧节点不做限制。


### 自定义 UI 组件（可选，module 模式）

画布节点可内嵌节点包自带的前端组件。flowx.json 声明：

```json
"ui": { "entry": "ui/node-widget.js", "width": 300, "height": 230, "collapsed": false, "apiVersion": 1 }
```

- **节点 UI 一律在节点自己的 ui bundle 中实现，禁止改 flowx-studio 前端来实现节点级 UI**：参数控件、实时预览、进度条、结果展示等所有节点特有 UI 都属于节点包；GlowNode/WorkflowCanvas 等画布外壳只保留所有节点通用的基础元素（图标/名称/状态徽章/连接点/入参返回区）。Studio 侧的合法改动仅限通用数据管道（如把数据透传进 `props`）
- `entry`：包内预编译单文件 `.js` bundle（≤10MB），格式不限——ESM 默认导出 `mount`，或 IIFE 调用 `window.FlowXNodeWidget.define(mount)`
- 契约：`mount(el, props) => { update(props), unmount() }`；`props` 含 `status`/`inputs`/`outputs`/`execution`（流水线实时 metadata，无运行实例为 null）与 `params`（该节点实例当前的 `config.params` 绑定值，常量或 `{{ 上游.输出 }}` 模板原样下发）
- **实时预览（`props.preview`，可选）**：节点脚本执行中途向 `FLOWX_CALLBACK_URL`（转发给远程服务时用 `FLOWX_CALLBACK_URL_PUBLIC`）POST `{"image": "<base64>", "mime": "image/jpeg", "progress": 0~1}`，Studio 广播 `node_preview` SSE 并把最新帧透传为 `props.preview`（瞬态：node_complete 清除、回放态缺省，必须判空）。参考实现：flowx-pixelforge `nodes/ksampler/ui/node-widget.js` 预览面板 + `inference-server/app/preview.py` 推送端
- **参数来源标注（必做）**：渲染参数时不要直接展示 `{{ Param.xxx }}` 原始绑定串，优先用 `props.paramSources[key]` 渲染来源说明——`workflow` → `⚡ 流水线参数 · 参数名 = 当前值`（附 paramValue）；`node` → `🔗 上游节点显示名 · 字段`（执行中/回放时用 runtimeValue 补实时值）；`literal` → `✏️ 自定义值`。`paramSources` 缺省时（旧版 Studio）才回退展示原始绑定串。参考实现：flowx-txt2img 各节点 widget 的 `sourceCaptionOf`
- **参数调整控件**：组件渲染滑杆/下拉等控件后调用 `props.onParamsChange(params)` 把**完整参数表**写回该节点的 `config.params`（全量替换，传 `{}` 清空），Studio 自动写回 workflow YAML 并持久化；回放态（查看历史执行快照）下 `onParamsChange` 为 undefined，调用前必须判空进入只读模式
- 参考实现：免构建原生 JS 示例 `tests/e2e/testdata/ui-demo-node/ui/node-widget.js`；React+Vite 工程模板 `templates/node-widget/`
- 改组件后只需重新 `node import` 生效，无需重启 server；在「节点管理→测试」面板有 UI 预览（预览中 onParamsChange 写回 Mock 测试的输入参数表单）
- 安全：组件代码在 Studio 前端上下文执行，只导入可信来源

### 导入与验证

1. `node import --type folder --path <dir>`（校验失败按 stderr 修正重试）
2. `node mock --id <N>` 验证节点逻辑（有 mock 时）
3. 同名同版本节点已存在时：`node import ... --overwrite` 原地更新（保持节点 ID，按 `name@version` 精确引用的流水线不受影响）；同名不同版本直接 import 即可并存（裸名称引用的流水线会解析到最新版本——想稳定就在 YAML 里写 `nodeRef: <name>@<version>`；反之注意：**版本锁定的流水线不会自动获得新版本的代码与 UI**，升级节点后需把流水线中的 nodeRef 改为新版本）
4. 画布验证：workflow YAML 用 `config.nodeRef: <name>` 引用后运行，浏览器查看内嵌 UI

## 典型流程

0. `server status` 确认 server 运行中；若 `stopped` 则 `server start`
1. `node list --json` 查询可用节点 → 按「Workflow YAML 最小契约」生成 YAML 写入临时文件
2. `workflow create --name ... --file wf.yaml`（失败则按 stderr 修正重试）
3. 需要新节点时：编写 `flowx.json` + 代码 → `node import --type folder --path <dir>` → 回到第 2 步
4. 需要用户决策时：直接在对话中向用户提问
5. `workflow run --id <N> --follow` 执行并跟随日志
6. 执行后排查/取数：`execution get`（metadata）、`execution nodes`（节点返回）、`execution logs`（节点日志）
7. 需要在已结束的执行上追加节点继续跑：`execution yaml --id <E> > snap.yaml` 导出快照 → 编辑（新节点写编写态即可）→ `execution continue --id <E> --file snap.yaml --follow`
8. 在对话中向用户汇报执行结果
