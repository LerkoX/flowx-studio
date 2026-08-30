package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/sandbox"
	"github.com/LerkoX/flowx-studio/internal/validator"
)

// NodeService 节点服务
type NodeService struct {
	db       *db.DB
	executor *sandbox.Executor
	eventBus *event.Bus
	audit    *AuditService
	assets   *assets.Store
}

// NewNodeService 创建节点服务
func NewNodeService(database *db.DB, bus *event.Bus) *NodeService {
	return &NodeService{
		db:       database,
		executor: sandbox.NewExecutor(),
		eventBus: bus,
	}
}

// SetAssetStore 注入节点资产存储（可选）；注入后节点文件内容外置到磁盘
func (s *NodeService) SetAssetStore(store *assets.Store) {
	s.assets = store
}

// Assets 返回资产存储（未注入时为 nil）
func (s *NodeService) Assets() *assets.Store {
	return s.assets
}

// HydrateFiles 将 FileAssets 指向的 runtime 资产内容读入 node.Files（供 Mock 沙箱物化），
// 并填充 node.AssetDir 供展开器生成 cp/curl 引导脚本。
// legacy 节点（Files 已有内容）不受影响；ui 类资产不进执行链路，跳过不读。
func (s *NodeService) HydrateFiles(node *model.Node) error {
	if len(node.FileAssets) == 0 || s.assets == nil {
		return nil
	}
	if dir, err := s.assets.NodeDir(node.Name, node.Version); err == nil {
		node.AssetDir = dir
	}
	// 签名 URL（docker/k8s 执行器通过 HTTP 拉资产用；未配置 HTTPBase 时为空）
	node.AssetURL = s.assets.SignedURL(node.Name, node.Version, assets.DefaultSignTTL)
	if node.Files == nil {
		node.Files = make(map[string]string, len(node.FileAssets))
	}
	var missing []string
	for rel, asset := range node.FileAssets {
		if asset.Kind == assets.KindUI {
			continue // ui 资产仅供前端 serving
		}
		if node.Files[rel] != "" {
			continue // legacy 内容优先
		}
		content, err := s.assets.Read(node.Name, node.Version, rel)
		if err != nil {
			missing = append(missing, rel)
			continue
		}
		node.Files[rel] = string(content)
	}
	if len(missing) > 0 {
		return fmt.Errorf("asset files missing for node %s@%s: %s", node.Name, node.Version, strings.Join(missing, ", "))
	}
	return nil
}

// SetAudit 注入审计服务（可选）；审计写入失败不影响主流程
func (s *NodeService) SetAudit(a *AuditService) {
	s.audit = a
}

// auditRecord 静默记录审计日志
func (s *NodeService) auditRecord(action, resourceID, detail string) {
	if s.audit != nil {
		_ = s.audit.Record(action, "node", resourceID, detail)
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
	if err := validator.ValidateNode(req); err != nil {
		return nil, err
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
	fileAssetsJSON, _ := json.Marshal(req.FileAssets)
	pkgJSON, _ := json.Marshal(req.PackageConfig)

	result, err := s.db.Exec(`
		INSERT INTO nodes (name, display_name, description, version, author, icon, node_type,
			language, code, entry, requirements, image, parameters, outputs, docker_config, mock_config,
			files, package_config, source_type, source_url, source_path, tags, file_assets)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image, string(paramsJSON), string(outputsJSON),
		string(dockerJSON), string(mockJSON), string(filesJSON), string(pkgJSON), req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON), string(fileAssetsJSON))

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return nil, fmt.Errorf("node name already exists")
		}
		return nil, fmt.Errorf("failed to create node: %w", err)
	}

	id, _ := result.LastInsertId()
	req.ID = id

	s.auditRecord("create_node", fmt.Sprintf("%d", id), "name="+req.Name)
	s.eventBus.Publish(event.Event{
		Type: "node.created",
		Data: req,
	})

	return req, nil
}

// Update 更新节点
func (s *NodeService) Update(id int64, req *model.Node) error {
	if err := validator.ValidateNode(req); err != nil {
		return err
	}
	paramsJSON, _ := json.Marshal(req.Parameters)
	outputsJSON, _ := json.Marshal(req.Outputs)
	reqsJSON, _ := json.Marshal(req.Requirements)
	dockerJSON, _ := json.Marshal(req.DockerConfig)
	mockJSON, _ := json.Marshal(req.MockConfig)
	tagsJSON, _ := json.Marshal(req.Tags)
	filesJSON, _ := json.Marshal(req.Files)
	fileAssetsJSON, _ := json.Marshal(req.FileAssets)
	pkgJSON, _ := json.Marshal(req.PackageConfig)

	_, err := s.db.Exec(`
		UPDATE nodes SET
			name = ?, display_name = ?, description = ?, version = ?, author = ?, icon = ?, node_type = ?,
			language = ?, code = ?, entry = ?, requirements = ?, image = ?,
			parameters = ?, outputs = ?, docker_config = ?, mock_config = ?,
			files = ?, package_config = ?, source_type = ?, source_url = ?, source_path = ?, tags = ?, file_assets = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image,
		string(paramsJSON), string(outputsJSON), string(dockerJSON), string(mockJSON),
		string(filesJSON), string(pkgJSON), req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON), string(fileAssetsJSON), id)

	if err != nil {
		return fmt.Errorf("failed to update node: %w", err)
	}

	req.ID = id
	s.auditRecord("update_node", fmt.Sprintf("%d", id), "name="+req.Name)
	s.eventBus.Publish(event.Event{
		Type: "node.updated",
		Data: req,
	})

	return nil
}

// Delete 删除节点（同时清理资产目录）
func (s *NodeService) Delete(id int64) error {
	node, getErr := s.Get(id)

	_, err := s.db.Exec("DELETE FROM nodes WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete node: %w", err)
	}

	// 清理外置资产目录（失败仅记录，不阻断删除）
	if getErr == nil && s.assets != nil {
		if rmErr := s.assets.Remove(node.Name, node.Version); rmErr != nil {
			s.auditRecord("delete_node_assets", fmt.Sprintf("%d", id), "error="+rmErr.Error())
		}
	}

	s.auditRecord("delete_node", fmt.Sprintf("%d", id), "")
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

	// 资产外置的节点：先将磁盘资产内容补入 Files，供沙箱物化
	if err := s.HydrateFiles(node); err != nil {
		return nil, err
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

	s.auditRecord("mock_node", fmt.Sprintf("%d", id), "name="+node.Name+" status="+result.Status)
	return result, nil
}

// MigrateLegacyFiles 将 legacy 节点（Files JSON 直接存内容、FileAssets 为空）的文件
// 落盘到资产目录并改写 DB 索引。启动时调用一次；失败仅记录日志，保留 legacy 行为。
func (s *NodeService) MigrateLegacyFiles() (int, error) {
	if s.assets == nil {
		return 0, nil
	}
	resp, err := s.List("", "", "", "", 1, 100)
	if err != nil {
		return 0, err
	}
	items, _ := resp.Items.([]model.Node)
	migrated := 0
	for i := range items {
		node := &items[i]
		if len(node.Files) == 0 || len(node.FileAssets) > 0 {
			continue
		}
		// 跳过空内容占位（不应出现，防御）
		hasContent := false
		for _, v := range node.Files {
			if v != "" {
				hasContent = true
				break
			}
		}
		if !hasContent {
			continue
		}
		uiEntry := ""
		if node.PackageConfig != nil && node.PackageConfig.UI != nil {
			uiEntry = node.PackageConfig.UI.Entry
		}
		fileData := make(map[string]assets.FileData, len(node.Files))
		for rel, content := range node.Files {
			kind := assets.KindRuntime
			if rel == uiEntry || strings.HasPrefix(rel, "ui/") {
				kind = assets.KindUI
			}
			fileData[rel] = assets.FileData{Content: []byte(content), Kind: kind}
		}
		index, err := s.assets.Put(node.Name, node.Version, fileData)
		if err != nil {
			s.auditRecord("migrate_node_assets", fmt.Sprintf("%d", node.ID), "error="+err.Error())
			continue
		}
		indexJSON, _ := json.Marshal(index)
		if _, err := s.db.Exec("UPDATE nodes SET file_assets = ?, files = NULL WHERE id = ?",
			string(indexJSON), node.ID); err != nil {
			s.auditRecord("migrate_node_assets", fmt.Sprintf("%d", node.ID), "error="+err.Error())
			continue
		}
		migrated++
	}
	return migrated, nil
}

func scanNode(scanner interface {
	Scan(dest ...interface{}) error
}, node *model.Node) error {
	var paramsJSON, outputsJSON, reqsJSON, dockerJSON, mockJSON, tagsJSON, pkgJSON string
	var filesJSON, fileAssetsJSON sql.NullString // 资产外置后 files/file_assets 可为 NULL

	dests := []interface{}{
		&node.ID, &node.Name, &node.DisplayName, &node.Description, &node.Version,
		&node.Author, &node.Icon, &node.NodeType, &node.Language, &node.Code,
		&node.Entry, &reqsJSON, &node.Image, &paramsJSON, &outputsJSON,
		&dockerJSON, &mockJSON, &node.SourceType, &node.SourceURL, &node.SourcePath,
		&tagsJSON, &node.CreatedAt, &node.UpdatedAt, &filesJSON, &pkgJSON,
		&fileAssetsJSON,
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
	if filesJSON.Valid {
		json.Unmarshal([]byte(filesJSON.String), &node.Files)
	}
	json.Unmarshal([]byte(pkgJSON), &node.PackageConfig)
	if fileAssetsJSON.Valid {
		json.Unmarshal([]byte(fileAssetsJSON.String), &node.FileAssets)
	}
	if node.PackageConfig != nil && node.PackageConfig.UI != nil {
		node.UI = node.PackageConfig.UI
	}

	return nil
}
