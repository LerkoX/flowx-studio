package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/runtime"
	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// GET /workflows/:id/executors 的路由与响应形状（画布执行器徽章的数据源）
func TestGetWorkflowExecutors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	bus := event.NewBus()
	nodeSvc := service.NewNodeService(database, bus)
	if _, err := nodeSvc.Create(&model.Node{
		Name: "gen-image", Version: "1.0.0", NodeType: "code", Language: "python",
		Entry: "main.py", Code: "print('hi')\n",
	}); err != nil {
		t.Fatalf("create node: %v", err)
	}
	execSvc := service.NewExecutorService(database, bus)
	if err := execSvc.Create(&model.Executor{
		Name: "docker-remote-211", Type: "docker",
		Config: map[string]interface{}{"host": "tcp://1.2.3.4:12268"},
	}); err != nil {
		t.Fatalf("create executor: %v", err)
	}

	svc := service.NewWorkflowService(database, runtime.NewAdapter(), bus, nodeSvc)
	svc.SetExecutors(execSvc)
	if _, err := database.Exec(`INSERT INTO workflows (name, description, intent, yaml_config) VALUES ('wf','','', ?)`,
		`Name: wf
Graph: |
  stateDiagram-v2
    [*] --> A
Nodes:
  A:
    config:
      nodeRef: gen-image@1.0.0
      executor:
        type: docker
        ref: docker-remote-211
`); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}

	router := gin.New()
	NewWorkflowHandler(svc).RegisterRoutes(router.Group("/api/v1"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/workflows/1/executors", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}

	var body struct {
		Code int `json:"code"`
		Data struct {
			Source    string `json:"source"`
			Executors map[string]struct {
				Type string `json:"type"`
				Host string `json:"host"`
			} `json:"executors"`
			Nodes map[string]struct {
				Executor string `json:"executor"`
				Type     string `json:"type"`
				Source   string `json:"source"`
			} `json:"nodes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal body: %v (%s)", err, w.Body.String())
	}
	if body.Data.Source != "workflow" {
		t.Fatalf("source = %q, want workflow", body.Data.Source)
	}
	if body.Data.Nodes["A"].Executor != "docker-remote-211" || body.Data.Nodes["A"].Type != "docker" {
		t.Fatalf("node A = %+v, want docker-remote-211/docker", body.Data.Nodes["A"])
	}
	if got := body.Data.Executors["docker-remote-211"]; got.Type != "docker" || got.Host != "tcp://1.2.3.4:12268" {
		t.Fatalf("docker instance = %+v", got)
	}

	// 非法 id / 不存在的执行 → 4xx（前端据此不显示徽章，不阻塞画布）
	for _, target := range []string{
		"/api/v1/workflows/abc/executors",
		"/api/v1/workflows/1/executors?executionId=999",
	} {
		w = httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
		if w.Code < 400 {
			t.Fatalf("%s status = %d, want 4xx", target, w.Code)
		}
	}
}
