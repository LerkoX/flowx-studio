package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/gin-gonic/gin"
)

func setupAssetRouter(t *testing.T) (*gin.Engine, *assets.Store) {
	t.Helper()
	store := &assets.Store{
		Root:     t.TempDir(),
		HTTPBase: "http://localhost",
		SignKey:  []byte("0123456789abcdef0123456789abcdef"),
	}
	if _, err := store.Put("demo", "1.0.0", map[string]assets.FileData{
		"main.sh": {Content: []byte("echo hi\n"), Kind: assets.KindRuntime},
	}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewAssetHandler(store).RegisterRoutes(r)
	return r, store
}

func TestAssetHandlerSignedAccess(t *testing.T) {
	r, store := setupAssetRouter(t)

	// 无签名 → 403
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/assets/nodes/demo@1.0.0/main.sh", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 without sig, got %d", w.Code)
	}

	// 有效签名 → 200 + 字节一致
	signed := store.SignedURL("demo", "1.0.0", time.Minute)
	u, _ := url.Parse(signed)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/v1/assets/nodes/demo@1.0.0/main.sh?"+u.Query().Encode(), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with valid sig, got %d body=%s", w.Code, w.Body.String())
	}
	if w.Body.String() != "echo hi\n" {
		t.Errorf("unexpected body: %q", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("unexpected content type: %s", ct)
	}

	// 签名 URL 拉别的节点 → 403
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/v1/assets/nodes/other@1.0.0/main.sh?"+u.Query().Encode(), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for other node, got %d", w.Code)
	}

	// 路径穿越 → 404
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/v1/assets/nodes/demo@1.0.0/../../etc/passwd?"+u.Query().Encode(), nil)
	r.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Error("path traversal must not succeed")
	}
}
