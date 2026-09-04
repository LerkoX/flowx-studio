package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/sandbox"
	"github.com/LerkoX/flowx-studio/internal/validator"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// ErrNodeReferenced 节点被流水线引用，禁止删除（handler 据此返回 409）
var ErrNodeReferenced = errors.New("node is referenced by workflows")

// NodeService 节点服务
type NodeService struct {
	db       *db.DB
	executor *sandbox.Executor
	eventBus *event.Bus
	audit    *AuditService
	assets   *assets.Store
	sysCfg   *SystemConfigService
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

// SetSystemConfig 注入系统配置服务（可选）；用于默认节点超时
func (s *NodeService) SetSystemConfig(cfg *SystemConfigService) {
	s.sysCfg = cfg
}

// Assets 返回资产存储（未注入时为 nil）
func (s *NodeService) Assets() *assets.Store {
	return s.assets
}

// PrepareAssets 填充 node.AssetDir / node.AssetURL，供展开器生成 cp/curl 引导脚本。
// 节点文件内容一律不落内存/DB，运行时直接从资产目录物化。
func (s *NodeService) PrepareAssets(node *model.Node) {
	if len(node.FileAssets) == 0 || s.assets == nil {
		return
	}
	if dir, err := s.assets.NodeDir(node.Name, node.Version); err == nil {
		node.AssetDir = dir
	}
	// 签名 URL（docker/k8s 执行器通过 HTTP 拉资产用；未配置 HTTPBase 时为空）
	node.AssetURL = s.assets.SignedURL(node.Name, node.Version, assets.DefaultSignTTL)
}

// LoadRuntimeFiles 从资产目录读取 runtime 类文件内容（Mock 沙箱物化用）。
// ui 类资产不进执行链路，跳过不读。
func (s *NodeService) LoadRuntimeFiles(node *model.Node) (map[string]string, error) {
	if len(node.FileAssets) == 0 || s.assets == nil {
		return nil, nil
	}
	files := make(map[string]string, len(node.FileAssets))
	var missing []string
	for rel, asset := range node.FileAssets {
		if asset.Kind == assets.KindUI {
			continue
		}
		content, err := s.assets.Read(node.Name, node.Version, rel)
		if err != nil {
			missing = append(missing, rel)
			continue
		}
		files[rel] = string(content)
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("asset files missing for node %s@%s: %s", node.Name, node.Version, strings.Join(missing, ", "))
	}
	return files, nil
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
		node.Package = nil // 列表接口不回传 flowx.json 包配置，避免负载膨胀
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
	fileAssetsJSON, _ := json.Marshal(req.FileAssets)
	pkgJSON, _ := json.Marshal(req.PackageConfig)

	result, err := s.db.Exec(`
		INSERT INTO nodes (name, display_name, description, version, author, icon, node_type,
			language, code, entry, requirements, image, parameters, outputs, docker_config, mock_config,
			package_config, source_type, source_url, source_path, tags, file_assets)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image, string(paramsJSON), string(outputsJSON),
		string(dockerJSON), string(mockJSON), string(pkgJSON), req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON), string(fileAssetsJSON))

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return nil, fmt.Errorf("node name already exists")
		}
		return nil, fmt.Errorf("failed to create node: %w", err)
	}

	id, _ := result.LastInsertId()
	req.ID = id
	req.Package = req.PackageConfig // API 只读副本（flowx.json 展示）

	s.auditRecord("create_node", fmt.Sprintf("%d", id), "name="+req.Name)
	s.eventBus.Publish(event.Event{
		Type: "node.created",
		Data: req,
	})

	return req, nil
}

// Update 原地更新节点（保持 ID 不变；流水线按 nodeRef 名称引用，不受影响）。
// ID 不存在返回 "node not found"；改名为已占用名称返回 "node name already exists"。
// PackageConfig / FileAssets 无法通过 API 设置（PackageConfig json:"-"，资产由导入流程落盘），
// 请求未携带时保留原值，避免更新导入的节点包时丢失 UI 配置与资产索引。
func (s *NodeService) Update(id int64, req *model.Node) error {
	if err := validator.ValidateNode(req); err != nil {
		return err
	}

	existing, err := s.Get(id)
	if err != nil {
		return err // 含 "node not found"
	}
	if req.PackageConfig == nil {
		req.PackageConfig = existing.PackageConfig
	}
	if req.FileAssets == nil {
		req.FileAssets = existing.FileAssets
	}

	paramsJSON, _ := json.Marshal(req.Parameters)
	outputsJSON, _ := json.Marshal(req.Outputs)
	reqsJSON, _ := json.Marshal(req.Requirements)
	dockerJSON, _ := json.Marshal(req.DockerConfig)
	mockJSON, _ := json.Marshal(req.MockConfig)
	tagsJSON, _ := json.Marshal(req.Tags)
	fileAssetsJSON, _ := json.Marshal(req.FileAssets)
	pkgJSON, _ := json.Marshal(req.PackageConfig)

	result, err := s.db.Exec(`
		UPDATE nodes SET
			name = ?, display_name = ?, description = ?, version = ?, author = ?, icon = ?, node_type = ?,
			language = ?, code = ?, entry = ?, requirements = ?, image = ?,
			parameters = ?, outputs = ?, docker_config = ?, mock_config = ?,
			package_config = ?, source_type = ?, source_url = ?, source_path = ?, tags = ?, file_assets = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.DisplayName, req.Description, req.Version, req.Author, req.Icon, req.NodeType,
		req.Language, req.Code, req.Entry, string(reqsJSON), req.Image,
		string(paramsJSON), string(outputsJSON), string(dockerJSON), string(mockJSON),
		string(pkgJSON), req.SourceType, req.SourceURL, req.SourcePath, string(tagsJSON), string(fileAssetsJSON), id)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("node name already exists")
		}
		return fmt.Errorf("failed to update node: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return fmt.Errorf("node not found")
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
// 被流水线 YAML 以 config.nodeRef 引用的节点禁止删除，避免运行期展开失败
func (s *NodeService) Delete(id int64) error {
	node, getErr := s.Get(id)

	// 节点存在时先检查流水线引用（按 nodeRef 名称匹配，与运行期展开器的查找方式一致）
	if getErr == nil {
		refs, err := s.findReferencingWorkflows(node.Name)
		if err != nil {
			return fmt.Errorf("failed to check node references: %w", err)
		}
		if len(refs) > 0 {
			names := make([]string, len(refs))
			for i, wf := range refs {
				names[i] = fmt.Sprintf("%s(id=%d)", wf.Name, wf.ID)
			}
			return fmt.Errorf("%w: 节点 %q 被 %d 条流水线引用（%s）",
				ErrNodeReferenced, node.Name, len(refs), strings.Join(names, ", "))
		}
	}

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

// findReferencingWorkflows 全量扫描流水线 YAML，返回以 config.nodeRef 引用指定节点名的流水线。
// 解析失败的流水线 YAML 视为不引用（与运行期行为一致：坏 YAML 本身就无法运行）。
func (s *NodeService) findReferencingWorkflows(nodeName string) ([]model.Workflow, error) {
	var workflows []model.Workflow
	if err := s.db.Select(&workflows, "SELECT id, name, yaml_config FROM workflows"); err != nil {
		return nil, err
	}

	var refs []model.Workflow
	for _, wf := range workflows {
		var cfg core.PipelineConfig
		if err := yaml.Unmarshal([]byte(wf.YAMLConfig), &cfg); err != nil {
			continue
		}
		for _, nodeCfg := range cfg.Nodes {
			if nodeCfg.Config == nil {
				continue
			}
			if ref, ok := nodeCfg.Config["nodeRef"].(string); ok && ref == nodeName {
				refs = append(refs, wf)
				break
			}
		}
	}
	return refs, nil
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
	entry := node.Entry
	if node.MockConfig != nil && node.MockConfig.Enabled && node.MockConfig.Code != "" {
		code = node.MockConfig.Code
		if strings.TrimSpace(node.MockConfig.Entry) != "" {
			entry = node.MockConfig.Entry
		}
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

	// 未显式指定超时时使用系统配置 default_node_timeout（默认 30 秒）
	d := 30 * time.Second
	if s.sysCfg != nil {
		d = time.Duration(s.sysCfg.GetInt("default_node_timeout", 30)) * time.Second
	}
	if timeout > 0 {
		d = time.Duration(timeout) * time.Second
	}
	if d > 5*time.Minute {
		d = 5 * time.Minute
	}
	s.executor.Timeout = d

	runtimeFiles, err := s.LoadRuntimeFiles(node)
	if err != nil {
		return nil, err
	}
	// 资产中的同名入口文件会覆盖沙箱写入的 code（mock 代码），需排除
	delete(runtimeFiles, entry)

	result := s.executor.Execute(sandbox.ExecuteOptions{
		Code:     code,
		Language: node.Language,
		Entry:    entry,
		EnvVars:  envVars,
		Files:    runtimeFiles,
	})

	s.auditRecord("mock_node", fmt.Sprintf("%d", id), "name="+node.Name+" status="+result.Status)
	return result, nil
}

// GCAssets 清理无节点引用的资产目录（P4）。
// 规则：
//   - <name>@<version> 目录若无对应节点（按 name + version 匹配，空版本归一为 "0"）→ 删除
//   - Put 崩溃遗留的 .tmp-<pid> 临时目录 → 删除
//   - 不符合命名规则的目录 → 保留（可能是人工放置的，不动）
//
// 返回被删除的目录名列表。
func (s *NodeService) GCAssets() ([]string, error) {
	if s.assets == nil {
		return nil, nil
	}
	rows, err := s.db.Query("SELECT name, COALESCE(NULLIF(version, ''), '0') FROM nodes")
	if err != nil {
		return nil, err
	}
	live := make(map[string]bool)
	for rows.Next() {
		var name, version string
		if err := rows.Scan(&name, &version); err != nil {
			continue
		}
		live[name+"@"+version] = true
	}
	rows.Close()

	dirs, err := s.assets.ListDirs()
	if err != nil {
		return nil, err
	}
	var removed []string
	for _, d := range dirs {
		isTmp := strings.Contains(d, ".tmp-")
		if !isTmp {
			if live[d] {
				continue
			}
			// 只清理形态合法的 <name>@<version> 目录，其他保留
			name, _, found := strings.Cut(d, "@")
			if !found || !packageNamePattern.MatchString(name) {
				continue
			}
		}
		if err := s.assets.RemoveDir(d); err != nil {
			s.auditRecord("gc_assets", "", fmt.Sprintf("dir=%s error=%v", d, err))
			continue
		}
		removed = append(removed, d)
		s.auditRecord("gc_assets", "", "removed="+d)
	}
	return removed, nil
}

func scanNode(scanner interface {
	Scan(dest ...interface{}) error
}, node *model.Node) error {
	var paramsJSON, outputsJSON, reqsJSON, dockerJSON, mockJSON, tagsJSON, pkgJSON string
	var fileAssetsJSON sql.NullString // file_assets 可为 NULL（纯内联节点无资产）

	dests := []interface{}{
		&node.ID, &node.Name, &node.DisplayName, &node.Description, &node.Version,
		&node.Author, &node.Icon, &node.NodeType, &node.Language, &node.Code,
		&node.Entry, &reqsJSON, &node.Image, &paramsJSON, &outputsJSON,
		&dockerJSON, &mockJSON, &node.SourceType, &node.SourceURL, &node.SourcePath,
		&tagsJSON, &node.CreatedAt, &node.UpdatedAt, &pkgJSON,
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
	json.Unmarshal([]byte(pkgJSON), &node.PackageConfig)
	node.Package = node.PackageConfig // API 只读副本（flowx.json 展示）
	if fileAssetsJSON.Valid {
		json.Unmarshal([]byte(fileAssetsJSON.String), &node.FileAssets)
	}
	if node.PackageConfig != nil && node.PackageConfig.UI != nil {
		node.UI = node.PackageConfig.UI
	}

	return nil
}
