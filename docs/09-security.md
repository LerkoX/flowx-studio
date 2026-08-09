# 9. 安全与错误处理设计

## 9.1 安全设计

### 9.1.1 代码执行安全

AI 生成的代码可能包含恶意逻辑，必须通过多层防护确保系统安全。

#### 第一层：输入校验

实际实现包含两类校验（不存在 `validateParam` 参数校验函数）：

1. **工作流 YAML 结构校验**：由 `internal/validator/workflow.go` 对工作流定义做结构校验。
2. **代码危险模式黑名单**：Mock 执行前对节点代码做危险模式子串匹配（`internal/sandbox/executor.go:217-242,351-398`），包含：
   - 代码非空与语言白名单校验（python/go/bash/sh/js/ts/ruby/php）
   - 通用危险模式：`os.system`、`subprocess.*`、`eval(`、`exec(`、`socket.socket`、`urllib.request` 等
   - Bash 特有危险命令：`rm -rf`、`dd if`、`curl | sh`、`nc -e` 等
   - 敏感路径文本：`/etc/passwd`、`/root`、`/proc`、`/sys`、`/.ssh` 等

> ⚠️ 该黑名单是**源码文本子串匹配**，可被拼接字符串、编码、变量间接引用等方式绕过，仅作为基础防护。

#### 第二层：Mock 沙箱执行

**Docker 隔离**（规划中，未实现）：

> ⚠️ Docker 隔离未实现。当前实现是在**宿主机上直接创建子进程执行**代码（`internal/sandbox/executor.go:128`），仅配合上节的字符串黑名单。以下为**目标设计**：
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

**进程隔离**（规划中，未实现）：

> ⚠️ chroot/降权/seccomp/cgroup 均未实现。当前实现是宿主机直接子进程执行，且子进程通过 `env = os.Environ()` **继承父进程的全部环境变量**（`internal/sandbox/executor.go:132`）——若父进程环境中存在密钥类变量，会被 Mock 代码读取到，这是现状下的实际风险。以下为**目标设计**：

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

- 每个 Mock 执行使用独立的临时目录（`$TMPDIR/flowx_mock_*`），已实现
- 执行完成后立即清理临时文件，已实现
- 禁止访问系统敏感目录（/etc, /proc, /sys 等）：**仅为源码文本子串匹配**（`internal/sandbox/executor.go:386-395`），即在代码中出现这些路径字符串时拒绝执行；它**不是系统级文件系统限制**，运行中的代码实际仍可访问这些路径，且黑名单可被绕过

#### 第四层：网络隔离（规划中，未实现）

> ⚠️ 未实现系统级网络隔离。当前仅有源码字符串黑名单（`socket.socket`、`urllib.request`、`http.client`、`ftplib`、`smtplib`、`telnetlib` 等，见 `internal/sandbox/executor.go:355-361`），可被绕过。以下为**目标设计**：

- Mock 执行默认禁用网络访问
- 需要网络的节点在 Docker 中限制为仅允许特定域名
- 记录所有网络请求日志

### 9.1.2 API 安全

#### 认证与授权

V1 版本为本地单用户应用，暂不需要多用户认证。但需防止外部未授权访问：

- **绑定地址**：实际默认绑定 `0.0.0.0`（`internal/config/config.go:42`、`internal/server/server.go:35`、`boot.sh:24`），**对所有网卡开放**。⚠️ 这意味着局域网内其他机器可直接访问 API，生产环境建议显式设置 `--host 127.0.0.1` 或 `FLOWX_STUDIO_SERVER_HOST=127.0.0.1`
- **可选密码保护**（规划中，未实现）
- **CORS 限制**：已实现，仅允许 `http://localhost` / `http://127.0.0.1` 来源（`internal/server/server.go:105-122`）

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

#### 请求限流（规划中，未实现）

> ⚠️ 未实现，代码中不存在 RateLimiter。以下为**目标设计**：

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

#### API Key 加密存储（规划中，未实现/待设计）

> ⚠️ 完全不存在：AI 配置存储（`ai_configs` 表）已删除，代码中没有 crypto 相关包。以下为**待设计**的目标方案：

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

#### 加密密钥管理（规划中，未实现/待设计）

- 优先从环境变量 `FLOWX_STUDIO_ENCRYPTION_KEY` 读取（统一使用 `FLOWX_STUDIO` 前缀）
- 如未设置，自动生成并存储在 `~/.flowx-studio/.key` 中
- 文件权限设置为 0600（仅所有者可读写）

### 9.1.4 日志安全

- 不在日志中记录 API Key、密码等敏感信息
- 日志文件权限设置为 0640
- 定期清理过期日志

## 9.2 错误处理设计

### 9.2.1 错误分类

实际使用的 HTTP 状态码仅为 400/404/409/500：

| 类别 | 示例 | 处理策略 |
|------|------|---------|
| 用户输入错误 | 参数缺失、格式错误 | 返回 400，提示具体错误 |
| 资源不存在 | 节点/工作流 ID 不存在 | 返回 404 |
| 资源冲突 | 节点名称已存在 | 返回 409，建议重命名 |
| 执行错误 | 节点执行失败 | 返回 200（执行已记录），详情在结果中 |
| 内部错误 | 数据库连接失败 | 返回 500，记录详细错误 |

**说明**：
- 没有 AI 服务，因此 502（AI 服务错误）/422（AI 生成失败）无来源，不会返回。
- 504 从未返回：Mock 执行超时返回 200，结果中标记 `status: "timeout"`（`internal/sandbox/executor.go:169-175`）。

### 9.2.2 错误响应格式

实际实现**不是** RFC 7807，而是统一响应结构（`internal/handler/common.go:10-14,26-31`）：

- 成功响应：`{"code": 200, "data": ..., "message": "success"}`
- 错误响应：`{"code": <HTTP 状态码>, "message": "<错误描述>"}`（无 `data` 字段）

```json
{
  "code": 400,
  "message": "invalid request body: ..."
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

### 9.2.4 AI 生成失败处理（规划中，未实现）

> ⚠️ 代码中不存在 `NodeGenerator.GenerateNode`，AI 节点生成功能未实现。以下为**目标设计**。

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

**处理策略**（对应实际代码：`WorkflowService`（`internal/service/workflow.go:33`）、`logExecutionError`（workflow.go:318）、`persistRuntimeEvent`（workflow.go:513）、`StartEventBridge`（workflow.go:628））：

1. **记录错误**：`logExecutionError(execID, nodeName, message)` 把节点错误写入 `execution_logs`。
2. **更新节点状态**：`persistRuntimeEvent` 消费 RuntimeAdapter 的事件，更新 `execution_nodes` 状态为 `failed`。
3. **汇总执行状态**：执行结束时根据各节点状态解析最终状态（`resolveFinalStatusFromNodes`），更新 `executions` 记录。
4. **推送错误事件到前端**：`StartEventBridge` 启动的事件桥把事件经 EventBus 推送到 SSE 客户端。

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

**日志字段规范**（规划中，未实现——当前仅标准库 `log.Printf` 控制台输出，无结构化日志）：

```go
log.Info("Execution started",
    "execution_id", executionID,
    "workflow_id", workflowID,
    "workflow_name", workflowName,
    "trigger", "manual",
    "timestamp", time.Now().UTC(),
)
```

### 9.3.2 关键指标监控（规划中，未实现）

> ⚠️ 未实现，无 Prometheus 指标暴露。以下为**目标设计**：

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

### 9.3.3 健康检查（规划中，未实现）

> ⚠️ 未实现，`GET /api/v1/health` 端点不存在。以下为**目标设计**：

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

## 9.4 备份与恢复（规划中，未实现）

> ⚠️ 备份、导出 API 均未实现。以下为**目标设计**。

### 9.4.1 自动备份（规划中，未实现）

- 每次启动时自动创建数据库备份（保留最近 3 个）
- 数据库文件变化超过 10% 时触发增量备份

### 9.4.2 手动导出（规划中，未实现）

提供 API 导出所有数据：

```http
POST /api/v1/export
```

**响应**：JSON 文件包含所有节点、工作流、配置。

### 9.4.3 恢复

通过替换数据库文件恢复（手动操作，无自动化备份）：

```bash
# 停止服务
pkill flowx-studio

# 恢复备份（需自行提前备份）
cp ~/.flowx-studio/studio.db.backup ~/.flowx-studio/studio.db

# 启动服务
flowx-studio server
```

## 9.5 安全审计（规划中，未实现）

> ⚠️ 未实现，数据库中不存在 `audit_logs` 表。以下为**目标设计**。

### 9.5.1 操作审计日志（规划中，未实现）

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

### 9.5.2 审计事件（规划中，未实现）

需要审计的操作：
- 节点创建、删除
- 工作流创建、删除、执行
- AI 配置修改
- 系统配置变更
- 导出数据操作
