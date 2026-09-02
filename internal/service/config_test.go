package service

import (
	"path/filepath"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
)

func newConfigTestService(t *testing.T) (*SystemConfigService, func()) {
	t.Helper()
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	return NewSystemConfigService(database), func() { database.Close() }
}

func TestSystemConfigService_SeededDefaults(t *testing.T) {
	svc, cleanup := newConfigTestService(t)
	defer cleanup()

	if got := svc.GetInt("default_node_timeout", -1); got != 300 {
		t.Errorf("default_node_timeout = %d, want 300", got)
	}
	if got := svc.GetInt("max_concurrent_executions", -1); got != 5 {
		t.Errorf("max_concurrent_executions = %d, want 5", got)
	}
	if got := svc.GetBool("confirm_before_delete", false); !got {
		t.Error("confirm_before_delete should default to true")
	}
	if got := svc.GetString("theme", ""); got != "dark" {
		t.Errorf("theme = %q, want dark", got)
	}
}

func TestSystemConfigService_SetValidation(t *testing.T) {
	svc, cleanup := newConfigTestService(t)
	defer cleanup()

	cases := []struct {
		name    string
		key     string
		value   string
		wantErr bool
	}{
		{"unknown key", "no_such_key", "x", true},
		{"theme bad", "theme", "pink", true},
		{"theme ok", "theme", "light", false},
		{"bool bad", "auto_save", "yes", true},
		{"bool ok", "auto_save", "false", false},
		{"int range low", "auto_save_interval", "1", true},
		{"int range high", "log_retention_days", "365", true},
		{"int ok", "max_concurrent_executions", "10", false},
		{"int not number", "default_node_timeout", "abc", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := svc.Set(map[string]string{tc.key: tc.value})
			if (err != nil) != tc.wantErr {
				t.Errorf("Set(%s=%s) err = %v, wantErr %v", tc.key, tc.value, err, tc.wantErr)
			}
		})
	}
}

func TestSystemConfigService_SetPersistsAndCaches(t *testing.T) {
	svc, cleanup := newConfigTestService(t)
	defer cleanup()

	if err := svc.Set(map[string]string{"max_concurrent_executions": "3"}); err != nil {
		t.Fatalf("Set error = %v", err)
	}
	if got := svc.GetInt("max_concurrent_executions", -1); got != 3 {
		t.Errorf("after Set, max_concurrent_executions = %d, want 3", got)
	}

	// 新实例（无缓存）应读到持久化值
	svc2 := NewSystemConfigService(svc.db)
	if got := svc2.GetInt("max_concurrent_executions", -1); got != 3 {
		t.Errorf("fresh instance reads %d, want 3", got)
	}
}
