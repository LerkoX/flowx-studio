package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/sandbox"
)

// NodeService 节点服务
type NodeService struct {
	db       *db.DB
	executor *sandbox.Executor
	eventBus *event.Bus
}

// NewNodeService 创建节点服务
func NewNodeService(database *db.DB, bus *event.Bus) *NodeService {
	return &NodeService{
		db:       database,
		executor: sandbox.NewExecutor(),
		eventBus: bus,
	}
}

// List 获取节点列表
func (s *NodeService) List(language, tag, search, nodeType string, page, pageSize int) (*model.PaginatedResponse, error) {
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

	var total int
	if err := s.db.Get(&total, "SELECT COUNT(*) FROM nodes "+whereClause, args...); err != nil {
		return nil, fmt.Errorf("failed to count nodes: %w", err)
	}

	query := "SELECT * FROM nodes " + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.db.Queryx(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query nodes: %w", err)
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

	return &model.PaginatedResponse{
		Items:    nodes,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// GetByName 根据名称获取节点
func (s *NodeService) GetByName(name string) (*model.Node, error) {
	row := s.db.QueryRowx("SELECT * FROM nodes WHERE name = ?", name)
	var node model.Node
	if err := scanNode(row, &node); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("node not found")
		}
		return nil, fmt.Errorf("failed to get node: %w", err)
	}
	return &node, nil
}

// Get 获取节点详情
func (s *NodeService) Get(id int64) (*model.Node, error) {
	row := s.db.QueryRowx("SELECT * FROM nodes WHERE id = ?", id)
	var node model.Node
	if err := scanNode(row, &node); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("node not found")
		}
		return nil, fmt.Errorf("failed to get node: %w", err)
	}
	return &node, nil
}

// Create 创建节点
func (s *NodeService) Create(req *model.Node) (*model.Node, error) {
	if strings.TrimSpace(req.Name) == "" {
		return nil, fmt.Errorf("name is required")
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
	filesJSON, _ := json.Marshal(req.Files)
	pkgJSON, _ := json.Marshal(req.PackageConfig)

	result, err := s.db.Exec(`
		INSERT INTO nodes (name, display_name, description, version, author, icon, node_type,
			language, code, entry, requirements, image, parameters, outputs, docker_config, mock_config,
			files, package_config, source_type, source_url, source_path, tags)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image, string(paramsJSON), string(outputsJSON),
		string(dockerJSON), string(mockJSON), string(filesJSON), string(pkgJSON), req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON))

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return nil, fmt.Errorf("node name already exists")
		}
		return nil, fmt.Errorf("failed to create node: %w", err)
	}

	id, _ := result.LastInsertId()
	req.ID = id

	s.eventBus.Publish(event.Event{
		Type: "node.created",
		Data: req,
	})

	return req, nil
}

// Update 更新节点
func (s *NodeService) Update(id int64, req *model.Node) error {
	paramsJSON, _ := json.Marshal(req.Parameters)
	outputsJSON, _ := json.Marshal(req.Outputs)
	reqsJSON, _ := json.Marshal(req.Requirements)
	dockerJSON, _ := json.Marshal(req.DockerConfig)
	mockJSON, _ := json.Marshal(req.MockConfig)
	tagsJSON, _ := json.Marshal(req.Tags)
	filesJSON, _ := json.Marshal(req.Files)
	pkgJSON, _ := json.Marshal(req.PackageConfig)

	_, err := s.db.Exec(`
		UPDATE nodes SET
			name = ?, display_name = ?, description = ?, version = ?, author = ?, icon = ?, node_type = ?,
			language = ?, code = ?, entry = ?, requirements = ?, image = ?,
			parameters = ?, outputs = ?, docker_config = ?, mock_config = ?,
			files = ?, package_config = ?, source_type = ?, source_url = ?, source_path = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image,
		string(paramsJSON), string(outputsJSON), string(dockerJSON), string(mockJSON),
		string(filesJSON), string(pkgJSON), req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON), id)

	if err != nil {
		return fmt.Errorf("failed to update node: %w", err)
	}

	req.ID = id
	s.eventBus.Publish(event.Event{
		Type: "node.updated",
		Data: req,
	})

	return nil
}

// Delete 删除节点
func (s *NodeService) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM nodes WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete node: %w", err)
	}

	s.eventBus.Publish(event.Event{
		Type: "node.deleted",
		Data: map[string]int64{"id": id},
	})

	return nil
}

// MockTest Mock 测试节点
func (s *NodeService) MockTest(id int64, parameters map[string]string, timeout int) (*sandbox.Result, error) {
	node, err := s.Get(id)
	if err != nil {
		return nil, err
	}

	if node.NodeType != "code" {
		return nil, fmt.Errorf("mock test only supports code nodes")
	}

	code := node.Code
	if node.MockConfig != nil && node.MockConfig.Enabled && node.MockConfig.Code != "" {
		code = node.MockConfig.Code
	}

	if strings.TrimSpace(code) == "" {
		return nil, fmt.Errorf("node code is empty")
	}

	if parameters == nil {
		parameters = make(map[string]string)
	}

	envVars := make(map[string]string)
	for _, param := range node.Parameters {
		key := "FLOWX_PARAM_" + strings.ToUpper(param.Name)
		if val, ok := parameters[param.Name]; ok && val != "" {
			envVars[key] = val
		} else if param.Default != nil {
			envVars[key] = fmt.Sprintf("%v", param.Default)
		}
		// 兼容：同时注入裸大写名（历史行为），FLOWX_PARAM_ 前缀为规范写法
		if v, ok := envVars[key]; ok {
			envVars[strings.ToUpper(param.Name)] = v
		}
	}

	d := 30 * time.Second
	if timeout > 0 {
		d = time.Duration(timeout) * time.Second
	}
	if d > 5*time.Minute {
		d = 5 * time.Minute
	}
	s.executor.Timeout = d

	result := s.executor.Execute(sandbox.ExecuteOptions{
		Code:     code,
		Language: node.Language,
		Entry:    node.Entry,
		EnvVars:  envVars,
		Files:    node.Files,
	})

	return result, nil
}

func scanNode(scanner interface {
	Scan(dest ...interface{}) error
}, node *model.Node) error {
	var paramsJSON, outputsJSON, reqsJSON, dockerJSON, mockJSON, tagsJSON, filesJSON, pkgJSON string

	dests := []interface{}{
		&node.ID, &node.Name, &node.DisplayName, &node.Description, &node.Version,
		&node.Author, &node.Icon, &node.NodeType, &node.Language, &node.Code,
		&node.Entry, &reqsJSON, &node.Image, &paramsJSON, &outputsJSON,
		&dockerJSON, &mockJSON, &node.SourceType, &node.SourceURL, &node.SourcePath,
		&tagsJSON, &node.CreatedAt, &node.UpdatedAt, &filesJSON, &pkgJSON,
	}

	if err := scanner.Scan(dests...); err != nil {
		return err
	}

	json.Unmarshal([]byte(paramsJSON), &node.Parameters)
	json.Unmarshal([]byte(outputsJSON), &node.Outputs)
	json.Unmarshal([]byte(reqsJSON), &node.Requirements)
	json.Unmarshal([]byte(dockerJSON), &node.DockerConfig)
	json.Unmarshal([]byte(mockJSON), &node.MockConfig)
	json.Unmarshal([]byte(tagsJSON), &node.Tags)
	json.Unmarshal([]byte(filesJSON), &node.Files)
	json.Unmarshal([]byte(pkgJSON), &node.PackageConfig)

	return nil
}
