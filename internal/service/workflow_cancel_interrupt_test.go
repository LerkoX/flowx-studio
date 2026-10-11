package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/runtime"
)

// newCancelTestService 构造取消流程测试用的 WorkflowService：
// 真实 Adapter（执行实例不在内存时 Cancel 返回 not found，正好走落库收尾路径）
// + 临时 DB + 一个运行中的执行实例（含运行中节点）。
func newCancelTestService(t *testing.T, execID int64, nodeID string) *WorkflowService {
	t.Helper()
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	if _, err := database.Exec("INSERT INTO workflows (id, name, yaml_config) VALUES (1, 't', 'Name: t')"); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	if _, err := database.Exec("INSERT INTO executions (id, workflow_id, status) VALUES (?, 1, 'running')", execID); err != nil {
		t.Fatalf("seed execution: %v", err)
	}
	if nodeID != "" {
		if _, err := database.Exec(
			"INSERT INTO execution_nodes (execution_id, node_id, node_name, status) VALUES (?, ?, ?, 'running')",
			execID, nodeID, nodeID); err != nil {
			t.Fatalf("seed execution node: %v", err)
		}
	}

	rt := runtime.NewAdapter()
	t.Cleanup(rt.Stop)
	return &WorkflowService{
		db:          database,
		runtime:     rt,
		eventBus:    event.NewBus(),
		logRing:     NewLogRingBuffer(100),
		metaCache:   make(map[int64]map[string]interface{}),
		previewSrcs: make(map[string]*previewSource),
	}
}

// TestCancelExecution_ForwardsRemoteInterrupt 取消执行时，运行中节点上报过任务标识的
// 必须收到一次 POST /interrupt（携带该节点自己的 job_id，Bearer 认证沿用节点 token），
// 用于兜底回收节点进程被强杀时残留的远程任务。
func TestCancelExecution_ForwardsRemoteInterrupt(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	var auths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/interrupt" || r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(body))
		auths = append(auths, r.Header.Get("Authorization"))
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	svc := newCancelTestService(t, 42, "MaskRefine")
	svc.previewSrcs["42/MaskRefine"] = &previewSource{
		base: srv.URL, token: "sek", jobID: "job-abc", updatedAt: time.Now(),
	}

	if err := svc.CancelExecution(42); err != nil {
		t.Fatalf("CancelExecution: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 1 {
		t.Fatalf("expected exactly 1 /interrupt request, got %d (%v)", len(bodies), bodies)
	}
	if want := `{"job_id":"job-abc"}`; bodies[0] != want {
		t.Errorf("interrupt body = %s, want %s", bodies[0], want)
	}
	if auths[0] != "Bearer sek" {
		t.Errorf("Authorization = %q, want %q", auths[0], "Bearer sek")
	}

	var status string
	if err := svc.db.Get(&status, "SELECT status FROM executions WHERE id = 42"); err != nil {
		t.Fatalf("read execution status: %v", err)
	}
	if status != "cancelled" {
		t.Errorf("execution status = %q, want cancelled", status)
	}
}

// TestCancelExecution_SkipsWithoutJobID 未上报任务标识时不发中断请求：
// 空载荷在第三方服务上的语义是“取消该服务全部任务”，会误伤其他执行的任务。
func TestCancelExecution_SkipsWithoutJobID(t *testing.T) {
	var mu sync.Mutex
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	svc := newCancelTestService(t, 43, "MaskPaint")
	// 只有 base/token（如 metadata 兜底），没有 job_id
	svc.previewSrcs["43/MaskPaint"] = &previewSource{
		base: srv.URL, token: "sek", updatedAt: time.Now(),
	}

	if err := svc.CancelExecution(43); err != nil {
		t.Fatalf("CancelExecution: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if hits != 0 {
		t.Errorf("expected no interrupt request without job_id, got %d", hits)
	}
}

// TestCancelExecution_NoConnection 节点未与第三方服务建立连接（无 preview 标记、
// metadata 也无 service_url）时跳过转发，取消流程本身仍必须成功。
func TestCancelExecution_NoConnection(t *testing.T) {
	svc := newCancelTestService(t, 44, "Echo")
	if err := svc.CancelExecution(44); err != nil {
		t.Fatalf("CancelExecution: %v", err)
	}
	var status string
	if err := svc.db.Get(&status, "SELECT status FROM executions WHERE id = 44"); err != nil {
		t.Fatalf("read execution status: %v", err)
	}
	if status != "cancelled" {
		t.Errorf("execution status = %q, want cancelled", status)
	}
}
