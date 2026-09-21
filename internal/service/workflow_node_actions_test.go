package service

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

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


// ---------- ServiceProxy（设计期通用第三方代理） ----------

func TestServiceProxy(t *testing.T) {
	svc := newPreviewTestService(t)

	var gotAuth, gotMethod, gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotMethod = r.Method
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	// service_url 空 → 直接报错（不打上游）
	if _, _, _, err := svc.ServiceProxy("", "t", "GET", "/x", nil, 0); err == nil {
		t.Fatal("expect error for empty service_url")
	}
	// path 不含 scheme/不允许相对路径（防借 path 逃逸）
	if _, _, _, err := svc.ServiceProxy(upstream.URL, "", "GET", "http://evil/x", nil, 0); err == nil {
		t.Fatal("expect error for absolute-url path")
	}
	if _, _, _, err := svc.ServiceProxy(upstream.URL, "", "GET", "x", nil, 0); err == nil {
		t.Fatal("expect error for relative path")
	}
	// 方法白名单
	if _, _, _, err := svc.ServiceProxy(upstream.URL, "", "TRACE", "/x", nil, 0); err == nil {
		t.Fatal("expect error for disallowed method")
	}

	data, mime, status, err := svc.ServiceProxy(upstream.URL+"/", "sek", "POST", "/anything", []byte(`{"a":1}`), 0)
	if err != nil {
		t.Fatalf("ServiceProxy: %v", err)
	}
	if gotAuth != "Bearer sek" || gotMethod != "POST" || gotPath != "/anything" {
		t.Fatalf("not forwarded correctly: %q %s %s", gotAuth, gotMethod, gotPath)
	}
	if status != 200 || mime != "application/json" || string(data) != `{"ok":true}` {
		t.Fatalf("unexpected passthrough: %d %s %q", status, mime, data)
	}
}

// ---------- NodeServiceProxy（运行期节点级代理，base 只能来自节点记录） ----------

func TestNodeServiceProxy(t *testing.T) {
	svc := newPreviewTestService(t)

	var gotPath, gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("PNGDATA"))
	}))
	defer upstream.Close()

	// 节点无记录连接 → ErrNoNodeConnection
	if _, _, _, err := svc.NodeServiceProxy(42, "N", "GET", "/images/x", nil); !errors.Is(err, ErrNoNodeConnection) {
		t.Fatalf("expect ErrNoNodeConnection, got %v", err)
	}

	// preview 标记上报连接后：二进制透传 + token 转发
	svc.handlePreviewMarker(42, "N", previewMarkerPayload{
		URL: upstream.URL + "/preview/j1", Token: "sek", Base: upstream.URL, JobID: "j1",
	})
	data, mime, status, err := svc.NodeServiceProxy(42, "N", "GET", "/images/imgIN1", nil)
	if err != nil {
		t.Fatalf("NodeServiceProxy: %v", err)
	}
	if string(data) != "PNGDATA" || mime != "image/png" || status != 200 {
		t.Fatalf("unexpected passthrough: %q %s %d", data, mime, status)
	}
	if gotPath != "/images/imgIN1" || gotAuth != "Bearer sek" {
		t.Fatalf("not forwarded correctly: %q %q", gotPath, gotAuth)
	}

	// params.service_url 约定兜底（无 preview 标记的节点）
	_, _ = svc.db.Exec(`UPDATE executions SET metadata_json = ? WHERE id = 42`,
		fmt.Sprintf(`{"params":{"service_url":%q,"service_token":"tk2"},"metadata":{}}`, upstream.URL))
	if _, _, _, err := svc.NodeServiceProxy(42, "Other", "GET", "/status", nil); err != nil {
		t.Fatalf("params fallback: %v", err)
	}
	if gotAuth != "Bearer tk2" {
		t.Fatalf("fallback token not used: %q", gotAuth)
	}
}
