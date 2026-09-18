package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

func setupResolveRouter(t *testing.T) *gin.Engine {
	t.Helper()
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	svc := service.NewNodeService(database, event.NewBus())
	mk := func(name, version string) {
		t.Helper()
		if _, err := svc.Create(&model.Node{
			Name: name, Version: version, NodeType: "code", Language: "bash",
			Code: "echo hi\n", Entry: "main.sh",
			Parameters: []model.NodeParameter{{Name: "x", Type: "string", Description: "x"}},
		}); err != nil {
			t.Fatalf("failed to create %s@%s: %v", name, version, err)
		}
	}
	mk("echo", "1.0.0")
	mk("echo", "1.1.0")
	mk("solo", "2.0.0")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewNodeHandler(svc).RegisterRoutes(r.Group("/api/v1"))
	return r
}

func resolveRefs(t *testing.T, r *gin.Engine, refs ...string) map[string]*model.Node {
	t.Helper()
	body, _ := json.Marshal(map[string]interface{}{"refs": refs})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/nodes/resolve", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			Items map[string]*model.Node `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return resp.Data.Items
}

func TestResolveRefs(t *testing.T) {
	r := setupResolveRouter(t)

	items := resolveRefs(t, r,
		"echo",       // 裸名 → 最新版本
		"echo@1.0.0", // 精确版本
		"echo@9.9.9", // 锁定版本已删除 → 回退最新
		"solo@2.0.0", // 单版本精确
		"ghost",      // 名称不存在 → null
		"bad@@ref",   // 非法 ref → null
		"echo",       // 重复 ref → 去重
	)

	if n := items["echo"]; n == nil || n.Version != "1.1.0" {
		t.Fatalf("bare echo should resolve to 1.1.0, got %+v", n)
	}
	if n := items["echo@1.0.0"]; n == nil || n.Version != "1.0.0" {
		t.Fatalf("echo@1.0.0 should resolve to 1.0.0, got %+v", n)
	}
	if n := items["echo@9.9.9"]; n == nil || n.Version != "1.1.0" {
		t.Fatalf("echo@9.9.9 should fall back to 1.1.0, got %+v", n)
	}
	if n := items["solo@2.0.0"]; n == nil || n.Version != "2.0.0" {
		t.Fatalf("solo@2.0.0 should resolve to 2.0.0, got %+v", n)
	}
	if n, ok := items["ghost"]; !ok || n != nil {
		t.Fatalf("ghost should be null, got %+v (present=%v)", n, ok)
	}
	if n, ok := items["bad@@ref"]; !ok || n != nil {
		t.Fatalf("bad@@ref should be null, got %+v (present=%v)", n, ok)
	}
	if len(items) != 6 {
		t.Fatalf("expected 6 deduped entries, got %d", len(items))
	}
}

func TestResolveRefsLimit(t *testing.T) {
	r := setupResolveRouter(t)
	refs := make([]string, 201)
	for i := range refs {
		refs[i] = "echo"
	}
	body, _ := json.Marshal(map[string]interface{}{"refs": refs})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/nodes/resolve", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for >200 refs, got %d", w.Code)
	}
}
