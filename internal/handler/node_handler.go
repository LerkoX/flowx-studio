package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/sandbox"
	"github.com/gin-gonic/gin"
)

// NodeHandler 节点处理器
type NodeHandler struct {
	db       *db.DB
	executor *sandbox.Executor
}

// NewNodeHandler 创建节点处理器
func NewNodeHandler(database *db.DB) *NodeHandler {
	return &NodeHandler{
		db:       database,
		executor: sandbox.NewExecutor(),
	}
}

// RegisterRoutes 注册路由
func (h *NodeHandler) RegisterRoutes(r *gin.RouterGroup) {
	nodes := r.Group("/nodes")
	{
		nodes.GET("", h.List)
		nodes.POST("", h.Create)
		nodes.GET("/:id", h.Get)
		nodes.PUT("/:id", h.Update)
		nodes.DELETE("/:id", h.Delete)
		nodes.POST("/:id/mock", h.MockTest)
	}
}

// List 获取节点列表
func (h *NodeHandler) List(c *gin.Context) {
	language := c.Query("language")
	tag := c.Query("tag")
	search := c.Query("search")
	nodeType := c.Query("node_type")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var conditions []string
	var args []interface{}

	if language != "" {
		conditions = append(conditions, "language = ?")
		args = append(args, language)
	}
	if nodeType != "" && nodeType != "all" {
		conditions = append(conditions, "node_type = ?")
		args = append(args, nodeType)
	}
	if tag != "" {
		conditions = append(conditions, "tags LIKE ?")
		args = append(args, "%"+tag+"%")
	}
	if search != "" {
		conditions = append(conditions, "(name LIKE ? OR display_name LIKE ? OR description LIKE ?)")
		args = append(args, "%"+search+"%", "%"+search+"%", "%"+search+"%")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// 查询总数
	var total int
	countQuery := "SELECT COUNT(*) FROM nodes " + whereClause
	if err := h.db.Get(&total, countQuery, args...); err != nil {
		Error(c, http.StatusInternalServerError, "failed to count nodes")
		return
	}

	// 查询数据
	query := "SELECT * FROM nodes " + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := h.db.Queryx(query, args...)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to query nodes")
		return
	}
	defer rows.Close()

	var nodes []model.Node
	for rows.Next() {
		var node model.Node
		if err := scanNode(rows, &node); err != nil {
			continue
		}
		nodes = append(nodes, node)
	}

	Success(c, model.PaginatedResponse{
		Items:    nodes,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// Get 获取节点详情
func (h *NodeHandler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	row := h.db.QueryRowx("SELECT * FROM nodes WHERE id = ?", id)
	var node model.Node
	if err := scanNode(row, &node); err != nil {
		if err == sql.ErrNoRows {
			Error(c, http.StatusNotFound, "node not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get node")
		return
	}

	Success(c, node)
}

// Create 创建节点
func (h *NodeHandler) Create(c *gin.Context) {
	var req model.Node
	if !BindJSON(c, &req) {
		return
	}

	if req.Name == "" {
		Error(c, http.StatusBadRequest, "name is required")
		return
	}
	if req.NodeType == "" {
		req.NodeType = "code"
	}

	paramsJSON, _ := json.Marshal(req.Parameters)
	outputsJSON, _ := json.Marshal(req.Outputs)
	reqsJSON, _ := json.Marshal(req.Requirements)
	dockerJSON, _ := json.Marshal(req.DockerConfig)
	mockJSON, _ := json.Marshal(req.MockConfig)
	tagsJSON, _ := json.Marshal(req.Tags)

	result, err := h.db.Exec(`
		INSERT INTO nodes (name, display_name, description, version, author, icon, node_type,
			language, code, entry, requirements, image, parameters, outputs, docker_config, mock_config,
			source_type, source_url, source_path, tags)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image, string(paramsJSON), string(outputsJSON),
		string(dockerJSON), string(mockJSON), req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON))

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			Error(c, http.StatusConflict, "node name already exists")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to create node: "+err.Error())
		return
	}

	id, _ := result.LastInsertId()
	req.ID = id
	Success(c, req)
}

// Update 更新节点
func (h *NodeHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	var req model.Node
	if !BindJSON(c, &req) {
		return
	}

	paramsJSON, _ := json.Marshal(req.Parameters)
	outputsJSON, _ := json.Marshal(req.Outputs)
	reqsJSON, _ := json.Marshal(req.Requirements)
	dockerJSON, _ := json.Marshal(req.DockerConfig)
	mockJSON, _ := json.Marshal(req.MockConfig)
	tagsJSON, _ := json.Marshal(req.Tags)

	_, err = h.db.Exec(`
		UPDATE nodes SET
			name = ?, display_name = ?, description = ?, version = ?, author = ?, icon = ?, node_type = ?,
			language = ?, code = ?, entry = ?, requirements = ?, image = ?,
			parameters = ?, outputs = ?, docker_config = ?, mock_config = ?,
			source_type = ?, source_url = ?, source_path = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image,
		string(paramsJSON), string(outputsJSON), string(dockerJSON), string(mockJSON),
		req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON), id)

	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to update node: "+err.Error())
		return
	}

	Success(c, gin.H{"id": id})
}

// Delete 删除节点
func (h *NodeHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	_, err = h.db.Exec("DELETE FROM nodes WHERE id = ?", id)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to delete node: "+err.Error())
		return
	}

	Success(c, gin.H{"message": "node deleted"})
}

// MockTestRequest Mock 测试请求
type MockTestRequest struct {
	Parameters map[string]string `json:"parameters"` // 用户输入的参数值
	Timeout    int               `json:"timeout"`    // 超时时间（秒，默认30）
}

// MockTest Mock 测试节点（真实子进程执行）
func (h *NodeHandler) MockTest(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid node id")
		return
	}

	// 获取节点
	row := h.db.QueryRowx("SELECT * FROM nodes WHERE id = ?", id)
	var node model.Node
	if err := scanNode(row, &node); err != nil {
		if err == sql.ErrNoRows {
			Error(c, http.StatusNotFound, "node not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get node")
		return
	}

	// 只支持代码节点
	if node.NodeType != "code" {
		Error(c, http.StatusBadRequest, "mock test only supports code nodes")
		return
	}

	if strings.TrimSpace(node.Code) == "" {
		Error(c, http.StatusBadRequest, "node code is empty")
		return
	}

	// 解析请求参数
	var req MockTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// 没有请求体也允许，使用默认参数
		req.Parameters = make(map[string]string)
	}

	// 构建环境变量（参数通过环境变量注入）
	envVars := make(map[string]string)

	// 注入节点定义的参数默认值
	for _, param := range node.Parameters {
		key := strings.ToUpper(param.Name)
		// 优先使用用户传入的值
		if val, ok := req.Parameters[param.Name]; ok && val != "" {
			envVars[key] = val
		} else if param.Default != nil {
			// 使用默认值
			envVars[key] = fmt.Sprintf("%v", param.Default)
		}
	}

	// 设置超时
	timeout := 30 * time.Second
	if req.Timeout > 0 {
		timeout = time.Duration(req.Timeout) * time.Second
	}
	if timeout > 5*time.Minute {
		timeout = 5 * time.Minute // 最大 5 分钟
	}
	h.executor.Timeout = timeout

	// 执行代码
	opts := sandbox.ExecuteOptions{
		Code:     node.Code,
		Language: node.Language,
		Entry:    node.Entry,
		EnvVars:  envVars,
	}

	result := h.executor.Execute(opts)

	// 返回结果
	Success(c, gin.H{
		"status":      result.Status,
		"duration_ms": result.DurationMs,
		"output":      result.Output,
		"stdout":      result.Stdout,
		"stderr":      result.Stderr,
		"logs":        result.Logs,
		"error":       result.Error,
		"exit_code":   result.ExitCode,
	})
}

// scanNode 从行扫描节点数据
func scanNode(scanner interface{ Scan(dest ...interface{}) error }, node *model.Node) error {
	var paramsJSON, outputsJSON, reqsJSON, dockerJSON, mockJSON, tagsJSON string
	var dests []interface{}

	dests = append(dests,
		&node.ID, &node.Name, &node.DisplayName, &node.Description, &node.Version,
		&node.Author, &node.Icon, &node.NodeType, &node.Language, &node.Code,
		&node.Entry, &reqsJSON, &node.Image, &paramsJSON, &outputsJSON,
		&dockerJSON, &mockJSON, &node.SourceType, &node.SourceURL,
		&node.SourcePath, &tagsJSON, &node.CreatedAt, &node.UpdatedAt,
	)

	if err := scanner.Scan(dests...); err != nil {
		return err
	}

	json.Unmarshal([]byte(paramsJSON), &node.Parameters)
	json.Unmarshal([]byte(outputsJSON), &node.Outputs)
	json.Unmarshal([]byte(reqsJSON), &node.Requirements)
	json.Unmarshal([]byte(dockerJSON), &node.DockerConfig)
	json.Unmarshal([]byte(mockJSON), &node.MockConfig)
	json.Unmarshal([]byte(tagsJSON), &node.Tags)

	return nil
}
