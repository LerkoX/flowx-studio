# 9. 安全与错误处理设计

## 9.1 安全设计

### 9.1.1 代码执行安全

AI 生成的代码可能包含恶意逻辑，必须通过多层防护确保系统安全。

#### 第一层：输入验证

- **参数类型检查**：确保输入参数符合声明的类型
- **参数范围限制**：字符串长度、数值范围等
- **禁止字符过滤**：过滤可能导致注入的特殊字符

```go
func validateParam(param db.Parameter, value interface{}) error {
    switch param.Type {
    case "string":
        str, ok := value.(string)
        if !ok {
            return fmt.Errorf("parameter %s must be string", param.Name)
        }
        if len(str) > 10000 {
            return fmt.Errorf("parameter %s exceeds max length", param.Name)
        }
    case "integer":
        // 验证整数范围和类型
    }
    return nil
}
```

#### 第二层：Mock 沙箱执行

Mock 测试在隔离环境中运行：

**Docker 隔离**：
- 使用非 root 用户运行容器
- 只读根文件系统（read-only rootfs）
- 禁用网络访问（除非节点明确需要）
- 限制 CPU 和内存使用
- 设置执行超时

```dockerfile
# Mock 执行 Dockerfile 模板
FROM python:3.11-slim

# 创建非 root 用户
RUN useradd -m -u 1000 flowx
USER flowx

# 设置工作目录
WORKDIR /home/flowx

# 复制脚本
COPY --chown=flowx:flowx script.py .

# 只读执行
CMD ["python", "script.py"]
```

**进程隔离（无 Docker 时）**：

Linux：
```go
// 使用 seccomp 限制系统调用
// 使用 cgroup 限制资源
// 使用 chroot 隔离文件系统
cmd := exec.Command("python", "script.py")
cmd.SysProcAttr = &syscall.SysProcAttr{
    Chroot: "/tmp/sandbox",
    Credential: &syscall.Credential{
        Uid: 1000, // 非 root
        Gid: 1000,
    },
}
```

#### 第三层：文件系统隔离

- 每个 Mock 执行使用独立的临时目录
- 执行完成后立即清理临时文件
- 禁止访问系统敏感目录（/etc, /proc, /sys 等）

#### 第四层：网络隔离

- Mock 执行默认禁用网络访问
- 需要网络的节点在 Docker 中限制为仅允许特定域名
- 记录所有网络请求日志

### 9.1.2 API 安全

#### 认证与授权

V1 版本为本地单用户应用，暂不需要多用户认证。但需防止外部未授权访问：

- **本地绑定**：默认绑定 `127.0.0.1`，仅本机可访问
- **可选密码保护**：可通过配置启用密码保护
- **CORS 限制**：仅允许同源请求

```go
// CORS 中间件
func corsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 仅允许本地来源
        origin := r.Header.Get("Origin")
        if origin == "" || strings.HasPrefix(origin, "http://localhost") {
            w.Header().Set("Access-Control-Allow-Origin", origin)
        }
        next.ServeHTTP(w, r)
    })
}
```

#### 请求限流

防止 API 被滥用：

```go
type RateLimiter struct {
    requests map[string][]time.Time
    limit    int
    window   time.Duration
    mu       sync.Mutex
}

func (rl *RateLimiter) Allow(clientID string) bool {
    rl.mu.Lock()
    defer rl.mu.Unlock()
    
    now := time.Now()
    requests := rl.requests[clientID]
    
    // 清理过期请求
    var valid []time.Time
    for _, t := range requests {
        if now.Sub(t) < rl.window {
            valid = append(valid, t)
        }
    }
    
    if len(valid) >= rl.limit {
        return false
    }
    
    rl.requests[clientID] = append(valid, now)
    return true
}
```

默认限流配置：
- AI 生成 API：每用户 10 请求/分钟
- 其他 API：每用户 100 请求/分钟

### 9.1.3 数据安全

#### API Key 加密存储

```go
// 使用 AES-GCM 加密
func encrypt(plaintext string, key []byte) (string, error) {
    block, err := aes.NewCipher(key)
    if err != nil {
        return "", err
    }
    
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }
    
    nonce := make([]byte, gcm.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return "", err
    }
    
    ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
    return base64.StdEncoding.EncodeToString(ciphertext), nil
}
```

#### 加密密钥管理

- 优先从环境变量 `FLOWX_ENCRYPTION_KEY` 读取
- 如未设置，自动生成并存储在 `~/.flowx/.key` 中
- 文件权限设置为 0600（仅所有者可读写）

### 9.1.4 日志安全

- 不在日志中记录 API Key、密码等敏感信息
- 日志文件权限设置为 0640
- 定期清理过期日志

## 9.2 错误处理设计

### 9.2.1 错误分类

| 类别 | 示例 | 处理策略 |
|------|------|---------|
| 用户输入错误 | 参数缺失、格式错误 | 返回 400，提示具体错误 |
| 资源不存在 | 节点/工作流 ID 不存在 | 返回 404 |
| 资源冲突 | 节点名称已存在 | 返回 409，建议重命名 |
| AI 服务错误 | API Key 无效、模型不可用 | 返回 502，记录日志 |
| AI 生成失败 | 输出格式不符合预期 | 返回 422，返回原始响应 |
| 执行错误 | 节点执行失败 | 返回 200（执行已记录），详情在结果中 |
| 内部错误 | 数据库连接失败 | 返回 500，记录详细错误 |
| 超时错误 | 执行超过时限 | 返回 504，标记执行状态为 failed |

### 9.2.2 错误响应格式

遵循 RFC 7807 Problem Details：

```json
{
  "type": "https://flowx.dev/errors/validation-error",
  "title": "Validation Error",
  "status": 400,
  "detail": "Invalid request parameters",
  "instance": "/api/v1/nodes",
  "errors": [
    {
      "field": "name",
      "message": "Node name is required"
    },
    {
      "field": "language",
      "message": "Language must be one of: python, go, bash, node"
    }
  ]
}
```

### 9.2.3 前端错误处理

#### 全局错误边界

```typescript
// 捕获未处理的 React 组件错误
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    // 上报错误日志
    logError(error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <h2>应用出现错误</h2>
          <p>请刷新页面重试，或联系支持团队。</p>
          <button onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

#### API 错误处理

```typescript
// Axios 全局错误拦截
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data;
    
    switch (status) {
      case 400:
        toast.error(`请求错误: ${data.detail}`);
        break;
      case 401:
        toast.error('API Key 无效或已过期');
        break;
      case 404:
        toast.error('请求的资源不存在');
        break;
      case 409:
        toast.error(`资源冲突: ${data.detail}`);
        break;
      case 422:
        toast.error(`无法处理: ${data.detail}`);
        break;
      case 429:
        toast.error('请求过于频繁，请稍后再试');
        break;
      case 502:
        toast.error('AI 服务暂时不可用，请检查配置');
        break;
      case 504:
        toast.error('请求超时，请稍后重试');
        break;
      default:
        toast.error(`服务器错误: ${error.message}`);
    }
    
    return Promise.reject(error);
  }
);
```

### 9.2.4 AI 生成失败处理

AI 生成可能失败的场景：

1. **模型输出格式错误**：AI 未按要求的格式输出
2. **生成内容不完整**：AI 输出被截断
3. **生成代码语法错误**：AI 生成的代码有语法问题
4. **模型服务不可用**：网络问题或 API 限制

**处理策略**：

```go
func (g *NodeGenerator) GenerateNode(ctx context.Context, description string, opts GenerateOptions) (*db.Node, error) {
    maxRetries := 3
    
    for i := 0; i < maxRetries; i++ {
        node, err := g.tryGenerate(ctx, description, opts)
        if err == nil {
            return node, nil
        }
        
        // 记录失败原因
        log.Printf("Generation attempt %d failed: %v", i+1, err)
        
        // 如果是可重试错误，继续重试
        if isRetryableError(err) && i < maxRetries-1 {
            time.Sleep(time.Second * time.Duration(i+1))
            continue
        }
        
        // 不可重试错误，直接返回
        return nil, fmt.Errorf("failed to generate node after %d attempts: %w", maxRetries, err)
    }
    
    return nil, fmt.Errorf("max retries exceeded")
}
```

### 9.2.5 执行错误处理

工作流执行过程中可能出错：

1. **节点执行失败**：代码错误、超时、资源不足
2. **依赖节点失败**：上游节点失败导致下游跳过
3. **系统错误**：数据库错误、内存不足

**处理策略**：

```go
func (s *ExecutionService) handleExecutionError(executionID int64, nodeID string, err error) {
    // 1. 记录错误
    s.executionRepo.UpdateNodeError(executionID, nodeID, err.Error())
    
    // 2. 更新节点状态
    s.executionRepo.UpdateNodeStatus(executionID, nodeID, "failed")
    
    // 3. 判断是否需要终止整个工作流
    if isFatalError(err) {
        s.executionRepo.UpdateStatus(executionID, "failed", time.Now())
        s.eventBridge.EmitExecutionError(executionID, err)
    }
    
    // 4. 推送错误事件到前端
    s.eventBridge.EmitNodeError(executionID, nodeID, err)
}
```

## 9.3 日志与监控

### 9.3.1 日志规范

**日志级别使用规范**：

| 级别 | 使用场景 |
|------|---------|
| DEBUG | 开发调试、详细的执行跟踪 |
| INFO | 系统启动、请求处理、状态变更 |
| WARN | 非致命错误、降级处理、配置缺失 |
| ERROR | 请求失败、执行错误、外部服务异常 |
| FATAL | 系统启动失败、数据库连接失败 |

**日志字段规范**：

```go
log.Info("Execution started",
    "execution_id", executionID,
    "workflow_id", workflowID,
    "workflow_name", workflowName,
    "trigger", "manual",
    "timestamp", time.Now().UTC(),
)
```

### 9.3.2 关键指标监控

需要监控的关键指标：

| 指标 | 类型 | 说明 |
|------|------|------|
| http_requests_total | Counter | HTTP 请求总数 |
| http_request_duration | Histogram | HTTP 请求耗时 |
| ai_requests_total | Counter | AI 调用总数 |
| ai_request_duration | Histogram | AI 调用耗时 |
| ai_tokens_used | Counter | Token 使用量 |
| executions_total | Counter | 执行总数 |
| execution_duration | Histogram | 执行耗时 |
| active_executions | Gauge | 当前活跃执行数 |
| nodes_total | Gauge | 注册节点总数 |
| workflows_total | Gauge | 工作流总数 |

### 9.3.3 健康检查

提供健康检查端点：

```http
GET /api/v1/health
```

**响应**：

```json
{
  "status": "healthy",
  "timestamp": "2025-01-20T10:00:00Z",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "ai_service": "ok",
    "disk_space": "ok"
  }
}
```

## 9.4 备份与恢复

### 9.4.1 自动备份

- 每次启动时自动创建数据库备份（保留最近 3 个）
- 数据库文件变化超过 10% 时触发增量备份

### 9.4.2 手动导出

提供 API 导出所有数据：

```http
POST /api/v1/export
```

**响应**：JSON 文件包含所有节点、工作流、配置。

### 9.4.3 恢复

通过替换数据库文件恢复：

```bash
# 停止服务
pkill flowx

# 恢复备份
cp ~/.flowx/flowx.db.backup ~/.flowx/flowx.db

# 启动服务
flowx
```

## 9.5 安全审计

### 9.5.1 操作审计日志

记录所有关键操作：

```sql
CREATE TABLE audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT NOT NULL,        -- create_node | delete_node | run_workflow | update_config
    resource_type TEXT NOT NULL,      -- node | workflow | execution | config
    resource_id TEXT,
    details     TEXT,                 -- JSON 格式的操作详情
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 9.5.2 审计事件

需要审计的操作：
- 节点创建、删除
- 工作流创建、删除、执行
- AI 配置修改
- 系统配置变更
- 导出数据操作
