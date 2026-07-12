# 4. API 设计

## 4.1 设计原则

- **RESTful 风格**：使用标准 HTTP 方法和状态码
- **JSON 格式**：请求和响应统一使用 JSON
- **资源命名**：使用名词复数形式，如 `/api/nodes`、`/api/workflows`
- **版本控制**：URL 中包含版本号 `/api/v1/...`
- **错误统一**：遵循 RFC 7807 Problem Details 规范

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
  "message": "Invalid request parameters",
  "error": {
    "type": "validation_error",
    "detail": "Field 'name' is required",
    "field": "name"
  }
}
```

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
        "description": "从指定 URL 下载图片",
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
        "created_at": "2025-01-15T10:30:00Z"
      }
    ],
    "total": 15,
    "page": 1,
    "page_size": 20
  }
}
```

### 4.3.2 AI 生成节点

```http
POST /api/v1/ai/generate-node
```

**请求体**：
```json
{
  "description": "我需要一个节点，可以从 URL 下载图片并保存到本地",
  "language": "python",
  "preferred_name": "image_downloader",
  "context": {
    "existing_nodes": ["url_validator"],
    "workflow_intent": "图片处理流水线"
  }
}
```

**响应示例**（流式 SSE）：
```
event: generating
data: {"stage": "analyzing", "message": "正在分析需求..."}

event: generating
data: {"stage": "coding", "message": "正在生成节点代码..."}

event: complete
data: {"node_id": 16, "name": "image_downloader", "status": "created"}
```

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
    "description": "从指定 URL 下载图片",
    "language": "python",
    "code": "import requests...",
    "mock_code": "# 返回模拟图片数据...",
    "parameters": [
      {
        "name": "url",
        "type": "string",
        "description": "图片下载地址",
        "required": true,
        "default": null
      },
      {
        "name": "timeout",
        "type": "integer",
        "description": "超时时间（秒）",
        "required": false,
        "default": 30
      }
    ],
    "dockerfile": null,
    "requirements": "requests\npillow",
    "tags": ["image", "download"],
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z"
  }
}
```

### 4.3.4 删除节点

```http
DELETE /api/v1/nodes/:id
```

**响应**：
```json
{
  "code": 200,
  "message": "Node deleted successfully"
}
```

### 4.3.5 Mock 测试节点

```http
POST /api/v1/nodes/:id/mock
```

**请求体**：
```json
{
  "parameters": {
    "url": "https://example.com/image.jpg",
    "timeout": 30
  }
}
```

**响应示例**：
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

### 4.4.2 AI 生成工作流

```http
POST /api/v1/ai/generate-workflow
```

**请求体**：
```json
{
  "description": "帮我做一个工作流：每天自动从 Unsplash 下载一张风景图片，压缩到 800x600，然后上传到 S3",
  "context": {
    "preferred_nodes": ["image_downloader"],
    "executor_preference": "docker"
  }
}
```

**响应**（流式 SSE）：
```
event: analyzing
data: {"message": "正在分析需求，识别需要 4 个节点..."}

event: generating_nodes
data: {"message": "正在生成新节点：unsplash_downloader..."}

event: generating_workflow
data: {"message": "正在编排工作流..."}

event: complete
data: {"workflow_id": 8, "name": "daily_image_pipeline", "node_count": 4}
```

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
    "status": "active",
    "yaml_config": "name: daily_image_pipeline\nversion: \"1.0\"\n...",
    "nodes": [
      {
        "id": 1,
        "name": "unsplash_downloader",
        "description": "从 Unsplash API 下载图片"
      },
      {
        "id": 5,
        "name": "image_compressor",
        "description": "压缩图片到指定尺寸"
      }
    ],
    "created_at": "2025-01-20T08:00:00Z",
    "updated_at": "2025-01-20T08:00:00Z"
  }
}
```

### 4.4.4 执行工作流

```http
POST /api/v1/workflows/:id/run
```

**请求体**：
```json
{
  "parameters": {
    "category": "nature",
    "target_size": "800x600"
  },
  "dry_run": false
}
```

**响应示例**：
```json
{
  "code": 200,
  "message": "Workflow execution started",
  "data": {
    "execution_id": 42,
    "status": "running",
    "stream_url": "/api/v1/executions/42/stream"
  }
}
```

### 4.4.5 Mock 执行工作流

```http
POST /api/v1/workflows/:id/mock
```

**说明**：使用各节点的 Mock 代码执行工作流，不触发真实副作用。

### 4.4.6 删除工作流

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
    "workflow_id": 8,
    "workflow_name": "daily_image_pipeline",
    "status": "success",
    "trigger": "manual",
    "started_at": "2025-01-20T10:00:00Z",
    "completed_at": "2025-01-20T10:02:15Z",
    "duration_ms": 135000,
    "nodes": [
      {
        "node_id": "unsplash_downloader",
        "status": "success",
        "started_at": "2025-01-20T10:00:00Z",
        "completed_at": "2025-01-20T10:00:30Z",
        "duration_ms": 30000
      },
      {
        "node_id": "image_compressor",
        "status": "success",
        "started_at": "2025-01-20T10:00:30Z",
        "completed_at": "2025-01-20T10:01:00Z",
        "duration_ms": 30000
      }
    ],
    "result": {
      "summary": "所有节点执行成功",
      "s3_url": "https://bucket.s3.amazonaws.com/nature_20250120.jpg"
    },
    "metadata": {
      "status": "success",
      "trigger": "manual",
      "params": {
        "env": "production",
        "appName": "myapp"
      },
      "metadata": {
        "Build.output": "build done",
        "Test.output": "all tests passed"
      }
    }
  }
}
```

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
      "execution_id": 42,
      "node_id": "Build",
      "node_name": "Build",
      "status": "success",
      "started_at": "2025-01-20T10:00:00Z",
      "completed_at": "2025-01-20T10:00:30Z",
      "duration_ms": 30000
    }
  ]
}
```

### 4.5.4 实时日志流 (SSE)

```http
GET /api/v1/executions/:id/stream
```

**SSE 事件类型**：

```
event: execution_start
data: {"execution_id": 42, "timestamp": "2025-01-20T10:00:00Z"}

event: node_start
data: {"node_id": "unsplash_downloader", "node_name": "下载图片", "timestamp": "2025-01-20T10:00:00Z"}

event: node_log
data: {"node_id": "unsplash_downloader", "level": "info", "message": "开始下载图片...", "timestamp": "2025-01-20T10:00:01Z"}

event: node_complete
data: {"node_id": "unsplash_downloader", "status": "success", "duration_ms": 30000, "timestamp": "2025-01-20T10:00:30Z"}

event: execution_complete
data: {"execution_id": 42, "status": "success", "duration_ms": 135000, "timestamp": "2025-01-20T10:02:15Z"}
```

### 4.5.4 查询执行日志

```http
GET /api/v1/executions/:id/logs
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| node_id | string | 否 | 按节点过滤 |
| level | string | 否 | 日志级别过滤（支持多级别：info,error） |
| search | string | 否 | 关键词搜索（message 字段） |
| limit | integer | 否 | 返回数量，默认 100，最大 1000 |
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
        "execution_id": 42,
        "node_id": "unsplash_downloader",
        "node_name": "下载图片",
        "step_name": "download_image",
        "level": "info",
        "message": "开始下载图片: https://unsplash.com/photo.jpg",
        "output": "HTTP/1.1 200 OK\nContent-Length: 2048...",
        "timestamp": "2025-01-20T10:00:01Z"
      },
      {
        "id": 1025,
        "execution_id": 42,
        "node_id": "unsplash_downloader",
        "node_name": "下载图片",
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

### 4.5.5 导出执行日志

```http
POST /api/v1/executions/:id/logs/export
```

**请求体**：
```json
{
  "format": "json",       // json | txt | markdown
  "node_ids": ["download", "compress"],  // 可选：指定节点
  "level": "info"         // 可选：最低日志级别
}
```

**响应**：
- Content-Type: `application/json` 或 `text/plain`
- 返回日志文件下载

## 4.6 AI 对话 API

### 4.6.1 通用 AI 对话

```http
POST /api/v1/ai/chat
```

**请求体**：
```json
{
  "session_id": "sess_123456",
  "message": "我想做一个自动备份数据库的工作流",
  "context": {
    "current_page": "workflow_builder",
    "selected_workflow_id": null
  }
}
```

**响应**（流式 SSE）：
```
event: message
data: {"role": "assistant", "content": "好的，我来帮你创建一个数据库备份工作流。"}

event: message
data: {"role": "assistant", "content": "首先，我需要了解几个信息："}

event: message
data: {"role": "assistant", "content": "1. 你使用什么数据库？（MySQL/PostgreSQL/MongoDB 等）"}

event: action
data: {"type": "ask_parameter", "parameters": ["db_type", "backup_frequency"]}
```

### 4.6.2 获取对话历史

```http
GET /api/v1/ai/chat/:session_id/history
```

## 4.7 配置管理 API

### 4.7.1 获取 AI 配置列表

```http
GET /api/v1/config/ai
```

### 4.7.2 添加 AI 配置

```http
POST /api/v1/config/ai
```

**请求体**：
```json
{
  "provider": "openai",
  "name": "OpenAI GPT-4",
  "model": "gpt-4",
  "api_key": "sk-xxxxxxxx",
  "base_url": null,
  "temperature": 0.7,
  "max_tokens": 4096,
  "is_active": true
}
```

### 4.7.3 测试 AI 配置

```http
POST /api/v1/config/ai/:id/test
```

**响应示例**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "success": true,
    "latency_ms": 850,
    "model": "gpt-4",
    "response": "Hello! I'm working properly."
  }
}
```

### 4.7.4 获取系统配置

```http
GET /api/v1/config/system
```

### 4.7.5 更新系统配置

```http
PUT /api/v1/config/system
```

## 4.8 API 路由汇总

```
/api/v1
├── /nodes
│   ├── GET    /          获取节点列表
│   ├── POST   /          AI 生成节点（流式）
│   ├── GET    /:id       获取节点详情
│   ├── DELETE /:id       删除节点
│   └── POST   /:id/mock  Mock 测试节点
│
├── /workflows
│   ├── GET    /          获取工作流列表
│   ├── POST   /          AI 生成工作流（流式）
│   ├── GET    /:id       获取工作流详情
│   ├── PUT    /:id       更新工作流
│   ├── DELETE /:id       删除工作流
│   ├── POST   /:id/run   执行工作流
│   └── POST   /:id/mock  Mock 执行工作流
│
├── /executions
│   ├── GET    /          获取执行历史
│   ├── GET    /:id       获取执行详情
│   ├── GET    /:id/nodes 获取执行节点状态
│   ├── GET    /:id/stream 实时日志流 (SSE)
│   ├── GET    /:id/logs  查询执行日志
│   └── POST   /:id/logs/export 导出执行日志
│
├── /ai
│   ├── POST   /chat      AI 对话（流式）
│   └── GET    /chat/:session_id/history 对话历史
│
└── /config
    ├── GET    /ai        获取 AI 配置列表
    ├── POST   /ai        添加 AI 配置
    ├── PUT    /ai/:id    更新 AI 配置
    ├── DELETE /ai/:id    删除 AI 配置
    ├── POST   /ai/:id/test 测试 AI 配置
    ├── GET    /system    获取系统配置
    └── PUT    /system    更新系统配置
```

## 4.9 错误码定义

| HTTP 状态码 | 错误类型 | 说明 |
|------------|---------|------|
| 200 | success | 请求成功 |
| 400 | bad_request | 请求参数错误 |
| 401 | unauthorized | API 密钥无效或过期 |
| 404 | not_found | 资源不存在 |
| 409 | conflict | 资源冲突（如名称已存在） |
| 422 | unprocessable | 请求格式正确但无法处理（如 AI 生成失败） |
| 429 | rate_limited | 请求频率限制 |
| 500 | internal_error | 服务器内部错误 |
| 502 | bad_gateway | AI 服务不可用 |
| 504 | timeout | 请求超时 |
