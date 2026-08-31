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
  "name": "daily_image_pipeline",
  "description": "每日风景图片下载和处理流水线",
  "intent": "每天自动从 Unsplash 下载一张风景图片，压缩到 800x600，然后上传到 S3",
  "yamlConfig": "name: daily_image_pipeline\nversion: \"1.0\"\n...",
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
    "name": "daily_image_pipeline",
    "description": "每日风景图片下载和处理流水线",
    "intent": "每天自动从 Unsplash 下载一张风景图片，压缩到 800x600，然后上传到 S3",
    "yamlConfig": "name: daily_image_pipeline\nversion: \"1.0\"\n...",
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

### 4.5.6 续跑已结束的执行实例

```http
POST /api/v1/executions/:id/continue
Content-Type: application/json

{
  "yaml": "Name: my-workflow\n..."  // 可选：新的 FlowX YAML
}
```

对已结束（success/failed/cancelled）的执行实例增量续跑：

- 不提供 `yaml`：直接重新运行，已终结状态（SUCCESS/FAILED/CANCELLED）的节点自动跳过
- 提供 `yaml`：先由 FlowX `UpdateConfig` 比对差异更新执行实例的图（可追加节点、修改未运行节点；`Version`/`Name` 等不可变字段必须与原配置一致，已执行节点不可删除/替换），再继续运行
- 续跑沿用同一执行 ID：状态回到 running，节点记录与日志追加到原实例
- 仅影响该执行实例，不修改流水线定义（需要时用 `PUT /workflows/:id`）

**注意**：执行实例的运行时状态保留在 server 进程内存中，server 重启后无法续跑（报 `pipeline with id exec-N not found`）。

**响应示例**：

```json
{
  "code": 200,
  "message": "success",
  "data": { "executionId": 42, "status": "running" }
}
```

## 4.6 全局事件流 API

### 4.6.1 订阅全局事件

```http
GET /api/v1/events
```

**说明**：全局 SSE 事件流，推送事件总线上的所有事件（事件名为 `evt.Type`，数据为完整事件对象），客户端断开连接时自动取消订阅。

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

## 4.8 CLI 命令

除 HTTP API 外，`flowx-studio` 二进制还提供一组 CLI 客户端子命令，作为上述 REST API 的 HTTP 客户端（默认连接 `http://127.0.0.1:8080`，可用 `--server` flag 或 `FLOWX_STUDIO_SERVER_URL` 覆盖）。它们主要供 AI Agent（经 SKILL 文件指引）与终端用户使用：

| 命令 | 说明 | 底层 API |
|------|------|----------|
| `server status` / `server start` / `server stop` | server 生命周期管理（探测/后台启动/优雅停止），供 Agent 在调用其他命令前自动拉起 server | `GET /config/system`（就绪探测） |
| `pipeline list` | 列出流水线/工作流 | `GET /workflows` |
| `pipeline create --file wf.yaml` | 创建流水线/工作流（YAML 非法时退出码 1，stderr 含校验错误） | `POST /workflows` |
| `pipeline update --id N --file wf.yaml` | 更新流水线/工作流 | `PUT /workflows/:id` |
| `pipeline delete --id N` | 删除流水线/工作流 | `DELETE /workflows/:id` |
| `pipeline run --id N [--follow]` | 运行流水线/工作流；`--follow` 跟随 SSE 日志 | `POST /workflows/:id/run`、`GET /executions/:id/stream` |
| `execution list [--pipeline N] [--status S]` | 列出执行实例 | `GET /executions` |
| `execution get --id E` | 执行详情（含 metadata/参数） | `GET /executions/:id` |
| `execution nodes --id E` | 节点状态与返回数据 | `GET /executions/:id/nodes` |
| `execution logs --id E [--node X] [--level L]` | 查询执行日志 | `GET /executions/:id/logs` |
| `execution continue --id E [--file wf.yaml] [--follow]` | 续跑已结束的执行，可追加节点 | `POST /executions/:id/continue` |
| `node list` | 列出节点 | `GET /nodes` |
| `node create --file node.yaml` | 创建节点（承接原 FAP `create_node` 动作） | `POST /nodes` |
| `node update --id N --file node.yaml` | 原地更新节点定义（保持节点 ID；全量替换） | `PUT /nodes/:id` |
| `node import --type git\|folder ... [--overwrite]` | 从 Git 仓库或本地文件夹导入节点（读取 flowx.json）；`--overwrite` 同名时原地更新保持 ID | `POST /nodes/import` |
| `node delete --id N` | 删除节点 | `DELETE /nodes/:id` |
| `node mock --id N` | Mock 测试节点 | `POST /nodes/:id/mock` |
| `ask --key k --prompt ...` | 终端交互式提问（承接原 FAP `ask_input`，纯终端，不访问 server） | 无 |
| `info --title t --message m` | 终端信息卡片（承接原 FAP `show_info`，纯终端，不访问 server） | 无 |
| `audit list` | 查询审计日志（`--action`/`--resource-type` 过滤） | `GET /audit-logs` |
| `executor list` | 列出执行器实例（local 单例 + docker 多实例，`(default)` 标记默认） | `GET /executors` |
| `executor create --file exec.yaml` | 创建执行器实例（字段：name/type/description/config；docker config 支持 `host` 远程 daemon 地址） | `POST /executors` |
| `executor update --id N --file exec.yaml` | 更新执行器 description/config（name/type 不可变更） | `PUT /executors/:id` |
| `executor delete --id N` | 删除执行器（默认执行器需先 set-default 切换） | `DELETE /executors/:id` |
| `executor set-default --id N` | 设为全局默认执行器（未声明 executor 的 nodeRef 节点将使用它） | `PUT /executors/:id/default` |
| `backup create` / `backup list` / `backup download` | 备份创建/列表/下载（`.db` + 配套 `.assets.tar.gz` 节点资产包） | `POST /backups`、`GET /backups`、`GET /backups/:name/download` |
| `backup restore --file f` | 恢复备份（要求 server 已停止；`f` 旁存在 `.assets.tar.gz` 时自动恢复资产，自动保留 `.pre-restore` 回滚副本） | 无（直接操作数据库文件） |

全局约定：所有查询类子命令支持 `--json` 输出结构化结果；数据写入类子命令支持 `--schema` 输出参数 JSON Schema；校验失败以非零退出码退出并在 stderr 给出重试指引。详见 [06-ai-service.md](./06-ai-service.md)。

## 4.9 API 路由汇总

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
│   └── POST   /:id/continue  续跑已结束的执行（可选携带新 YAML 追加节点）
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
│   └── PUT    /:id/default  设为全局默认执行器
│
├── /assets                    ※ 免认证（签名 URL 自校验，供 docker/k8s 执行器拉取节点资产）
│   └── GET    /nodes/:nodeRef/*filepath?expires&sig  签名 URL 拉取节点文件（HMAC-SHA256 + 时效）
│
└── /config
    ├── GET    /system    获取系统配置
    └── PUT    /system    更新系统配置
```

## 4.10 错误码定义

| HTTP 状态码 | 错误类型 | 说明 |
|------------|---------|------|
| 200 | success | 请求成功 |
| 400 | bad_request | 请求参数错误 |
| 401 | unauthorized | 认证失败（token 缺失或错误） |
| 404 | not_found | 资源不存在 |
| 409 | conflict | 资源冲突（如名称已存在） |
| 429 | rate_limit | 触发限流（每 IP 100 请求/分钟） |
| 500 | internal_error | 服务器内部错误 |
