package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ---------- InterruptInferenceNode ----------

func TestInterruptInferenceNode(t *testing.T) {
	svc := newPreviewTestService(t)

	var gotBody map[string]interface{}
	var gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/interrupt" {
			w.WriteHeader(404)
			return
		}
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	// 无来源 → ErrNoInferenceSource
	if err := svc.InterruptInferenceNode(42, "Nope"); !errors.Is(err, ErrNoInferenceSource) {
		t.Fatalf("expect ErrNoInferenceSource, got %v", err)
	}

	// marker 上报 base/job_id（新格式）
	svc.handlePreviewMarker(42, "KS", previewMarkerPayload{
		URL: "http://x/preview/job123", Token: "sek", Base: upstream.URL, JobID: "job123",
	})
	if err := svc.InterruptInferenceNode(42, "KS"); err != nil {
		t.Fatalf("interrupt: %v", err)
	}
	if gotBody["job_id"] != "job123" {
		t.Fatalf("job_id not forwarded: %v", gotBody)
	}
	if gotAuth != "Bearer sek" {
		t.Fatalf("token not forwarded: %q", gotAuth)
	}

	// 旧标记（无 base/job_id）：base 缺失 → 从执行 metadata params 兜底；
	// jobID 从 /preview/{id} 形式 url 推导
	_, _ = svc.db.Exec(`UPDATE executions SET metadata_json = ? WHERE id = 42`,
		fmt.Sprintf(`{"params":{"service_url":%q,"service_token":"tok2"}}`, upstream.URL))
	svc.handlePreviewMarker(42, "Old", previewMarkerPayload{
		URL: "http://old/preview/jobLEGACY", Token: "sek",
	})
	if err := svc.InterruptInferenceNode(42, "Old"); err != nil {
		t.Fatalf("legacy interrupt: %v", err)
	}
	if gotBody["job_id"] != "jobLEGACY" {
		t.Fatalf("legacy job_id derive failed: %v", gotBody)
	}
}

// ---------- ReplayNodeOp ----------

func TestReplayNodeOp(t *testing.T) {
	svc := newPreviewTestService(t)

	var gotReq map[string]interface{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/op" {
			w.WriteHeader(404)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&gotReq)
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"outputs":{"image":{"id":"img999","type":"IMAGE"}}}`))
	}))
	defer upstream.Close()

	// 执行 metadata：__op_name/__inputs_resolved + params 兜底来源
	meta := fmt.Sprintf(`{"metadata":{%q:%q,%q:%q},"params":{"service_url":%q,"service_token":"sek"}}`,
		"Prep.__op_name", "preprocess.canny",
		"Prep.__inputs_resolved", `{"image":{"$id":"in1"},"low_threshold":100,"high_threshold":200}`,
		upstream.URL)
	if _, err := svc.db.Exec(`UPDATE executions SET metadata_json = ? WHERE id = 42`, meta); err != nil {
		t.Fatalf("seed metadata: %v", err)
	}

	// 无元数据的节点 → ErrNoReplayMetadata
	if _, err := svc.ReplayNodeOp(42, "Nope", nil); !errors.Is(err, ErrNoReplayMetadata) {
		t.Fatalf("expect ErrNoReplayMetadata, got %v", err)
	}

	// 订阅事件，验证重放后广播 node_preview
	ch, _ := svc.eventBus.Subscribe()

	flat, err := svc.ReplayNodeOp(42, "Prep", map[string]interface{}{"low_threshold": 30})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	// overrides 合并：低阈值被覆盖，其余保留
	inputs, _ := gotReq["inputs"].(map[string]interface{})
	if inputs["low_threshold"] != 30.0 {
		t.Fatalf("override not applied: %v", inputs)
	}
	if inputs["high_threshold"] != 200.0 {
		t.Fatalf("original input lost: %v", inputs)
	}
	if img, _ := inputs["image"].(map[string]interface{}); img["$id"] != "in1" {
		t.Fatalf("object ref lost: %v", inputs)
	}
	if gotReq["name"] != "preprocess.canny" {
		t.Fatalf("op name: %v", gotReq["name"])
	}
	if flat["image"] != "img999" {
		t.Fatalf("flatten: %v", flat)
	}

	// preview 来源指向结果图 + 事件广播（前端 img 自动刷新）
	svc.previewMu.Lock()
	src := svc.previewSrcs["42/Prep"]
	svc.previewMu.Unlock()
	if src == nil || src.url != upstream.URL+"/images/img999" || src.progress != 1.0 {
		t.Fatalf("preview source not updated: %+v", src)
	}
	select {
	case ev := <-ch:
		if ev.Type != "node_preview" {
			t.Fatalf("event type: %v", ev.Type)
		}
		data, _ := ev.Data.(map[string]interface{})
		if data["node_id"] != "Prep" || data["progress"] != 1.0 {
			t.Fatalf("event data: %v", data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("node_preview event not published")
	}
}

// ---------- marker 新字段落库到 previewSource ----------

func TestPreviewMarker_BaseJobID(t *testing.T) {
	svc := newPreviewTestService(t)
	svc.handlePreviewMarker(42, "N", previewMarkerPayload{
		URL: "http://x/preview/j1", Token: "t", Base: "http://x/", JobID: "j1",
	})
	svc.previewMu.Lock()
	src := svc.previewSrcs["42/N"]
	svc.previewMu.Unlock()
	if src.base != "http://x" || src.jobID != "j1" {
		t.Fatalf("base/jobID not recorded: %+v", src)
	}
}

// ---------- ListModelFiles（模型下拉数据源代理） ----------

func TestListModelFiles(t *testing.T) {
	svc := newPreviewTestService(t)

	var gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models/files" || r.Method != http.MethodGet {
			w.WriteHeader(404)
			return
		}
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"files": []map[string]string{{"name": "RealESRGAN_x4plus", "kind": "upscale"}},
		})
	}))
	defer upstream.Close()

	// service_url 空 → 直接报错（不打上游）
	if _, err := svc.ListModelFiles("", "tok"); err == nil {
		t.Fatal("expect error for empty service_url")
	}

	out, err := svc.ListModelFiles(upstream.URL+"/", "sek")
	if err != nil {
		t.Fatalf("ListModelFiles: %v", err)
	}
	if gotAuth != "Bearer sek" {
		t.Fatalf("token not forwarded: %q", gotAuth)
	}
	files, _ := out["files"].([]interface{})
	if len(files) != 1 {
		t.Fatalf("files not proxied: %v", out)
	}
}

// ---------- NodeInputImage（前后对比原图代理） ----------

func TestNodeInputImage(t *testing.T) {
	svc := newPreviewTestService(t)

	var gotPath, gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("PNGDATA"))
	}))
	defer upstream.Close()

	// 无 __inputs_resolved → ErrNoInputImage
	if _, _, err := svc.NodeInputImage(42, "Up", "image"); !errors.Is(err, ErrNoInputImage) {
		t.Fatalf("expect ErrNoInputImage, got %v", err)
	}

	// 执行 metadata 有解析后入参（image 为对象引用）+ preview 标记提供来源
	_, _ = svc.db.Exec(`UPDATE executions SET metadata_json = ? WHERE id = 42`,
		`{"metadata":{"Up.__inputs_resolved":"{\"image\":{\"$id\":\"imgIN1\"},\"tile\":0}"}}`)
	svc.handlePreviewMarker(42, "Up", previewMarkerPayload{
		URL: upstream.URL + "/images/imgOUT", Token: "sek", Base: upstream.URL,
	})

	data, mime, err := svc.NodeInputImage(42, "Up", "image")
	if err != nil {
		t.Fatalf("NodeInputImage: %v", err)
	}
	if string(data) != "PNGDATA" || mime != "image/png" {
		t.Fatalf("unexpected payload: %q %s", data, mime)
	}
	if gotPath != "/images/imgIN1" {
		t.Fatalf("input image id not resolved: %q", gotPath)
	}
	if gotAuth != "Bearer sek" {
		t.Fatalf("token not forwarded: %q", gotAuth)
	}

	// 键不是对象引用（标量）→ ErrNoInputImage
	_, _ = svc.db.Exec(`UPDATE executions SET metadata_json = ? WHERE id = 42`,
		`{"metadata":{"Up.__inputs_resolved":"{\"tile\":0}"}}`)
	if _, _, err := svc.NodeInputImage(42, "Up", "image"); !errors.Is(err, ErrNoInputImage) {
		t.Fatalf("expect ErrNoInputImage for missing key, got %v", err)
	}
}
