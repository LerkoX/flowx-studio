package service

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
)

// SystemConfigService 管理系统配置（system_configs 表）的读写，
// 提供类型化访问、写入校验与内存缓存；供 handler / cleanup / workflow / node 等模块消费。
type SystemConfigService struct {
	db    *db.DB
	mu    sync.RWMutex
	cache map[string]string
}

// NewSystemConfigService 创建系统配置服务
func NewSystemConfigService(database *db.DB) *SystemConfigService {
	return &SystemConfigService{db: database, cache: make(map[string]string)}
}

// configKeyValidators 已知配置键及其校验器；未列入的键拒绝写入，
// 避免前端/CLI 拼写错误产生静默失效的配置项。
var configKeyValidators = map[string]func(string) error{
	"theme":                     isOneOf("dark", "light", "system"),
	"language":                  isOneOf("zh-CN", "en-US"),
	"auto_save":                 isBoolValue,
	"auto_save_interval":        isIntRange(5, 300),
	"show_notifications":        isBoolValue,
	"confirm_before_delete":     isBoolValue,
	"default_node_timeout":      isIntRange(10, 3600),
	"max_concurrent_executions": isIntRange(1, 50),
	"log_retention_days":        isIntRange(1, 90),
}

func isOneOf(values ...string) func(string) error {
	return func(v string) error {
		for _, allowed := range values {
			if v == allowed {
				return nil
			}
		}
		return fmt.Errorf("must be one of: %s", strings.Join(values, ", "))
	}
}

func isBoolValue(v string) error {
	if v != "true" && v != "false" {
		return fmt.Errorf("must be true or false")
	}
	return nil
}

func isIntRange(min, max int) func(string) error {
	return func(v string) error {
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("must be an integer")
		}
		if n < min || n > max {
			return fmt.Errorf("must be between %d and %d", min, max)
		}
		return nil
	}
}

// All 返回全部配置键值（含 description 为空的历史键）
func (s *SystemConfigService) All() (map[string]string, error) {
	var configs []model.SystemConfig
	if err := s.db.Select(&configs, "SELECT * FROM system_configs"); err != nil {
		return nil, fmt.Errorf("failed to get system config: %w", err)
	}
	result := make(map[string]string, len(configs))
	for _, cfg := range configs {
		result[cfg.Key] = cfg.Value
	}
	return result, nil
}

// load 读穿缓存：缓存未命中时从 DB 加载并回填
func (s *SystemConfigService) load(key string) (string, bool) {
	s.mu.RLock()
	v, ok := s.cache[key]
	s.mu.RUnlock()
	if ok {
		return v, true
	}

	var value string
	err := s.db.Get(&value, "SELECT value FROM system_configs WHERE key = ?", key)
	if err != nil {
		return "", false
	}

	s.mu.Lock()
	s.cache[key] = value
	s.mu.Unlock()
	return value, true
}

// GetInt 读取整数配置，缺失或非法时返回 def
func (s *SystemConfigService) GetInt(key string, def int) int {
	if v, ok := s.load(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// GetBool 读取布尔配置，缺失或非法时返回 def
func (s *SystemConfigService) GetBool(key string, def bool) bool {
	if v, ok := s.load(key); ok {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

// GetString 读取字符串配置，缺失时返回 def
func (s *SystemConfigService) GetString(key, def string) string {
	if v, ok := s.load(key); ok {
		return v
	}
	return def
}

// Set 校验并批量写入配置；任一键校验失败则整体不写入
func (s *SystemConfigService) Set(settings map[string]string) error {
	for key, value := range settings {
		validator, known := configKeyValidators[key]
		if !known {
			return fmt.Errorf("unknown config key: %s", key)
		}
		if err := validator(value); err != nil {
			return fmt.Errorf("invalid value for %s: %v", key, err)
		}
	}

	for key, value := range settings {
		_, err := s.db.Exec(`
			INSERT INTO system_configs (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
		`, key, value)
		if err != nil {
			return fmt.Errorf("failed to update system config: %w", err)
		}
	}

	s.mu.Lock()
	for key, value := range settings {
		s.cache[key] = value
	}
	s.mu.Unlock()
	return nil
}
