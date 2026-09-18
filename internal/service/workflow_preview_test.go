package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx/logger"
)

// newPreviewTestService 构造仅用于预览通道测试的 WorkflowService
// （handleLogEntry/handlePreviewMarker/GetPreviewFrame 只依赖 db/eventBus/previewSrcs）
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

// TestGetPreviewFrame_RelaysUpstream preview-frame 应按标记来源向推理服务
// 中转拉帧（带 Bearer token），并带短缓存（第二次请求不再打上游）
func TestGetPreviewFrame_RelaysUpstream(t *testing.T) {
	svc := newPreviewTestService(t)

	var hits int
	var gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("jpeg-bytes"))
	}))
	defer upstream.Close()

	payload, _ := json.Marshal(map[string]interface{}{
		"url": upstream.URL + "/preview/job1", "progress": 0.5, "token": "tok-xyz",
	})
	svc.handlePreviewMarker(7, "KSampler", mustParseMarker(t, payload))

	frame, mime, err := svc.GetPreviewFrame(7, "KSampler")
	if err != nil {
		t.Fatalf("GetPreviewFrame: %v", err)
	}
	if string(frame) != "jpeg-bytes" || mime != "image/jpeg" {
		t.Errorf("frame=%q mime=%q", frame, mime)
	}
	if gotAuth != "Bearer tok-xyz" {
		t.Errorf("upstream auth = %q, want Bearer tok-xyz", gotAuth)
	}

	// 短缓存：立即再取一次不应再打上游
	if _, _, err := svc.GetPreviewFrame(7, "KSampler"); err != nil {
		t.Fatalf("cached GetPreviewFrame: %v", err)
	}
	if hits != 1 {
		t.Errorf("upstream hits = %d, want 1 (cached)", hits)
	}

	// 无来源的节点 404 语义
	if _, _, err := svc.GetPreviewFrame(7, "NoSuchNode"); err == nil {
		t.Error("expected error for unknown preview source")
	}
}

func mustParseMarker(t *testing.T, raw []byte) previewMarkerPayload {
	t.Helper()
	var p previewMarkerPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("bad marker json: %v", err)
	}
	return p
}

// TestHandlePreviewMarker_BroadcastsProgressEvent node_preview 事件只带进度，不带媒体
func TestHandlePreviewMarker_BroadcastsProgressEvent(t *testing.T) {
	svc := newPreviewTestService(t)
	ch, _ := svc.eventBus.Subscribe()

	prog := 0.7
	svc.handlePreviewMarker(9, "Sampler", previewMarkerPayload{
		URL: "http://inference/preview/j", Progress: &prog,
	})

	select {
	case evt := <-ch:
		if evt.Type != "node_preview" {
			t.Fatalf("event type = %s, want node_preview", evt.Type)
		}
		data, ok := evt.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("event data type %T", evt.Data)
		}
		if _, hasMedia := data["image"]; hasMedia {
			t.Error("node_preview event must not carry media (image field)")
		}
		if fmt.Sprintf("%v", data["progress"]) != "0.7" {
			t.Errorf("progress = %v, want 0.7", data["progress"])
		}
	case <-time.After(time.Second):
		t.Fatal("no node_preview event published")
	}
}
