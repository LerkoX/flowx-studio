package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
)

// 执行器实例名格式（与节点名规则一致）
var executorNameRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]*$`)

// 各类型执行器合法的 config 键（对齐 flowx/executor 各 adapter 支持的配置项）
var executorConfigKeys = map[string]map[string]bool{
	"local": {
		"workdir": true, "env": true, "shell": true, "timeout": true,
		"pty": true, "ptyWidth": true, "ptyHeight": true,
	},
	"docker": {
		"host": true, "tlsVerify": true, "certPath": true,
		"registry": true, "network": true, "workdir": true,
		"volumes": true, "env": true, "tty": true, "ttyWidth": true, "ttyHeight": true,
	},
}

// ExecutorService 执行器实例服务（local 单例，docker 多实例，全局唯一默认）
type ExecutorService struct {
	db       *db.DB
	eventBus *event.Bus
	audit    *AuditService
}

// NewExecutorService 创建执行器服务
func NewExecutorService(database *db.DB, bus *event.Bus) *ExecutorService {
	return &ExecutorService{db: database, eventBus: bus}
}

// SetAudit 注入审计服务（可选）；审计写入失败不影响主流程
func (s *ExecutorService) SetAudit(a *AuditService) {
	s.audit = a
}

// auditRecord 静默记录审计日志
func (s *ExecutorService) auditRecord(action, resourceID, detail string) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(action, "executor", resourceID, detail)
}

// publish 发布执行器变更事件（executor.created / executor.updated / executor.deleted）
func (s *ExecutorService) publish(evtType string, e *model.Executor) {
	if s.eventBus == nil {
		return
	}
	s.eventBus.Publish(event.Event{Type: evtType, Data: e})
}

// scanExecutor 把数据库行扫描为 model.Executor（config JSON ↔ map 互转）
func scanExecutor(row interface {
	Scan(dest ...interface{}) error
}) (*model.Executor, error) {
	var e model.Executor
	var desc sql.NullString
	var isDefault int
	if err := row.Scan(&e.ID, &e.Name, &e.Type, &desc, &e.ConfigJSON, &isDefault, &e.CreatedAt, &e.UpdatedAt); err != nil {
		return nil, err
	}
	e.Description = desc.String
	e.IsDefault = isDefault == 1
	if e.ConfigJSON != "" {
		if err := json.Unmarshal([]byte(e.ConfigJSON), &e.Config); err != nil {
			return nil, fmt.Errorf("corrupt executor config json: %w", err)
		}
	}
	if e.Config == nil {
		e.Config = map[string]interface{}{}
	}
	return &e, nil
}

const executorColumns = "id, name, type, description, config, is_default, created_at, updated_at"

// List 列出全部执行器实例（local 置顶，其余按名称排序）
func (s *ExecutorService) List() ([]*model.Executor, error) {
	rows, err := s.db.Query(`SELECT ` + executorColumns + ` FROM executors ORDER BY is_default DESC, type = 'local' DESC, name ASC`)
	if err != nil {
		return nil, fmt.Errorf("failed to list executors: %w", err)
	}
	defer rows.Close()

	var out []*model.Executor
	for rows.Next() {
		e, err := scanExecutor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetByID 按 ID 获取执行器
func (s *ExecutorService) GetByID(id int64) (*model.Executor, error) {
	e, err := scanExecutor(s.db.QueryRow(`SELECT `+executorColumns+` FROM executors WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get executor: %w", err)
	}
	return e, nil
}

// GetByName 按名称获取执行器（展开 nodeRef 时按 ref 解析用）
func (s *ExecutorService) GetByName(name string) (*model.Executor, error) {
	e, err := scanExecutor(s.db.QueryRow(`SELECT `+executorColumns+` FROM executors WHERE name = ?`, name))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get executor: %w", err)
	}
	return e, nil
}

// Default 返回默认执行器（is_default = 1）
func (s *ExecutorService) Default() (*model.Executor, error) {
	e, err := scanExecutor(s.db.QueryRow(`SELECT ` + executorColumns + ` FROM executors WHERE is_default = 1`))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get default executor: %w", err)
	}
	return e, nil
}

// validateExecutor 校验执行器实例（名称/类型/config 键白名单）
func validateExecutor(e *model.Executor) error {
	if !executorNameRe.MatchString(e.Name) {
		return fmt.Errorf("executor name must start with a letter and contain only letters, digits, '_' or '-'")
	}
	if len(e.Name) > 64 {
		return fmt.Errorf("executor name too long (max 64)")
	}
	if e.Type != "local" && e.Type != "docker" {
		return fmt.Errorf("unsupported executor type %q: only local and docker are supported (k8s is not implemented yet)", e.Type)
	}
	allowed := executorConfigKeys[e.Type]
	for k, v := range e.Config {
		if !allowed[k] {
			return fmt.Errorf("unknown %s executor config key %q", e.Type, k)
		}
		if err := validateExecutorConfigValue(e.Type, k, v); err != nil {
			return err
		}
	}
	return nil
}

// validateExecutorConfigValue 对 config 值做基本类型校验，避免写库后才在运行时炸
func validateExecutorConfigValue(execType, key string, v interface{}) error {
	switch key {
	case "host", "certPath", "registry", "network", "workdir", "shell", "timeout":
		if _, ok := v.(string); !ok {
			return fmt.Errorf("%s executor config %q must be a string", execType, key)
		}
	case "tlsVerify", "tty", "pty":
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("%s executor config %q must be a boolean", execType, key)
		}
	case "ttyWidth", "ttyHeight", "ptyWidth", "ptyHeight":
		switch v.(type) {
		case float64, int, int64:
		default:
			return fmt.Errorf("%s executor config %q must be a number", execType, key)
		}
	case "volumes":
		list, ok := v.([]interface{})
		if !ok {
			return fmt.Errorf("docker executor config \"volumes\" must be an array of strings")
		}
		for _, item := range list {
			s, ok := item.(string)
			if !ok || !strings.Contains(s, ":") {
				return fmt.Errorf("docker volume entries must be strings in 'host:container' format")
			}
		}
	case "env":
		m, ok := v.(map[string]interface{})
		if !ok {
			return fmt.Errorf("%s executor config \"env\" must be an object", execType)
		}
		for ek, ev := range m {
			if _, ok := ev.(string); !ok {
				return fmt.Errorf("%s executor env %q value must be a string", execType, ek)
			}
		}
	}
	return nil
}

// Create 创建执行器实例。local 已存在时返回冲突错误；docker 可创建多个。
func (s *ExecutorService) Create(e *model.Executor) error {
	if err := validateExecutor(e); err != nil {
		return err
	}
	e.IsDefault = false // 默认执行器只能通过 SetDefault 切换

	cfgJSON, err := json.Marshal(e.Config)
	if err != nil {
		return fmt.Errorf("invalid executor config: %w", err)
	}

	res, err := s.db.Exec(`
		INSERT INTO executors (name, type, description, config, is_default)
		VALUES (?, ?, ?, ?, 0)
	`, e.Name, e.Type, e.Description, string(cfgJSON))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed: executors.name") {
			return fmt.Errorf("executor name %q already exists", e.Name)
		}
		if strings.Contains(err.Error(), "idx_executors_local_singleton") ||
			strings.Contains(err.Error(), "UNIQUE constraint failed: executors.type") {
			return fmt.Errorf("a local executor already exists (only one local executor is allowed)")
		}
		return fmt.Errorf("failed to create executor: %w", err)
	}

	e.ID, _ = res.LastInsertId()
	s.auditRecord("create_executor", fmt.Sprintf("%d", e.ID), "name="+e.Name+" type="+e.Type)
	s.publish("executor.created", e)
	return nil
}

// Update 更新执行器（不允许改 type；local 不允许改名）
func (s *ExecutorService) Update(id int64, req *model.Executor) error {
	existing, err := s.GetByID(id)
	if err != nil {
		return err
	}
	if existing == nil {
		return fmt.Errorf("executor not found")
	}

	// 名称与类型不可变更（改名会破坏 flowx.json 中 executor.ref 引用）
	if req.Name != "" && req.Name != existing.Name {
		return fmt.Errorf("executor name cannot be changed (would break executor.ref references)")
	}
	if req.Type != "" && req.Type != existing.Type {
		return fmt.Errorf("executor type cannot be changed")
	}

	updated := *existing
	updated.Description = req.Description
	if req.Config != nil {
		updated.Config = req.Config
	}
	if err := validateExecutor(&updated); err != nil {
		return err
	}

	cfgJSON, err := json.Marshal(updated.Config)
	if err != nil {
		return fmt.Errorf("invalid executor config: %w", err)
	}

	if _, err := s.db.Exec(`
		UPDATE executors SET description = ?, config = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, updated.Description, string(cfgJSON), id); err != nil {
		return fmt.Errorf("failed to update executor: %w", err)
	}

	updated.ID = id
	s.auditRecord("update_executor", fmt.Sprintf("%d", id), "name="+existing.Name)
	s.publish("executor.updated", &updated)
	return nil
}

// Delete 删除执行器实例。默认执行器禁止删除；local 删除后需有其它默认才允许（调用方保证先切换默认）。
func (s *ExecutorService) Delete(id int64) error {
	existing, err := s.GetByID(id)
	if err != nil {
		return err
	}
	if existing == nil {
		return fmt.Errorf("executor not found")
	}
	if existing.IsDefault {
		return fmt.Errorf("cannot delete the default executor; set another executor as default first")
	}

	if _, err := s.db.Exec(`DELETE FROM executors WHERE id = ?`, id); err != nil {
		return fmt.Errorf("failed to delete executor: %w", err)
	}

	s.auditRecord("delete_executor", fmt.Sprintf("%d", id), "name="+existing.Name)
	s.publish("executor.deleted", existing)
	return nil
}

// SetDefault 把指定执行器设为全局默认（事务内清旧置新）
func (s *ExecutorService) SetDefault(id int64) (*model.Executor, error) {
	target, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, fmt.Errorf("executor not found")
	}
	if target.IsDefault {
		return target, nil // 幂等
	}

	tx, err := s.db.Beginx()
	if err != nil {
		return nil, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE executors SET is_default = 0 WHERE is_default = 1`); err != nil {
		return nil, fmt.Errorf("failed to clear default: %w", err)
	}
	if _, err := tx.Exec(`UPDATE executors SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id); err != nil {
		return nil, fmt.Errorf("failed to set default: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit: %w", err)
	}

	target.IsDefault = true
	s.auditRecord("set_default_executor", fmt.Sprintf("%d", id), "name="+target.Name)
	s.publish("executor.updated", target)
	return target, nil
}

// ResolveForNode 为节点展开解析执行器：
// ref 非空 → 按名查找；否则 defaultFallback 时返回默认执行器。
// 供 node_expander 在展开 nodeRef 工作流时调用。
func (s *ExecutorService) ResolveForNode(ref string, defaultFallback bool) (*model.Executor, error) {
	if ref != "" {
		e, err := s.GetByName(ref)
		if err != nil {
			return nil, err
		}
		if e == nil {
			return nil, fmt.Errorf("executor %q not found; create it on the /executors page or fix the node's executor.ref", ref)
		}
		return e, nil
	}
	if !defaultFallback {
		return nil, nil
	}
	e, err := s.Default()
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, fmt.Errorf("no default executor configured")
	}
	return e, nil
}
