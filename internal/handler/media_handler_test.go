package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupMediaRouter(t *testing.T, roots ...string) (*gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewMediaHandler(roots).RegisterRoutes(r.Group("/api/v1"))
	return r, ""
}

func mediaURL(path string) string {
	return "/api/v1/media/file?path=" + url.QueryEscape(path)
}

func TestMediaHandlerServeOK(t *testing.T) {
	root := t.TempDir()
	content := []byte("fake-mp4-bytes")
	fp := filepath.Join(root, "demo.mp4")
	if err := os.WriteFile(fp, content, 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(fp), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expect 200, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != string(content) {
		t.Fatalf("unexpected body: %q", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Fatalf("unexpected content-type: %q", ct)
	}
}

func TestMediaHandlerRange(t *testing.T) {
	root := t.TempDir()
	fp := filepath.Join(root, "demo.mp4")
	if err := os.WriteFile(fp, []byte("0123456789"), 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(fp), nil)
	req.Header.Set("Range", "bytes=2-5")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusPartialContent {
		t.Fatalf("expect 206, got %d", w.Code)
	}
	if w.Body.String() != "2345" {
		t.Fatalf("unexpected range body: %q", w.Body.String())
	}
}

func TestMediaHandlerTraversal(t *testing.T) {
	root := t.TempDir()
	secret := filepath.Join(filepath.Dir(root), "secret.txt")
	if err := os.WriteFile(secret, []byte("nope"), 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(filepath.Join(root, "..", "secret.txt")), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expect 403, got %d", w.Code)
	}
}

func TestMediaHandlerOutsideRoot(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	fp := filepath.Join(other, "a.mp4")
	if err := os.WriteFile(fp, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(fp), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expect 403, got %d", w.Code)
	}
}

func TestMediaHandlerSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	target := filepath.Join(other, "b.mp4")
	if err := os.WriteFile(target, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link.mp4")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(link), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expect 403, got %d", w.Code)
	}
}

func TestMediaHandlerMissingAndDir(t *testing.T) {
	root := t.TempDir()
	r, _ := setupMediaRouter(t, root)

	// 缺少 path 参数 → 400
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/media/file", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expect 400, got %d", w.Code)
	}

	// 目录 → 404
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", mediaURL(root), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expect 404, got %d", w.Code)
	}

	// 不存在 → 404
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", mediaURL(filepath.Join(root, "nope.mp4")), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expect 404, got %d", w.Code)
	}
}
