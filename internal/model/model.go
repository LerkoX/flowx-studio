package model

import "time"

// ParamSource 参数数据来源建议
// 指向推荐的上游节点包（nodeRef 为节点包名，非流水线中的节点实例 ID）及其输出字段，
// 供 pipeline 编排者（人或 AI）在 pipeline YAML 中完成实际接线。
type ParamSource struct {
	NodeRef     string `json:"nodeRef" db:"node_ref"`
	Output      string `json:"output" db:"output"`
	Description string `json:"description,omitempty" db:"description"`
}

// NodeParameter 节点参数定义
type NodeParameter struct {
	Name        string       `json:"name" db:"name"`
	Type        string       `json:"type" db:"type"`
	Description string       `json:"description" db:"description"`
	Required    bool         `json:"required" db:"required"`
	Default     interface{}  `json:"default,omitempty" db:"default"`
	Source      *ParamSource `json:"source,omitempty" db:"source"`
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
	Code    string `json:"code,omitempty" db:"code"`
}

// NodeExtractConfig 输出提取配置
type NodeExtractConfig struct {
	Type          string            `json:"type" db:"type"`
	Patterns      map[string]string `json:"patterns,omitempty" db:"patterns"`
	MaxOutputSize int               `json:"maxOutputSize,omitempty" db:"max_output_size"`
}

// NodeExecutorConfig 执行器配置
// ref 与 type 互斥：ref 引用 Studio 注册的执行器实例；type+config 为内联匿名实例；
// 两者都缺省时使用全局默认执行器（有 image 时归为 docker）。
type NodeExecutorConfig struct {
	Ref    string                 `json:"ref,omitempty" db:"ref"`
	Type   string                 `json:"type,omitempty" db:"type"`
	Config map[string]interface{} `json:"config,omitempty" db:"config"`
}

// NodeUIConfig 节点自定义 UI 组件配置（module 模式）。
// Entry 指向节点包内预编译的单文件 JS bundle，画布节点通过
// GET /api/v1/nodes/:id/ui/<entry> 加载并以内嵌组件渲染。
type NodeUIConfig struct {
	Entry      string `json:"entry"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	Collapsed  *bool  `json:"collapsed,omitempty"`
	APIVersion int    `json:"apiVersion,omitempty"`
}

// NodePackage flowx.json 节点包配置
type NodePackage struct {
	Name         string             `json:"name"`
	DisplayName  string             `json:"displayName,omitempty"`
	Description  string             `json:"description,omitempty"`
	Version      string             `json:"version,omitempty"`
	Author       string             `json:"author,omitempty"`
	Tags         []string           `json:"tags,omitempty"`
	Icon         string             `json:"icon,omitempty"`
	Language     string             `json:"language"`
	Entry        string             `json:"entry"`
	Files        []string           `json:"files,omitempty"`
	Image        string             `json:"image,omitempty"`
	Executor     NodeExecutorConfig `json:"executor,omitempty"`
	Requirements []string           `json:"requirements,omitempty"`
	Parameters   []NodeParameter    `json:"parameters"`
	Env          map[string]string  `json:"env,omitempty"`
	Run          string             `json:"run,omitempty"`
	Outputs      []NodeOutput       `json:"outputs,omitempty"`
	Extract      *NodeExtractConfig `json:"extract,omitempty"`
	Mock         *NodeMockConfig    `json:"mock,omitempty"`
	UI           *NodeUIConfig      `json:"ui,omitempty"`
	Timeout      int                `json:"timeout,omitempty"`
}

// NodeFileAsset 节点文件资产索引：文件内容外置到 assets store（<data.dir>/assets/nodes/），
// DB 只存此索引。serving/运行时按需从磁盘读取，二进制安全且不占 JSON 存储。
type NodeFileAsset struct {
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType,omitempty"`
	Kind        string `json:"kind"` // runtime | ui
}

// Node 节点定义
type Node struct {
	ID          int64  `json:"id" db:"id"`
	Name        string `json:"name" db:"name"`
	DisplayName string `json:"displayName,omitempty" db:"display_name"`
	Description string `json:"description,omitempty" db:"description"`
	Version     string `json:"version,omitempty" db:"version"`
	Author      string `json:"author,omitempty" db:"author"`
	Icon        string `json:"icon,omitempty" db:"icon"`
	NodeType    string `json:"nodeType" db:"node_type"` // code | image

	// 代码节点字段
	Language     string   `json:"language,omitempty" db:"language"`
	Code         string   `json:"code,omitempty" db:"code"`
	Entry        string   `json:"entry,omitempty" db:"entry"`
	Requirements []string `json:"requirements,omitempty" db:"requirements"`

	// 镜像节点字段
	Image string `json:"image,omitempty" db:"image"`

	// 通用配置
	Parameters   []NodeParameter   `json:"parameters" db:"parameters"`
	Outputs      []NodeOutput      `json:"outputs,omitempty" db:"outputs"`
	DockerConfig *NodeDockerConfig `json:"docker,omitempty" db:"docker_config"`
	MockConfig   *NodeMockConfig   `json:"mock,omitempty" db:"mock_config"`

	// 节点文件资产索引（path -> 元信息），内容存于 assets store（<data.dir>/assets/nodes/）
	FileAssets map[string]NodeFileAsset `json:"fileAssets,omitempty" db:"file_assets"`

	// 资产目录绝对路径（运行时由 PrepareAssets 填充，不入库、不出 API）
	AssetDir string `json:"-" db:"-"`

	// 资产签名拉取 URL 前缀（docker/k8s 执行器用，PrepareAssets 填充）
	AssetURL string `json:"-" db:"-"`

	// 完整的 flowx.json 包配置（运行时展开使用）
	PackageConfig *NodePackage `json:"-" db:"package_config"`

	// 节点自定义 UI 组件配置（来自 PackageConfig.UI，API 返回用）
	UI *NodeUIConfig `json:"ui,omitempty" db:"-"`

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
	ID            int64                  `json:"id" db:"id"`
	WorkflowID    int64                  `json:"workflowId" db:"workflow_id"`
	NodeID        int64                  `json:"nodeId" db:"node_id"`
	NodeName      string                 `json:"nodeName" db:"node_name"`
	SortOrder     int                    `json:"sortOrder" db:"sort_order"`
	ParamOverride map[string]interface{} `json:"paramOverride,omitempty" db:"param_override"`
	Condition     string                 `json:"condition,omitempty" db:"condition"`
	IsEnabled     bool                   `json:"isEnabled" db:"is_enabled"`
}

// Execution 执行记录
type Execution struct {
	ID           int64      `json:"id" db:"id"`
	WorkflowID   int64      `json:"workflowId" db:"workflow_id"`
	Status       string     `json:"status" db:"status"`   // pending | running | success | failed | cancelled
	Trigger      string     `json:"trigger" db:"trigger"` // manual | schedule | api
	StartedAt    *time.Time `json:"startedAt,omitempty" db:"started_at"`
	CompletedAt  *time.Time `json:"completedAt,omitempty" db:"completed_at"`
	DurationMs   int        `json:"durationMs,omitempty" db:"duration_ms"`
	Result       *string    `json:"result,omitempty" db:"result"`
	ErrorMessage *string    `json:"errorMessage,omitempty" db:"error_message"`
	ErrorNodeID  *string    `json:"errorNodeId,omitempty" db:"error_node_id"`
	MetadataJSON *string    `json:"metadata,omitempty" db:"metadata_json"`
	CreatedAt    time.Time  `json:"createdAt" db:"created_at"`
}

// ExecutionNode 执行节点状态
type ExecutionNode struct {
	ID          int64      `json:"id" db:"id"`
	ExecutionID int64      `json:"executionId" db:"execution_id"`
	NodeID      string     `json:"nodeId" db:"node_id"`
	NodeName    string     `json:"nodeName,omitempty" db:"node_name"`
	Status      string     `json:"status" db:"status"` // pending | running | success | failed | skipped
	StartedAt   *time.Time `json:"startedAt,omitempty" db:"started_at"`
	CompletedAt *time.Time `json:"completedAt,omitempty" db:"completed_at"`
	DurationMs  *int       `json:"durationMs,omitempty" db:"duration_ms"`
	Output      *string    `json:"output,omitempty" db:"output"`
	Error       *string    `json:"error,omitempty" db:"error"`
}

// ExecutionLog 执行日志
type ExecutionLog struct {
	ID          int64     `json:"id" db:"id"`
	ExecutionID int64     `json:"executionId" db:"execution_id"`
	NodeID      *string   `json:"nodeId,omitempty" db:"node_id"`
	NodeName    *string   `json:"nodeName,omitempty" db:"node_name"`
	StepName    *string   `json:"stepName,omitempty" db:"step_name"`
	Level       string    `json:"level" db:"level"` // debug | info | warn | error | fatal
	Message     string    `json:"message" db:"message"`
	Output      *string   `json:"output,omitempty" db:"output"`
	Timestamp   time.Time `json:"timestamp" db:"timestamp"`
}

// AuditLog 审计日志
type AuditLog struct {
	ID           int64     `json:"id" db:"id"`
	Action       string    `json:"action" db:"action"`
	ResourceType string    `json:"resourceType" db:"resource_type"`
	ResourceID   string    `json:"resourceId,omitempty" db:"resource_id"`
	Detail       string    `json:"detail,omitempty" db:"detail"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
}

// SystemConfig 系统配置
type SystemConfig struct {
	Key         string    `json:"key" db:"key"`
	Value       string    `json:"value" db:"value"`
	Description string    `json:"description,omitempty" db:"description"`
	UpdatedAt   time.Time `json:"updatedAt" db:"updated_at"`
}

// Executor 执行器实例（命名配置；local 单例，docker 可多实例）
type Executor struct {
	ID          int64                  `json:"id" db:"id"`
	Name        string                 `json:"name" db:"name"`
	Type        string                 `json:"type" db:"type"` // local | docker
	Description string                 `json:"description,omitempty" db:"description"`
	Config      map[string]interface{} `json:"config" db:"-"`
	ConfigJSON  string                 `json:"-" db:"config"`
	IsDefault   bool                   `json:"isDefault" db:"is_default"`
	CreatedAt   time.Time              `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time              `json:"updatedAt" db:"updated_at"`
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
