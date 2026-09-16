package service

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
)

func newExecutorTestService(t *testing.T) (*ExecutorService, func()) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	svc := NewExecutorService(database, event.NewBus())
	return svc, func() { database.Close() }
}

func TestExecutorService_SeededDefaultLocal(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	def, err := svc.Default()
	if err != nil {
		t.Fatalf("Default() error = %v", err)
	}
	if def == nil {
		t.Fatal("Default() = nil, migration 010 should seed a default local executor")
	}
	if def.Type != "local" || def.Name != "local" || !def.IsDefault {
		t.Errorf("unexpected seeded default: %+v", def)
	}
}

func TestExecutorService_LocalSingleton(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	err := svc.Create(&model.Executor{Name: "local-2", Type: "local"})
	if err == nil {
		t.Fatal("creating a second local executor should fail")
	}
	if got := err.Error(); !contains(got, "only one local executor") {
		t.Errorf("error = %q, want singleton message", got)
	}
}

func TestExecutorService_K8sRejected(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	for _, typ := range []string{"k8s", "kubernetes"} {
		if err := svc.Create(&model.Executor{Name: "k-" + typ, Type: typ}); err == nil {
			t.Errorf("creating %s executor should fail", typ)
		}
	}
}

func TestExecutorService_DockerMultiInstance(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	for _, name := range []string{"docker-a", "docker-b"} {
		if err := svc.Create(&model.Executor{
			Name:   name,
			Type:   "docker",
			Config: map[string]interface{}{"host": "tcp://10.0.0.2:2375"},
		}); err != nil {
			t.Fatalf("Create(%s) error = %v", name, err)
		}
	}

	items, err := svc.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	// 播种的 local + 两个 docker
	if len(items) != 3 {
		t.Errorf("List() returned %d items, want 3", len(items))
	}
}

func TestExecutorService_ConfigValidation(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	cases := []struct {
		name    string
		exec    *model.Executor
		wantErr string
	}{
		{"unknown key", &model.Executor{Name: "d1", Type: "docker", Config: map[string]interface{}{"bogus": 1}}, "unknown docker executor config key"},
		{"host not string", &model.Executor{Name: "d2", Type: "docker", Config: map[string]interface{}{"host": 2375}}, "must be a string"},
		{"volumes bad entry", &model.Executor{Name: "d3", Type: "docker", Config: map[string]interface{}{"volumes": []interface{}{"no-colon"}}}, "host:container"},
		{"local key on docker rejected", &model.Executor{Name: "d4", Type: "docker", Config: map[string]interface{}{"shell": "bash"}}, "unknown docker executor config key"},
		{"bad name", &model.Executor{Name: "1bad", Type: "docker"}, "must start with a letter"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := svc.Create(tc.exec); err == nil || !contains(err.Error(), tc.wantErr) {
				t.Errorf("Create() error = %v, want substring %q", err, tc.wantErr)
			}
		})
	}

	// 合法 docker 配置（含远程 host + TLS）应通过
	err := svc.Create(&model.Executor{
		Name: "docker-remote",
		Type: "docker",
		Config: map[string]interface{}{
			"host":      "tcp://192.168.1.10:2376",
			"tlsVerify": true,
			"certPath":  "/etc/docker/certs",
			"network":   "bridge",
			"volumes":   []interface{}{"/data:/data:ro"},
			"env":       map[string]interface{}{"HTTP_PROXY": "http://proxy:8080"},
		},
	})
	if err != nil {
		t.Errorf("valid docker config rejected: %v", err)
	}
}

func TestExecutorService_SetDefault(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	if err := svc.Create(&model.Executor{Name: "docker-gpu", Type: "docker"}); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	items, _ := svc.List()
	var dockerID int64
	for _, e := range items {
		if e.Name == "docker-gpu" {
			dockerID = e.ID
		}
	}

	if _, err := svc.SetDefault(dockerID); err != nil {
		t.Fatalf("SetDefault() error = %v", err)
	}

	def, _ := svc.Default()
	if def.Name != "docker-gpu" {
		t.Errorf("Default() = %q, want docker-gpu", def.Name)
	}

	// 旧默认（local）应被清除
	local, err := svc.GetByName("local")
	if err != nil || local == nil {
		t.Fatalf("GetByName(local) error = %v", err)
	}
	if local.IsDefault {
		t.Error("local should no longer be default")
	}

	// 默认执行器禁止删除
	if err := svc.Delete(dockerID); err == nil || !contains(err.Error(), "cannot delete the default") {
		t.Errorf("Delete(default) error = %v, want default-protection error", err)
	}

	// 切回 local 后可删 docker
	if _, err := svc.SetDefault(local.ID); err != nil {
		t.Fatalf("SetDefault(local) error = %v", err)
	}
	if err := svc.Delete(dockerID); err != nil {
		t.Errorf("Delete(docker-gpu) error = %v", err)
	}
}

func TestExecutorService_UpdateImmutableFields(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	local, _ := svc.GetByName("local")

	if err := svc.Update(local.ID, &model.Executor{Name: "renamed"}); err == nil || !contains(err.Error(), "name cannot be changed") {
		t.Errorf("rename error = %v, want immutable-name error", err)
	}
	if err := svc.Update(local.ID, &model.Executor{Type: "docker"}); err == nil || !contains(err.Error(), "type cannot be changed") {
		t.Errorf("retype error = %v, want immutable-type error", err)
	}

	// 合法更新 config
	if err := svc.Update(local.ID, &model.Executor{Description: "本机", Config: map[string]interface{}{"shell": "bash", "timeout": "60s"}}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	updated, _ := svc.GetByID(local.ID)
	if updated.Config["shell"] != "bash" {
		t.Errorf("config not updated: %+v", updated.Config)
	}
}

func TestExecutorService_ResolveForNode(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	if err := svc.Create(&model.Executor{Name: "docker-remote", Type: "docker"}); err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// ref 命中
	e, err := svc.ResolveForNode("docker-remote", false)
	if err != nil || e == nil || e.Name != "docker-remote" {
		t.Errorf("ResolveForNode(ref) = %+v, %v", e, err)
	}

	// ref 未命中 → 报错含修复指引
	if _, err := svc.ResolveForNode("missing", false); err == nil || !contains(err.Error(), "not found") {
		t.Errorf("ResolveForNode(missing) error = %v", err)
	}

	// 默认回退
	e, err = svc.ResolveForNode("", true)
	if err != nil || e == nil || e.Name != "local" {
		t.Errorf("ResolveForNode(default) = %+v, %v", e, err)
	}

	// 不回退默认时返回 nil
	e, err = svc.ResolveForNode("", false)
	if err != nil || e != nil {
		t.Errorf("ResolveForNode(no-fallback) = %+v, %v, want nil", e, err)
	}
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }

func TestExecutorService_ResolveTypeForNode(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	if err := svc.Create(&model.Executor{Name: "docker-b", Type: "docker"}); err != nil {
		t.Fatalf("Create(docker-b) error = %v", err)
	}
	if err := svc.Create(&model.Executor{Name: "docker-a", Type: "docker"}); err != nil {
		t.Fatalf("Create(docker-a) error = %v", err)
	}

	e, err := svc.ResolveTypeForNode("local")
	if err != nil || e == nil || e.Name != "local" {
		t.Errorf("ResolveTypeForNode(local) = %+v, %v", e, err)
	}

	e, err = svc.ResolveTypeForNode("docker")
	if err != nil || e == nil || e.Name != "docker-a" {
		t.Errorf("ResolveTypeForNode(docker) = %+v, %v, want deterministic first docker-a", e, err)
	}

	e, err = svc.ResolveTypeForNode("missing")
	if err != nil || e != nil {
		t.Errorf("ResolveTypeForNode(missing) = %+v, %v, want nil", e, err)
	}
}

func TestExecutorService_SetDisabled(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	docker := &model.Executor{Name: "docker-gpu", Type: "docker"}
	if err := svc.Create(docker); err != nil {
		t.Fatalf("Create(docker-gpu) error = %v", err)
	}

	// 默认执行器（local）禁止禁用
	def, err := svc.Default()
	if err != nil || def == nil {
		t.Fatalf("Default() = %+v, %v", def, err)
	}
	if _, err := svc.SetDisabled(def.ID, true); err == nil {
		t.Errorf("SetDisabled(default) expected error, got nil")
	}

	// 禁用 docker 实例：幂等 + 状态落库
	got, err := svc.SetDisabled(docker.ID, true)
	if err != nil || !got.Disabled {
		t.Fatalf("SetDisabled(docker, true) = %+v, %v", got, err)
	}
	if got, err := svc.SetDisabled(docker.ID, true); err != nil || !got.Disabled {
		t.Errorf("SetDisabled idempotent = %+v, %v", got, err)
	}
	reloaded, err := svc.GetByID(docker.ID)
	if err != nil || !reloaded.Disabled {
		t.Errorf("GetByID after disable = %+v, %v, want Disabled=true", reloaded, err)
	}

	// 禁用后：按名引用报错；类型解析跳过（无可用 docker 时返回 nil）
	if _, err := svc.ResolveForNode("docker-gpu", false); err == nil {
		t.Errorf("ResolveForNode(disabled ref) expected error, got nil")
	}
	if e, err := svc.ResolveTypeForNode("docker"); err != nil || e != nil {
		t.Errorf("ResolveTypeForNode(docker) with only disabled instance = %+v, %v, want nil", e, err)
	}

	// 被禁用的实例不能设为默认
	if _, err := svc.SetDefault(docker.ID); err == nil {
		t.Errorf("SetDefault(disabled) expected error, got nil")
	}

	// 启用后恢复：可解析、可设默认
	got, err = svc.SetDisabled(docker.ID, false)
	if err != nil || got.Disabled {
		t.Fatalf("SetDisabled(docker, false) = %+v, %v", got, err)
	}
	if e, err := svc.ResolveTypeForNode("docker"); err != nil || e == nil || e.Name != "docker-gpu" {
		t.Errorf("ResolveTypeForNode(docker) after enable = %+v, %v", e, err)
	}
	if _, err := svc.SetDefault(docker.ID); err != nil {
		t.Errorf("SetDefault after enable error = %v", err)
	}

	// 不存在的实例
	if _, err := svc.SetDisabled(9999, true); err == nil {
		t.Errorf("SetDisabled(missing) expected error, got nil")
	}
}

func TestExecutorService_TestConnection(t *testing.T) {
	svc, cleanup := newExecutorTestService(t)
	defer cleanup()

	// 不存在的实例
	if _, err := svc.TestConnection(9999); err == nil || !contains(err.Error(), "not found") {
		t.Errorf("TestConnection(missing) expected not-found error, got %v", err)
	}

	// local 实例不支持连接测试
	local, err := svc.Default()
	if err != nil || local == nil {
		t.Fatalf("Default() error = %v", err)
	}
	if _, err := svc.TestConnection(local.ID); err == nil || !contains(err.Error(), "only supported for docker") {
		t.Errorf("TestConnection(local) expected docker-only error, got %v", err)
	}

	// docker 实例指向不可达 daemon：返回 ok=false 的结果而不是 Go error
	d := &model.Executor{
		Name:   "docker-dead",
		Type:   "docker",
		Config: map[string]interface{}{"host": "tcp://127.0.0.1:1"},
	}
	if err := svc.Create(d); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	res, err := svc.TestConnection(d.ID)
	if err != nil {
		t.Fatalf("TestConnection(dead daemon) should not return Go error, got %v", err)
	}
	if res.OK {
		t.Error("TestConnection(dead daemon) OK = true, want false")
	}
	if !contains(res.Message, "ping failed") {
		t.Errorf("Message = %q, want ping failure detail", res.Message)
	}
}
