package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseMediaMarker_LegacyPreview(t *testing.T) {
	v, err := parseMediaMarker(`{"url":"http://svc/preview/1","token":"t","progress":0.5}`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if v.kind != "frame" || v.mode != "replace" || v.srcURL != "http://svc/preview/1" || v.srcToken != "t" {
		t.Fatalf("legacy normalize wrong: %+v", v)
	}
	if !v.legacy {
		t.Fatalf("legacy flag should be true")
	}
}

func TestParseMediaMarker_NewMedia(t *testing.T) {
	raw := `{"kind":"result","source":{"type":"http","url":"http://svc/images/9","token":"x"},"mime":"image/png"}`
	v, err := parseMediaMarker(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if v.kind != "result" || v.mode != "append" || v.srcURL != "http://svc/images/9" {
		t.Fatalf("new normalize wrong: %+v", v)
	}
}

func TestParseMediaMarker_Local(t *testing.T) {
	raw := `{"kind":"video","source":{"type":"local","path":"/tmp/a.mp4"}}`
	v, err := parseMediaMarker(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if v.srcPath != "/tmp/a.mp4" || v.srcURL != "" {
		t.Fatalf("local normalize wrong: %+v", v)
	}
}

func TestSplitMediaMarkers_BothPrefixes(t *testing.T) {
	in := "line1\nFLOWX_PREVIEW {\"url\":\"http://a\"}\nline2\nFLOWX_MEDIA {\"kind\":\"frame\"}\nline3\n"
	rest, markers := splitMediaMarkers(in)
	if len(markers) != 2 {
		t.Fatalf("want 2 markers, got %d", len(markers))
	}
	if rest != "line1\nline2\nline3\n" {
		t.Fatalf("rest = %q", rest)
	}
}

func TestSanitizeNodeID(t *testing.T) {
	if got := sanitizeNodeID("Save/Image.."); got != "Save_Image.." {
		t.Fatalf("sanitizeNodeID = %q", got)
	}
	// 路径分隔符与中文均不允许（防穿越/编码问题）
	if got := sanitizeNodeID("a/b\\c中"); got != "a_b_c_" {
		t.Fatalf("sanitizeNodeID unsafe = %q", got)
	}
	if got := sanitizeNodeID("ok-name_1.2"); got != "ok-name_1.2" {
		t.Fatalf("sanitizeNodeID keep = %q", got)
	}
}

func TestMediaStore_MaterializeAndLatest(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("missing bearer token")
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("PNGDATA"))
	}))
	defer ts.Close()

	m := NewMediaStore(t.TempDir())
	path, err := m.Materialize(7, "KSampler", "frame", "replace", "",
		MediaSource{URL: ts.URL, Token: "tok"})
	if err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "PNGDATA" || filepath.Ext(path) != ".png" {
		t.Fatalf("materialized content wrong: %q %s", data, path)
	}

	got, mt, ok := m.Latest(7, "KSampler", "frame")
	if !ok || mt != "image/png" || filepath.Base(got) == "" {
		t.Fatalf("Latest: ok=%v mt=%s", ok, mt)
	}

	// 来源落盘 manifest（含 token，0600）
	man := filepath.Join(m.execNodeDir(7, "KSampler"), mediaStoreManifest)
	b, err := os.ReadFile(man)
	if err != nil {
		t.Fatalf("manifest: %v", err)
	}
	var mj map[string]string
	_ = json.Unmarshal(b, &mj)
	if mj["url"] != ts.URL || mj["token"] != "tok" {
		t.Fatalf("manifest wrong: %v", mj)
	}
	if fi, _ := os.Stat(man); fi.Mode().Perm() != 0600 {
		t.Fatalf("manifest perm = %v, want 0600", fi.Mode().Perm())
	}
}

func TestMediaStore_Throttle(t *testing.T) {
	var hits int
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("x"))
	}))
	defer ts.Close()
	m := NewMediaStore(t.TempDir())
	if _, err := m.Materialize(1, "N", "frame", "replace", "", MediaSource{URL: ts.URL}); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := m.Materialize(1, "N", "frame", "replace", "", MediaSource{URL: ts.URL}); err == nil {
		t.Fatalf("second replace should be throttled")
	}
	if hits != 1 {
		t.Fatalf("hits = %d, want 1", hits)
	}
	// append 不节流
	if _, err := m.Materialize(1, "N", "result", "append", "", MediaSource{URL: ts.URL}); err != nil {
		t.Fatalf("append 1: %v", err)
	}
	if _, err := m.Materialize(1, "N", "result", "append", "", MediaSource{URL: ts.URL}); err != nil {
		t.Fatalf("append 2: %v", err)
	}
	if hits != 3 {
		t.Fatalf("hits = %d, want 3", hits)
	}
}

func TestMediaStore_Index(t *testing.T) {
	m := NewMediaStore(t.TempDir())
	dir := m.execNodeDir(42, "CannyPrep")
	_ = os.MkdirAll(dir, 0755)
	_ = os.WriteFile(filepath.Join(dir, "frame.jpg"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(dir, "result_1.png"), []byte("bb"), 0644)
	items := m.Index(42)
	if len(items) != 2 {
		t.Fatalf("Index = %d items, want 2", len(items))
	}
	if items[0].NodeID != "CannyPrep" || items[0].Path == "" {
		t.Fatalf("item wrong: %+v", items[0])
	}
}

func TestMediaStore_CleanupTTL(t *testing.T) {
	m := NewMediaStore(t.TempDir())
	m.ttl = time.Hour
	dir := m.execNodeDir(1, "N")
	_ = os.MkdirAll(dir, 0755)
	old := filepath.Join(dir, "frame.jpg")
	_ = os.WriteFile(old, []byte("x"), 0644)
	past := time.Now().Add(-2 * time.Hour)
	_ = os.Chtimes(old, past, past)
	m.Cleanup()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("expired dir should be removed")
	}
}
