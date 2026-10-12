# 4. API 设计

## 4.1 设计原则

- **RESTful 风格**：使用标准 HTTP 方法和状态码
- **JSON 格式**：请求和响应统一使用 JSON
- **资源命名**：使用名词复数形式，如 `/api/nodes`、`/api/workflows`
- **版本控制**：URL 中包含版本号 `/api/v1/...`
- **错误统一**：错误响应与成功响应使用相同的封装结构

## 4.2 基础响应格式

### 成功响应

```json
{
  "code": 200,
  "message": "success",
  "data": { }
}
```

### 错误响应

```json
{
  "code": 400,
  "message": "invalid request body: ..."
}
```

## 4.2.1 认证与限流

- **认证**（2026-08-18 起）：所有 `/api/v1` 请求需携带认证信息，二选一：
  - `Authorization: Bearer <token>` 请求头（CLI 与其他客户端）
  - `flowx_token` cookie（Web UI：服务端返回 `index.html` 时自动种下）
  
  token 位于数据目录的 `auth.token` 文件（首次启动自动生成，0600 权限），可用 `FLOWX_STUDIO_SERVER_AUTH_TOKEN` 覆盖。认证失败返回 `401`。
- **限流**：每 IP 100 请求/分钟（突发 50），超限返回 `429`。

## 4.3 节点管理 API

### 4.3.1 获取节点列表

```http
GET /api/v1/nodes
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| language | string | 否 | 按语言过滤 |
| tag | string | 否 | 按标签过滤 |
| search | string | 否 | 关键词搜索（名称和描述） |
| node_type | string | 否 | 按节点类型过滤（code / image） |
| page | integer | 否 | 页码，默认 1 |
| page_size | integer | 否 | 每页数量，默认 20 |

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "id": 1,
        "name": "image_downloader",
        "displayName": "图片下载器",
        "description": "从指定 URL 下载图片",
        "nodeType": "code",
        "language": "python",
        "parameters": [
          {
            "name": "url",
            "type": "string",
            "description": "图片 URL",
            "required": true
          }
        ],
        "tags": ["image", "download"],
        "createdAt": "2025-01-15T10:30:00Z",
        "updatedAt": "2025-01-15T10:30:00Z"
      }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 20
  }
}
```

### 4.3.2 创建节点

```http
POST /api/v1/nodes
```

**请求体**：绑定 `model.Node` 结构，`name` 必填；名称重复返回 409。

```json
{
  "name": "image_downloader",
  "displayName": "图片下载器",
  "description": "从指定 URL 下载图片",
  "nodeType": "code",
  "language": "python",
  "entry": "main.py",
  "code": "import requests...",
  "requirements": ["requests", "pillow"],
  "parameters": [
    {
      "name": "url",
      "type": "string",
      "description": "图片 URL",
      "required": true
    }
  ],
  "tags": ["image", "download"]
}
```

**响应示例**：返回创建后的完整节点对象（结构同 4.3.3）。

### 4.3.3 获取节点详情

```http
GET /api/v1/nodes/:id
```

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 1,
    "name": "image_downloader",
    "displayName": "图片下载器",
    "description": "从指定 URL 下载图片",
    "version": "1.0.0",
    "nodeType": "code",
    "language": "python",
    "entry": "main.py",
    "code": "import requests...",
    "requirements": ["requests", "pillow"],
    "parameters": [
      {
        "name": "url",
        "type": "string",
        "description": "图片下载地址",
        "required": true
      },
      {
        "name": "timeout",
        "type": "integer",
        "description": "超时时间（秒）",
        "required": false,
        "default": 30
      }
    ],
    "outputs": [
      {
        "name": "file_path",
        "type": "string",
        "description": "下载后的本地文件路径"
      }
    ],
    "docker": {
      "image": "python:3.11-slim",
      "workdir": "/app"
    },
    "mock": {
      "enabled": true,
      "entry": "mock.py",
      "code": "# 返回模拟图片数据..."
    },
    "sourceType": "git",
    "sourceURL": "https://github.com/example/flowx-nodes",
    "sourcePath": "nodes/image_downloader",
    "tags": ["image", "download"],
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-15T10:30:00Z"
  }
}
```

**说明**：
- `nodeType` 为 `code`（代码节点）或 `image`（镜像节点）；镜像节点使用 `image` 字段而非 `language`/`code`。
- `requirements` 为字符串数组。
- `mock` 与 `docker` 为可选对象，未配置时不出现在响应中（`omitempty`）。

### 4.3.4 更新节点

```http
PUT /api/v1/nodes/:id
```

**请求体**：同创建节点（`model.Node` 结构，全量更新）。

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 1
  }
}
```

### 4.3.5 删除节点

```http
DELETE /api/v1/nodes/:id
```

**响应**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "message": "node deleted"
  }
}
```

### 4.3.6 导入节点

```http
POST /api/v1/nodes/import
```

从 Git 仓库或本地文件夹导入节点包（读取其中的 `flowx.json`）。

**请求体**：
```json
{
  "source_type": "git",
  "source_url": "https://github.com/example/flowx-nodes",
  "source_path": ""
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source_type | string | 是 | `git` 或 `folder` |
| source_url | string | git 时必填 | Git 仓库地址 |
| source_path | string | folder 时必填 | 本地文件夹路径 |
| overwrite | bool | 否 | 同名节点已存在时原地更新（保持节点 ID 不变），缺省 false 时同名冲突返回 409 |

**响应示例**：返回导入后的完整节点对象（结构同 4.3.3）。

### 4.3.7 Mock 测试节点

```http
POST /api/v1/nodes/:id/mock
```

**请求体**：
```json
{
  "parameters": {
    "url": "https://example.com/image.jpg"
  },
  "timeout": 30
}
```

**说明**：
- `parameters` 的值必须全部为字符串（`map[string]string`）。
- `timeout` 是顶层字段（单位：秒），不属于 `parameters`。

**响应示例**（`sandbox.Result` 结构）：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "status": "success",
    "duration_ms": 1250,
    "output": {
      "file_path": "/tmp/mock_image_123.jpg",
      "size_bytes": 2048,
      "format": "JPEG"
    },
    "stdout": "...",
    "logs": "Mock: 模拟下载图片成功\nMock: 文件大小 2048 bytes"
  }
}
```

## 4.4 工作流管理 API

### 4.4.1 获取工作流列表

```http
GET /api/v1/workflows
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | 状态过滤 |
| search | string | 否 | 关键词搜索 |
| page | integer | 否 | 页码 |
| page_size | integer | 否 | 每页数量 |

### 4.4.2 创建工作流

```http
POST /api/v1/workflows
```

**请求体**：绑定 `model.Workflow` 结构，`name` 与 `yamlConfig` 必填。

```json
{
  "name": "daily_image_workflow",
  "description": "每日风景图片下载和处理流水线",
  "intent": "每天自动从 Unsplash 下载一张风景图片，压缩到 800x600，然后上传到 S3",
  "yamlConfig": "name: daily_image_workflow\nversion: \"1.0\"\n...",
  "status": "draft"
}
```

**响应示例**：返回创建后的工作流对象（结构同 4.4.3）。

### 4.4.3 获取工作流详情

```http
GET /api/v1/workflows/:id
```

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 8,
    "name": "daily_image_workflow",
    "description": "每日风景图片下载和处理流水线",
    "intent": "每天自动从 Unsplash 下载一张风景图片，压缩到 800x600，然后上传到 S3",
    "yamlConfig": "name: daily_image_workflow\nversion: \"1.0\"\n...",
    "status": "active",
    "createdAt": "2025-01-20T08:00:00Z",
    "updatedAt": "2025-01-20T08:00:00Z"
  }
}
```

**说明**：该接口只返回工作流单行记录，不包含节点列表；节点编排信息在 `yamlConfig` 中。

### 4.4.4 执行工作流

```http
POST /api/v1/workflows/:id/run
```

**请求体**：无需请求体。服务端不读取请求体，`parameters`、`dry_run` 等参数均不支持。

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "executionId": 42,
    "status": "running",
    "streamUrl": "/api/v1/executions/42/stream"
  }
}
```

### 4.4.5 删除工作流

```http
DELETE /api/v1/workflows/:id
```

## 4.5 执行监控 API

### 4.5.1 获取执行历史

```http
GET /api/v1/executions
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workflow_id | integer | 否 | 按工作流过滤 |
| status | string | 否 | 按状态过滤 |
| page | integer | 否 | 页码 |
| page_size | integer | 否 | 每页数量 |

### 4.5.2 获取执行详情

```http
GET /api/v1/executions/:id
```

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 42,
    "workflowId": 8,
    "status": "success",
    "trigger": "manual",
    "startedAt": "2025-01-20T10:00:00Z",
    "completedAt": "2025-01-20T10:02:15Z",
    "durationMs": 135000,
    "result": "{\"summary\": \"所有节点执行成功\"}",
    "errorMessage": null,
    "errorNodeId": null,
    "metadata": "{\"trigger\": \"manual\"}",
    "createdAt": "2025-01-20T09:59:58Z"
  }
}
```

**说明**：
- `result` 与 `metadata` 均为 JSON 字符串（而非对象），`errorMessage`、`errorNodeId` 仅在失败时出现。
- 各节点的执行状态请查询 `GET /api/v1/executions/:id/nodes`。

### 4.5.3 获取执行节点状态

```http
GET /api/v1/executions/:id/nodes
```

**响应示例**：

```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "id": 1,
      "executionId": 42,
      "nodeId": "Build",
      "nodeName": "Build",
      "status": "success",
      "startedAt": "2025-01-20T10:00:00Z",
      "completedAt": "2025-01-20T10:00:30Z",
      "durationMs": 30000,
      "output": "...",
      "error": null
    }
  ]
}
```

### 4.5.4 实时日志流 (SSE)

```http
GET /api/v1/executions/:id/stream
```

**SSE 事件类型**：

服务端存在两套并存的事件命名风格（均可能出现在该流中）：

- 点分风格（执行服务自身发出）：`execution.started`、`execution.completed`、`execution.log`
- 下划线风格（由 FlowX 工作流事件桥接而来）：`execution_start`、`node_start`、`node_complete`、`execution_complete`
- 连接空闲时每 30 秒发送一次 `ping` 心跳；收到 `execution.completed` 后服务端主动关闭连接。

```
event: execution.started
data: {"execution_id": 42, "timestamp": "2025-01-20T10:00:00Z"}

event: execution.log
data: {"execution_id": 42, "node_id": "unsplash_downloader", "level": "info", "message": "开始下载图片...", "timestamp": "2025-01-20T10:00:01Z"}

event: execution.completed
data: {"execution_id": 42, "status": "success", "duration_ms": 135000, "timestamp": "2025-01-20T10:02:15Z"}
```

### 4.5.5 查询执行日志

```http
GET /api/v1/executions/:id/logs
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| node_id | string | 否 | 按节点过滤 |
| level | string | 否 | 按级别精确过滤（debug / info / warn / error / fatal） |
| limit | integer | 否 | 返回数量，默认 100 |
| offset | integer | 否 | 分页偏移 |

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "id": 1024,
        "executionId": 42,
        "nodeId": "unsplash_downloader",
        "nodeName": "下载图片",
        "stepName": "download_image",
        "level": "info",
        "message": "开始下载图片: https://unsplash.com/photo.jpg",
        "output": "HTTP/1.1 200 OK\nContent-Length: 2048...",
        "timestamp": "2025-01-20T10:00:01Z"
      },
      {
        "id": 1025,
        "executionId": 42,
        "nodeId": "unsplash_downloader",
        "nodeName": "下载图片",
        "level": "info",
        "message": "图片下载完成，大小: 2048 bytes",
        "timestamp": "2025-01-20T10:00:02Z"
      }
    ],
    "total": 156,
    "limit": 100,
    "offset": 0
  }
}
```

### 4.5.6 暂停 / 恢复运行中的执行实例

```http
POST /api/v1/executions/:id/pause
POST /api/v1/executions/:id/resume
```

- `pause`：仅 `running` 状态可暂停。层边界暂停——状态立即置为 `paused`（立即落库并广播
  `execution_paused` SSE 事件），当前并发层的节点执行完后在层边界挂起，**不中断运行中的节点**
- `resume`：仅 `paused` 状态可恢复，恢复后状态回到 `running`（广播 `execution_resumed`）。
  实例在内存时直接 Resume；**server 重启后也可恢复**：暂停时会导出运行时快照
  （调用 pause 时立即导出一次 + 层边界生效时 `WorkflowPaused` 事件再导出一次干净状态），
  resume 发现实例不在内存时自动从快照重建并增量续跑（已终结节点跳过；若崩溃发生在
  层边界之前，当时 RUNNING 的节点会重跑，at-least-once 语义）
- `paused` 状态的执行不可续跑（`continue` 会拒绝），也不计入已结束状态

### 4.5.7 续跑已结束的执行实例

```http
POST /api/v1/executions/:id/continue
Content-Type: application/json

{
  "yaml": "Name: my-workflow\n...",  // 可选：新的 FlowX YAML
  "run": true                         // 可选：false 时仅更新快照不执行（必须同时提供 yaml）
}
```

对已结束（success/failed/cancelled）的执行实例增量续跑：

- 不提供 `yaml`：直接重新运行，已终结状态（SUCCESS/FAILED/CANCELLED）的节点自动跳过
- 提供 `yaml`：先由 FlowX `UpdateConfig` 比对差异更新执行实例的图（可追加节点、修改未运行节点；`Version`/`Name` 等不可变字段必须与原配置一致，已执行节点不可删除/替换），再继续运行
- `run: false`：仅更新快照（追加/修改未运行节点）并持久化，不触发执行；广播 `execution.updated` 事件（前端回放态画布增量刷新，新增节点以 idle 入场）。之后可再调本接口（不带 `yaml`）按需续跑
- 续跑沿用同一执行 ID：状态回到 running，节点记录与日志追加到原实例
- 仅影响该执行实例，不修改流水线定义（需要时用 `PUT /workflows/:id`）

**无状态恢复**：执行结束时服务端会同步导出运行时快照（`flowx ExportConfig`，含各节点/步骤状态，
不含大体积 metadata）存入 `executions.runtime_yaml`；续跑时经 `LoadWorkflow` 从快照重建实例，
并从 `metadata_json` 恢复节点输出数据（下游 `{{ NodeId.key }}` 引用不受影响）。
**server 重启后仍可续跑**；仅快照功能上线前创建的旧执行（runtime_yaml 为空）无法续跑。

**响应示例**：

```json
{
  "code": 200,
  "message": "success",
  "data": { "executionId": 42, "status": "running" }
}
```

### 4.5.8 节点实时预览帧（中转拉取）

```http
GET /api/v1/executions/:id/nodes/:nodeId/preview-frame
```

返回该节点当前最新预览帧的 HTTP 二进制（Content-Type 由上游决定，通常为
image/jpeg），`Cache-Control: no-cache`；无预览来源时 404。

**机制**：运行中的节点脚本轮询推理服务任务时，把帧地址经 stdout 标记行
`FLOWX_PREVIEW {"url": "...", "progress": 0.4, "token": "..."}` 上报；Studio 从日志
管道拦截标记（**不落日志库**），在内存中记录 `(execution, node) → 帧地址` 映射，
并以 `node_preview` 事件向全局 SSE 广播轻量进度（不含媒体）。前端收到事件后用
`<img src>` 直读本接口（同源 `flowx_token` cookie 认证），Studio 按映射向推理服务
中转拉帧（1s 短缓存，单帧上限 16MB）。媒体全程 HTTP 二进制，不经 base64；
Studio 无需对节点/推理服务开放任何入站回调接口。

### 4.5.9 终止运行中的执行实例

```http
POST /api/v1/executions/:id/cancel
```

**说明**：终止运行中/暂停的执行（`running` / `paused`）。与「暂停」不同，这是**真终止**：
引擎侧取消上下文，运行中的节点进程被终止，执行与仍处于 `running` 的节点均置为
`cancelled`（之后可用 4.5.7 续跑未完成节点）。

两段式终止（保证第三方服务上的后台任务不残留）：

1. **节点侧优雅退出**：flowx 本地执行器先向节点进程发 `SIGTERM`，宽限期
   `interruptGrace`（执行器 config，默认 10s）内未退出才 `SIGKILL`；节点应在收到信号时
   取消自己提交的后台任务（`flowx_client` 内置：`submit_job` 登记 + 信号处理器
   `POST /interrupt`，随后以 128+signal 退出）
2. **Studio 侧兜底转发**：`CancelExecution` 对该执行**所有运行中、且建立过第三方服务
   连接的节点**统一转发 `POST {base}/interrupt`（`{"job_id": "..."}`，Bearer 用该节点
   执行时的 token），覆盖进程被强杀/信号丢失/节点未实现自清的情况。服务基地址与
   job id 取自节点上报的预览标记（`FLOWX_PREVIEW` 的 `base`/`job_id` 字段），缺失时
   回退到执行 metadata 的 `params.service_url`。**未上报 job_id 的节点不转发**——
   第三方服务的空载荷语义是「取消该服务上全部任务」，会误伤同服务上其他执行的任务。

转发失败不影响取消本身（仅记日志与审计：`cancel_remote_job` / `cancel_remote_job_failed`）。

## 4.6 全局事件流 API

### 4.6.1 订阅全局事件

```http
GET /api/v1/events
```

**说明**：全局 SSE 事件流，推送事件总线上的所有事件（事件名为 `evt.Type`，数据为完整事件对象），客户端断开连接时自动取消订阅。节点实时预览进度以 `node_preview` 事件出现在该流中：`{"execution_id": 42, "node_id": "Sampler", "progress": 0.4, "timestamp": ...}`（不含媒体；帧经 4.5.8 的 preview-frame 接口拉取）。

> **该流是全局的、不按流水线过滤**：所有流水线的执行事件都会推送过来。字段可用性分两类：`execution.started` / `execution.completed`（执行服务直接发出）的 `data` **带** `workflow_id`（流水线列表页据此更新卡片状态）；由 FlowX 桥接的 `node_start` / `node_complete` / `node_preview` / `execution.log` / `execution_start` / `execution_complete` / `execution_paused` / `execution_resumed` **只有** `execution_id`（要按流水线判断得先反查 `GET /executions/:id`）。消费方必须自己圈定「我关心的执行」，否则别的流水线运行会改写本视图——画布侧事故：选中运行中的执行 607 看回放，另一条流水线开始运行 → `execution.started` 被无差别处理 → `selectExecution(别人的 id)` → 「选中执行不属于本流水线 ⇒ 退出回放态」立即生效，表现为「选中过一会自己取消了」；同理别人的 `execution.completed`/`execution_complete` 会把本端运行态 `stopExecution()` 一起清掉，别人的 `node_start`/`node_complete` 还会因节点 id 跨流水线重名（`Save`/`MaskPaint`…）点亮本画布的节点。
>
> 画布侧现行规则（`workflow-canvas/WorkflowCanvas.tsx` 的 `eventAppliesToCanvas`）：**只有回放态选中的、或本页点运行发起的那个执行**的事件生效；**编辑态（未选中任何执行）保持完全干净**——他端（CLI/另一台设备）发起的运行不在画布上留任何运行特效（想看就在执行历史里选中它进回放态）。本页点运行后的「自动进入新执行回放态」由页面依 `POST /workflows/:id/run` 返回的 `executionId` 本地完成，不依赖 SSE：事件是全局流，分不出「我点的运行」和「他端起的运行」。回归测试：`web/src/features/workflow-canvas/WorkflowCanvas.sse-scope.test.tsx`、`web/src/pages/WorkflowCanvasPage.run-button.test.tsx`。

## 4.7 配置管理 API

### 4.7.1 获取系统配置

```http
GET /api/v1/config/system
```

**响应示例**：以键值对形式返回全部系统配置。

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "some_key": "some_value"
  }
}
```

### 4.7.2 更新系统配置

```http
PUT /api/v1/config/system
```

**请求体**：键值对对象，逐个 upsert。

```json
{
  "some_key": "some_value"
}
```

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "message": "system config updated"
  }
}
```

## 4.8 本地媒体文件 API

画布 widget 直接读写 FlowX（Studio 所在机器）的本地媒体文件，媒体本体一律经 HTTP
二进制传输、不走 base64。主要用于「加载类节点」（`load-image` / `mask-paint` /
`load-video` 等 **local-only** 节点）的源文件预览与上传——远程 docker 执行器写出的
文件不在本机，这三个端点覆盖不到。

可访问目录由 `media.roots` 白名单限定（默认 `[~/flowx-output, ~/flowx-input]`，可用
`FLOWX_STUDIO_MEDIA_ROOTS` 覆盖），白名单外的路径一律 403（含软链逃逸）。
上传落点由 `media.upload_dir` 决定（默认 `~/flowx-input/uploads/`，见 4.8.4），
上传**不限扩展名与大小**。

### 4.8.1 读取本地媒体文件

```http
GET /api/v1/media/file?path=<绝对路径 | ~/...>
```

返回文件内容（`http.ServeContent`，自带 Range 支持——视频可拖动进度条；
`Cache-Control: private, max-age=60`）。参数缺失 400、文件不存在 404、白名单外 403。

### 4.8.2 查询白名单目录

```http
GET /api/v1/media/roots
```

返回当前生效的白名单根目录（已展开 `~` 并解析软链），供 widget 提示可上传/可预览的位置。

### 4.8.3 上传文件

```http
POST /api/v1/media/upload?subdir=<可选子目录>
Content-Type: multipart/form-data
字段：file（一次一个文件）
```

**用途**：节点 widget 把浏览器侧文件送到 FlowX 机器上（加载类节点的「📁 选择文件 / 拖入」，
`mask-paint` 保存手绘笔画 JSON 等），返回值直接写进节点的 `*_path` 参数
（免手工拷贝 + 免手打路径）。

- **放行范围**：**不限扩展名、不限大小**（原图片/视频白名单 + 32/512MB 上限已去掉）。
  仍保留两条安全措施：`subdir` 不得越出上传根目录（禁止 `..`/路径分隔符）、
  文件名一律消毒（去目录成分、非法字符转 `_`）
- **落点**：见 4.8.4（默认 `~/flowx-input/uploads/`，`subdir` 在其下追加一层）
- **命名**：`<UTC时间戳>_<消毒后原名>`（同名加 `-1`/`-2`，不覆盖已有文件）
- **实现**：`MultipartReader` 单遍流式落盘（不落临时文件、大文件不占内存）
- ⚠️ 无大小上限意味着磁盘写满前的写入都会成功；需要限额请在网关/反向代理层限制

响应：

```json
{
  "code": 200,
  "data": {
    "path": "~/flowx-input/uploads/20261011T083012Z_pink_dress.png",
    "abs_path": "/home/u/flowx-input/uploads/20261011T083012Z_pink_dress.png",
    "name": "20261011T083012Z_pink_dress.png",
    "size": 1357498,
    "mime": "image/png",
    "kind": "image",
    "url": "/api/v1/media/file?path=~%2Fflowx-input%2Fuploads%2F..."
  },
  "message": "success"
}
```

`kind` 由 MIME 推导（`image` / `video` / `audio` / 其他 `file`），纯提示、不参与放行判定。

错误码：400（缺 `file` 字段 / 非 multipart / `subdir` 非法）、500（无法创建落点目录，
如未配置 `media.roots` 且未配 `media.upload_dir`）。

### 4.8.4 上传落点配置（`media.upload_dir`）

上传目录**不写死在代码里**，由 `~/.flowx-studio/config.yaml` 决定：

```yaml
media:
  roots:
    - ~/flowx-input
    - ~/flowx-output
  upload_dir: ~/flowx-input/uploads      # 留空 = 自动（值同此行，见下）
```

- **默认（未配置）**：白名单里名为 `flowx-input` 的根（默认 `~/flowx-input`，语义上是
  「素材进」）下的 `uploads/`；没有 `flowx-input` 时退到第一个可写的白名单根
- `subdir` 追加在 `upload_dir` 之下（如 `?subdir=strokes` → `~/flowx-input/uploads/strokes/`）
- 显式配置的 `upload_dir` **会自动纳入可读白名单**（否则刚上传的文件自己都预览不了，
  `GET /media/file` 会 403）；`GET /media/roots` 返回的是生效后的完整列表
- 支持 `~` 展开；环境变量覆盖：`FLOWX_STUDIO_MEDIA_UPLOAD_DIR`
  （**空白值视为未配置**，回退配置文件里的值；这是刻意的——systemd/docker-compose
  常注入 `<VAR>=` 形式的空值）

## 4.9 CLI 命令

除 HTTP API 外，`flowx-studio` 二进制还提供一组 CLI 客户端子命令，作为上述 REST API 的 HTTP 客户端（默认连接 `http://127.0.0.1:8080`，可用 `--server` flag 或 `FLOWX_STUDIO_SERVER_URL` 覆盖）。它们主要供 AI Agent（经 SKILL 文件指引）与终端用户使用：

| 命令 | 说明 | 底层 API |
|------|------|----------|
| `server status` / `server start` / `server stop` | server 生命周期管理（探测/后台启动/优雅停止），供 Agent 在调用其他命令前自动拉起 server | `GET /config/system`（就绪探测） |
| `workflow list` | 列出流水线/工作流 | `GET /workflows` |
| `workflow create --file wf.yaml` | 创建流水线/工作流（YAML 非法时退出码 1，stderr 含校验错误） | `POST /workflows` |
| `workflow update --id N --file wf.yaml` | 更新流水线/工作流 | `PUT /workflows/:id` |
| `workflow delete --id N` | 删除流水线/工作流 | `DELETE /workflows/:id` |
| `workflow run --id N [--follow]` | 运行流水线/工作流；`--follow` 跟随 SSE 日志 | `POST /workflows/:id/run`、`GET /executions/:id/stream` |
| `execution list [--workflow N] [--status S]` | 列出执行实例 | `GET /executions` |
| `execution get --id E` | 执行详情（含 metadata/参数） | `GET /executions/:id` |
| `execution nodes --id E` | 节点状态与返回数据 | `GET /executions/:id/nodes` |
| `execution logs --id E [--node X] [--level L]` | 查询执行日志 | `GET /executions/:id/logs` |
| `execution continue --id E [--file wf.yaml] [--follow] [--no-run]` | 续跑已结束的执行，可追加节点；`--no-run` 仅更新快照不执行 | `POST /executions/:id/continue` |
| `execution pause --id E` | 暂停运行中的执行（层边界生效） | `POST /executions/:id/pause` |
| `execution resume --id E [--follow]` | 恢复已暂停的执行 | `POST /executions/:id/resume` |
| `node list` | 列出节点 | `GET /nodes` |
| `node create --file node.yaml` | 创建节点（承接原 FAP `create_node` 动作） | `POST /nodes` |
| `node update --id N --file node.yaml` | 原地更新节点定义（保持节点 ID；全量替换） | `PUT /nodes/:id` |
| `node import --type git\|folder ... [--overwrite]` | 从 Git 仓库或本地文件夹导入节点（读取 flowx.json）；`--overwrite` 同名时原地更新保持 ID | `POST /nodes/import` |
| `node delete --id N` | 删除节点 | `DELETE /nodes/:id` |
| `node mock --id N` | Mock 测试节点 | `POST /nodes/:id/mock` |
| `audit list` | 查询审计日志（`--action`/`--resource-type` 过滤） | `GET /audit-logs` |
| `executor list` | 列出执行器实例（local 单例 + docker 多实例，`(default)` 标记默认） | `GET /executors` |
| `executor create --file exec.yaml` | 创建执行器实例（字段：name/type/description/config；docker config 支持 `host` 远程 daemon 地址） | `POST /executors` |
| `executor update --id N --file exec.yaml` | 更新执行器 description/config（name/type 不可变更） | `PUT /executors/:id` |
| `executor delete --id N` | 删除执行器（默认执行器需先 set-default 切换） | `DELETE /executors/:id` |
| `executor set-default --id N` | 设为全局默认执行器（未声明 executor 的 nodeRef 节点将使用它） | `PUT /executors/:id/default` |
| `executor test --id N` | 测试 docker 执行器与 daemon 的连接状态（Ping + 版本信息，不创建容器；仅 docker 实例支持；连接失败退出码 1） | `POST /executors/:id/test` |
| `backup create` / `backup list` / `backup download` | 备份创建/列表/下载（`.db` + 配套 `.assets.tar.gz` 节点资产包） | `POST /backups`、`GET /backups`、`GET /backups/:name/download` |
| `backup restore --file f` | 恢复备份（要求 server 已停止；`f` 旁存在 `.assets.tar.gz` 时自动恢复资产，自动保留 `.pre-restore` 回滚副本） | 无（直接操作数据库文件） |

全局约定：所有查询类子命令支持 `--json` 输出结构化结果；数据写入类子命令支持 `--schema` 输出参数 JSON Schema；校验失败以非零退出码退出并在 stderr 给出重试指引。详见 [06-ai-service.md](./06-ai-service.md)。

## 4.10 API 路由汇总

```
/api/v1
├── /nodes
│   ├── GET    /          获取节点列表
│   ├── POST   /          创建节点
│   ├── POST   /import    导入节点（git / folder）
│   ├── GET    /:id       获取节点详情
│   ├── PUT    /:id       更新节点
│   ├── DELETE /:id       删除节点
│   └── POST   /:id/mock  Mock 测试节点
│
├── /workflows
│   ├── GET    /          获取工作流列表
│   ├── POST   /          创建工作流
│   ├── GET    /:id       获取工作流详情
│   ├── PUT    /:id       更新工作流
│   ├── DELETE /:id       删除工作流
│   ├── POST   /:id/run   执行工作流
│   └── POST   /:id/mock  Mock 执行（校验 + nodeRef 展开，不真实运行）
│
├── /executions
│   ├── GET    /          获取执行历史
│   ├── GET    /:id       获取执行详情
│   ├── GET    /:id/nodes 获取执行节点状态
│   ├── GET    /:id/stream 实时日志流 (SSE)
│   ├── GET    /:id/logs  查询执行日志
│   ├── GET    /:id/logs/export?format=json|txt|markdown  导出执行日志
│   ├── POST   /:id/continue  续跑已结束的执行（可选携带新 YAML 追加节点）
│   ├── POST   /:id/pause     暂停运行中的执行（层边界暂停，不中断运行中节点）
│   └── POST   /:id/resume    恢复已暂停的执行（仅内存中存活的实例）
│
├── /events
│   └── GET    /          全局事件流 (SSE)
│
├── /audit-logs
│   └── GET    /          审计日志查询（action/resource_type 过滤 + 分页）
│
├── /backups
│   ├── GET    /          备份列表
│   ├── POST   /          创建备份（VACUUM INTO + 资产 tar.gz）
│   └── GET    /:name/download  下载备份文件（.db 或 .assets.tar.gz）
│
├── /executors
│   ├── GET    /          执行器实例列表（local 单例 + N 个 docker）
│   ├── POST   /          创建执行器（type=local 已存在 → 409；type=k8s → 400）
│   ├── GET    /:id       执行器详情
│   ├── PUT    /:id       更新（name/type 不可变更，仅 description/config）
│   ├── DELETE /:id       删除（默认执行器禁止删除 → 409）
│   ├── PUT    /:id/default  设为全局默认执行器
│   └── POST   /:id/test     测试 docker daemon 连接（返回 ok/serverVersion/apiVersion/os/arch/latencyMs，失败 ok=false+message）
│
└── /config
    ├── GET    /system    获取系统配置
    └── PUT    /system    更新系统配置

/media（本地媒体文件，白名单目录）
├── GET    /file?path=    读取本地媒体文件（图片/视频，支持 Range）
├── GET    /roots         查询白名单根目录
└── POST   /upload        上传媒体文件（加载类节点的「选/拖文件」，落 ~/flowx-input/uploads/）
```

## 4.11 错误码定义

| HTTP 状态码 | 错误类型 | 说明 |
|------------|---------|------|
| 200 | success | 请求成功 |
| 400 | bad_request | 请求参数错误 |
| 401 | unauthorized | 认证失败（token 缺失或错误） |
| 404 | not_found | 资源不存在 |
| 409 | conflict | 资源冲突（如名称已存在） |
| 429 | rate_limit | 触发限流（每 IP 100 请求/分钟） |
| 500 | internal_error | 服务器内部错误 |
