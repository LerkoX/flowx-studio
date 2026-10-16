package service

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx/logger"
)

// newPreviewTestService 构造仅用于预览通道测试的 WorkflowService
// （handleLogEntry 的标记拦截只依赖 db/eventBus/previewSrcs）
func newPreviewTestService(t *testing.T) *WorkflowService {
	t.Helper()
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	// execution_logs 有 FK 约束：预置 workflow/execution 行（42 供标记测试用）
	_, err = database.Exec("INSERT INTO workflows (id, name, yaml_config) VALUES (1, 't', 'Name: t')")
	if err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	if _, err := database.Exec("INSERT INTO executions (id, workflow_id) VALUES (42, 1)"); err != nil {
		t.Fatalf("seed execution: %v", err)
	}
	return &WorkflowService{
		db:          database,
		eventBus:    event.NewBus(),
		logRing:     NewLogRingBuffer(1000),
		previewSrcs: make(map[string]*previewSource),
	}
}

// TestHandleLogEntry_PreviewMarkerIntercepted FLOWX_PREVIEW 标记行应被拦截：
// 不落 execution_logs、不进 execution.log 事件，只更新帧来源并广播 node_preview
func TestHandleLogEntry_PreviewMarkerIntercepted(t *testing.T) {
	svc := newPreviewTestService(t)

	// 执行实例需存在（handleLogEntry 只按 entry.Workflow 解析 execID，不查库；
	// 但为贴近真实路径直接调 handleLogEntry，execID 从 entry.Workflow 来）
	marker := `FLOWX_PREVIEW {"url":"http://inference:8100/preview/job1","progress":0.45,"token":"sek"}`
	svc.handleLogEntry(logger.Entry{
		Workflow:  "exec-42",
		Node:      "KSampler",
		Level:     logger.LevelInfo,
		Message:   marker + "\n",
		Output:    marker + "\n",
		Timestamp: time.Now(),
	})

	// 不落库
	var count int
	if err := svc.db.Get(&count, "SELECT COUNT(*) FROM execution_logs WHERE execution_id = 42"); err != nil {
		t.Fatalf("query logs: %v", err)
	}
	if count != 0 {
		t.Errorf("marker line should not be persisted, got %d rows", count)
	}

	// 来源映射已记录
	svc.previewMu.Lock()
	src := svc.previewSrcs["42/KSampler"]
	svc.previewMu.Unlock()
	if src == nil {
		t.Fatal("preview source not recorded")
	}
	if src.url != "http://inference:8100/preview/job1" || src.token != "sek" {
		t.Errorf("unexpected source: %+v", src)
	}
	if src.progress < 0.44 || src.progress > 0.46 {
		t.Errorf("progress = %v, want 0.45", src.progress)
	}

	// 普通日志不受影响
	svc.handleLogEntry(logger.Entry{
		Workflow: "exec-42", Node: "KSampler", Level: logger.LevelInfo,
		Message: "normal log", Timestamp: time.Now(),
	})
	if err := svc.db.Get(&count, "SELECT COUNT(*) FROM execution_logs WHERE execution_id = 42"); err != nil {
		t.Fatalf("query logs: %v", err)
	}
	if count != 1 {
		t.Errorf("normal line should be persisted, got %d rows", count)
	}
}

// TestHandleLogEntry_MarkerInMultilineEntry 断流补齐的尾部是多行合在一个 entry 里回调的：
// 首行是标记时只剥离标记行，其余普通行必须照常落库
// （exec 767 事故：整段 entry 被前缀匹配误吞，补齐内容"什么都没打印"）
func TestHandleLogEntry_MarkerInMultilineEntry(t *testing.T) {
	svc := newPreviewTestService(t)

	marker := `FLOWX_PREVIEW {"url":"http://inference:8100/preview/job9","progress":0.9,"token":"k"}`
	blob := marker + "\ntraceback line\nlatent: abc\n"
	svc.handleLogEntry(logger.Entry{
		Workflow: "exec-42", Node: "KSampler", Level: logger.LevelInfo,
		Message: blob, Output: blob, Timestamp: time.Now(),
	})

	// 标记行被剥离，普通行保留落库
	var msg string
	if err := svc.db.Get(&msg, "SELECT message FROM execution_logs WHERE execution_id = 42"); err != nil {
		t.Fatalf("query logs: %v", err)
	}
	if strings.Contains(msg, "FLOWX_PREVIEW") {
		t.Errorf("marker line should be stripped: %q", msg)
	}
	if !strings.Contains(msg, "traceback line") || !strings.Contains(msg, "latent: abc") {
		t.Errorf("normal lines should be persisted: %q", msg)
	}

	// 帧来源仍被记录
	svc.previewMu.Lock()
	src := svc.previewSrcs["42/KSampler"]
	svc.previewMu.Unlock()
	if src == nil || src.url != "http://inference:8100/preview/job9" {
		t.Fatalf("preview source not recorded: %+v", src)
	}
}
