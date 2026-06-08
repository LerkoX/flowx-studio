package model

import "time"

// NodeParameter 节点参数定义
type NodeParameter struct {
	Name        string      `json:"name" db:"name"`
	Type        string      `json:"type" db:"type"`
	Description string      `json:"description" db:"description"`
	Required    bool        `json:"required" db:"required"`
	Default     interface{} `json:"default,omitempty" db:"default"`
}

// NodeOutput 节点输出定义
type NodeOutput struct {
	Name        string `json:"name" db:"name"`
	Type        string `json:"type" db:"type"`
	Description string `json:"description" db:"description"`
}

// NodeDockerConfig Docker 配置
type NodeDockerConfig struct {
	Image   string `json:"image,omitempty" db:"image"`
	Workdir string `json:"workdir,omitempty" db:"workdir"`
}

// NodeMockConfig Mock 配置
type NodeMockConfig struct {
	Enabled bool   `json:"enabled" db:"enabled"`
	Entry   string `json:"entry,omitempty" db:"entry"`
}

// Node 节点定义
type Node struct {
	ID          int64             `json:"id" db:"id"`
	Name        string            `json:"name" db:"name"`
	DisplayName string            `json:"displayName,omitempty" db:"display_name"`
	Description string            `json:"description,omitempty" db:"description"`
	Version     string            `json:"version,omitempty" db:"version"`
	Author      string            `json:"author,omitempty" db:"author"`
	Icon        string            `json:"icon,omitempty" db:"icon"`
	NodeType    string            `json:"nodeType" db:"node_type"` // code | image

	// 代码节点字段
	Language     string   `json:"language,omitempty" db:"language"`
	Code         string   `json:"code,omitempty" db:"code"`
	Entry        string   `json:"entry,omitempty" db:"entry"`
	Requirements []string `json:"requirements,omitempty" db:"requirements"`

	// 镜像节点字段
	Image string `json:"image,omitempty" db:"image"`

	// 通用配置
	Parameters   []NodeParameter  `json:"parameters" db:"parameters"`
	Outputs      []NodeOutput     `json:"outputs,omitempty" db:"outputs"`
	DockerConfig *NodeDockerConfig `json:"docker,omitempty" db:"docker_config"`
	MockConfig   *NodeMockConfig   `json:"mock,omitempty" db:"mock_config"`

	// 来源信息
	SourceType string `json:"sourceType,omitempty" db:"source_type"` // git | manual
	SourceURL  string `json:"sourceURL,omitempty" db:"source_url"`
	SourcePath string `json:"sourcePath,omitempty" db:"source_path"`

	Tags      []string  `json:"tags,omitempty" db:"tags"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

// Workflow 工作流
type Workflow struct {
	ID          int64     `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description,omitempty" db:"description"`
	Intent      string    `json:"intent,omitempty" db:"intent"`
	YAMLConfig  string    `json:"yamlConfig" db:"yaml_config"`
	Status      string    `json:"status" db:"status"` // draft | active | archived
	CreatedAt   time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time `json:"updatedAt" db:"updated_at"`
}

// WorkflowNode 工作流节点关联
type WorkflowNode struct {
	ID           int64                  `json:"id" db:"id"`
	WorkflowID   int64                  `json:"workflowId" db:"workflow_id"`
	NodeID       int64                  `json:"nodeId" db:"node_id"`
	NodeName     string                 `json:"nodeName" db:"node_name"`
	SortOrder    int                    `json:"sortOrder" db:"sort_order"`
	ParamOverride map[string]interface{} `json:"paramOverride,omitempty" db:"param_override"`
	Condition    string                 `json:"condition,omitempty" db:"condition"`
	IsEnabled    bool                   `json:"isEnabled" db:"is_enabled"`
}

// Execution 执行记录
type Execution struct {
	ID           int64     `json:"id" db:"id"`
	WorkflowID   int64     `json:"workflowId" db:"workflow_id"`
	Status       string    `json:"status" db:"status"` // pending | running | success | failed | cancelled
	Trigger      string    `json:"trigger" db:"trigger"` // manual | schedule | api
	StartedAt    *time.Time `json:"startedAt,omitempty" db:"started_at"`
	CompletedAt  *time.Time `json:"completedAt,omitempty" db:"completed_at"`
	DurationMs   int       `json:"durationMs,omitempty" db:"duration_ms"`
	Result       string    `json:"result,omitempty" db:"result"`
	ErrorMessage string    `json:"errorMessage,omitempty" db:"error_message"`
	ErrorNodeID  string    `json:"errorNodeId,omitempty" db:"error_node_id"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
}

// ExecutionNode 执行节点状态
type ExecutionNode struct {
	ID           int64      `json:"id" db:"id"`
	ExecutionID  int64      `json:"executionId" db:"execution_id"`
	NodeID       string     `json:"nodeId" db:"node_id"`
	NodeName     string     `json:"nodeName,omitempty" db:"node_name"`
	Status       string     `json:"status" db:"status"` // pending | running | success | failed | skipped
	StartedAt    *time.Time `json:"startedAt,omitempty" db:"started_at"`
	CompletedAt  *time.Time `json:"completedAt,omitempty" db:"completed_at"`
	DurationMs   int        `json:"durationMs,omitempty" db:"duration_ms"`
	Output       string     `json:"output,omitempty" db:"output"`
	Error        string     `json:"error,omitempty" db:"error"`
}

// ExecutionLog 执行日志
type ExecutionLog struct {
	ID          int64     `json:"id" db:"id"`
	ExecutionID int64     `json:"executionId" db:"execution_id"`
	NodeID      string    `json:"nodeId,omitempty" db:"node_id"`
	NodeName    string    `json:"nodeName,omitempty" db:"node_name"`
	StepName    string    `json:"stepName,omitempty" db:"step_name"`
	Level       string    `json:"level" db:"level"` // debug | info | warn | error | fatal
	Message     string    `json:"message" db:"message"`
	Output      string    `json:"output,omitempty" db:"output"`
	Timestamp   time.Time `json:"timestamp" db:"timestamp"`
}

// AIConfig AI 提供商配置
type AIConfig struct {
	ID           int64     `json:"id" db:"id"`
	Provider     string    `json:"provider" db:"provider"` // openai | anthropic | ollama | custom
	Name         string    `json:"name" db:"name"`
	Model        string    `json:"model" db:"model"`
	APIKey       string    `json:"apiKey,omitempty" db:"api_key"`
	BaseURL      string    `json:"baseURL,omitempty" db:"base_url"`
	Temperature  float64   `json:"temperature" db:"temperature"`
	MaxTokens    int       `json:"maxTokens,omitempty" db:"max_tokens"`
	IsActive     bool      `json:"isActive" db:"is_active"`
	IsEnabled    bool      `json:"isEnabled" db:"is_enabled"`
	Capabilities string    `json:"capabilities,omitempty" db:"capabilities"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt    time.Time `json:"updatedAt" db:"updated_at"`
}

// MCPConfig MCP 服务器配置
type MCPConfig struct {
	ID              int64             `json:"id" db:"id"`
	Name            string            `json:"name" db:"name"`
	Mode            string            `json:"mode" db:"mode"` // local | remote
	Command         string            `json:"command,omitempty" db:"command"`
	Args            []string          `json:"args,omitempty" db:"args"`
	Env             map[string]string `json:"env,omitempty" db:"env"`
	URL             string            `json:"url,omitempty" db:"url"`
	AuthHeaderKey   string            `json:"authHeaderKey,omitempty" db:"auth_header_key"`
	AuthHeaderValue string            `json:"authHeaderValue,omitempty" db:"auth_header_value"`
	IsEnabled       bool              `json:"isEnabled" db:"is_enabled"`
	Status          string            `json:"status" db:"status"` // connected | disconnected | error
	LastError       string            `json:"lastError,omitempty" db:"last_error"`
	CreatedAt       time.Time         `json:"createdAt" db:"created_at"`
	UpdatedAt       time.Time         `json:"updatedAt" db:"updated_at"`
}

// SystemConfig 系统配置
type SystemConfig struct {
	Key         string    `json:"key" db:"key"`
	Value       string    `json:"value" db:"value"`
	Description string    `json:"description,omitempty" db:"description"`
	UpdatedAt   time.Time `json:"updatedAt" db:"updated_at"`
}

// ChatMessage 对话消息
type ChatMessage struct {
	ID           int64     `json:"id" db:"id"`
	SessionID    string    `json:"sessionId" db:"session_id"`
	Role         string    `json:"role" db:"role"` // user | assistant | system
	Content      string    `json:"content" db:"content"`
	ContextType  string    `json:"contextType,omitempty" db:"context_type"` // node_generate | workflow_generate | general
	ContextID    *int64    `json:"contextId,omitempty" db:"context_id"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
}

// PaginatedResponse 分页响应
type PaginatedResponse struct {
	Items    interface{} `json:"items"`
	Total    int         `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"pageSize"`
}

// APIResponse 统一 API 响应
type APIResponse struct {
	Code    int         `json:"code"`
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
}
