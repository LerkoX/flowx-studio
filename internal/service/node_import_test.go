package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/runtime"
)

func TestNodeImportService_ImportFromFolder(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "flowx-node-import-test-")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	flowxJSON := `
{
  "name": "test-download",
  "displayName": "测试下载",
  "description": "测试下载节点",
  "language": "python",
  "entry": "main.py",
  "files": ["utils.py"],
  "image": "python:3.11-slim",
  "executor": {
    "type": "docker",
    "config": {
      "workdir": "/app"
    }
  },
  "parameters": [
    {"name": "url", "type": "string", "description": "URL", "required": true}
  ],
  "outputs": [
    {"name": "file_path", "type": "string", "description": "文件路径"}
  ],
  "extract": {"type": "codec-block"},
  "env": {"URL": "{{ Param.url }}"}
}
`
	if err := os.WriteFile(filepath.Join(tmpDir, "flowx.json"), []byte(flowxJSON), 0644); err != nil {
		t.Fatalf("failed to write flowx.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "main.py"), []byte("print('hello')"), 0644); err != nil {
		t.Fatalf("failed to write main.py: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "utils.py"), []byte("# helper"), 0644); err != nil {
		t.Fatalf("failed to write utils.py: %v", err)
	}

	dbPath := filepath.Join(tmpDir, "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	nodeSvc := NewNodeService(database, event.NewBus())
	importSvc := NewNodeImportService(nodeSvc)

	node, err := importSvc.ImportFromFolder(tmpDir)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	if node.Name != "test-download" {
		t.Errorf("expected name test-download, got %s", node.Name)
	}
	if node.Language != "python" {
		t.Errorf("expected language python, got %s", node.Language)
	}
	if node.Code != "print('hello')" {
		t.Errorf("unexpected code: %s", node.Code)
	}
	if len(node.Files) != 1 {
		t.Errorf("expected 1 file, got %d", len(node.Files))
	}
	if node.Files["utils.py"] != "# helper" {
		t.Errorf("unexpected utils.py content: %s", node.Files["utils.py"])
	}
	if node.PackageConfig == nil {
		t.Fatal("expected package config")
	}
	if node.PackageConfig.Env["URL"] != "{{ Param.url }}" {
		t.Errorf("unexpected env URL: %s", node.PackageConfig.Env["URL"])
	}
	if node.DockerConfig == nil || node.DockerConfig.Image != "python:3.11-slim" {
		t.Errorf("unexpected docker config: %+v", node.DockerConfig)
	}

	cfg, err := runtime.ExpandNodeToConfig(node)
	if err != nil {
		t.Fatalf("expand node failed: %v", err)
	}
	if cfg.Executor != node.Name+"-executor" {
		t.Errorf("unexpected executor name: %s", cfg.Executor)
	}
	if !strings.Contains(cfg.Steps[0].Run, "export URL=\"{{ Param.url }}\"") {
		t.Errorf("unexpected step run: %s", cfg.Steps[0].Run)
	}
	if cfg.Extract == nil || cfg.Extract.Type != "codec-block" {
		t.Errorf("unexpected extract config: %+v", cfg.Extract)
	}
}

// writeTestPackage 构造一个临时节点包目录
func writeTestPackage(t *testing.T, flowxJSON string) (string, func()) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "flowx-node-import-validate-")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "flowx.json"), []byte(flowxJSON), 0644); err != nil {
		t.Fatalf("failed to write flowx.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "main.py"), []byte("print('hello')"), 0644); err != nil {
		t.Fatalf("failed to write main.py: %v", err)
	}
	return tmpDir, func() { os.RemoveAll(tmpDir) }
}

func TestNodeImportService_RejectsUpstreamNodeRef(t *testing.T) {
	// env 模板直接引用流水线节点实例 ID，应被拒绝
	tmpDir, cleanup := writeTestPackage(t, `{
  "name": "bad-node",
  "language": "python",
  "entry": "main.py",
  "parameters": [
    {"name": "chatId", "type": "string", "required": true}
  ],
  "env": {
    "CHAT_ID": "{{ Param.chatId }}",
    "WEATHER_CITY": "{{ GetWeather.city }}"
  }
}`)
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	importSvc := NewNodeImportService(NewNodeService(database, event.NewBus()))
	_, err = importSvc.ImportFromFolder(tmpDir)
	if err == nil {
		t.Fatal("expected import to fail when env references a pipeline node instance ID")
	}
	if !strings.Contains(err.Error(), "GetWeather") || !strings.Contains(err.Error(), "Param") {
		t.Errorf("error should explain the Param-only rule, got: %v", err)
	}

	// run 模板同样不允许引用节点实例 ID
	tmpDir2, cleanup2 := writeTestPackage(t, `{
  "name": "bad-node2",
  "language": "python",
  "entry": "main.py",
  "parameters": [
    {"name": "url", "type": "string", "required": true}
  ],
  "run": "python3 main.py --path '{{ DownloadImage.file_path }}'"
}`)
	defer cleanup2()

	database2, err := db.New(filepath.Join(tmpDir2, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database2.Close()

	importSvc2 := NewNodeImportService(NewNodeService(database2, event.NewBus()))
	if _, err := importSvc2.ImportFromFolder(tmpDir2); err == nil {
		t.Fatal("expected import to fail when run references a pipeline node instance ID")
	}
}

func TestNodeImportService_AcceptsParamSourceHint(t *testing.T) {
	// Param 引用 + source 推荐来源字段，应通过校验并保留 source
	tmpDir, cleanup := writeTestPackage(t, `{
  "name": "good-node",
  "language": "python",
  "entry": "main.py",
  "parameters": [
    {"name": "weatherCity", "type": "string", "required": true,
     "description": "城市名",
     "source": {"nodeRef": "get-weather", "output": "city", "description": "来自天气节点"}}
  ],
  "env": {"WEATHER_CITY": "{{ Param.weatherCity }}"},
  "run": "python3 main.py"
}`)
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	importSvc := NewNodeImportService(NewNodeService(database, event.NewBus()))
	node, err := importSvc.ImportFromFolder(tmpDir)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	src := node.Parameters[0].Source
	if src == nil || src.NodeRef != "get-weather" || src.Output != "city" {
		t.Errorf("unexpected source: %+v", src)
	}
}

func TestNodeImportService_RejectsInvalidParamSource(t *testing.T) {
	tmpDir, cleanup := writeTestPackage(t, `{
  "name": "bad-source-node",
  "language": "python",
  "entry": "main.py",
  "parameters": [
    {"name": "data", "type": "string", "source": {"nodeRef": "get-weather"}}
  ]
}`)
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	importSvc := NewNodeImportService(NewNodeService(database, event.NewBus()))
	_, err = importSvc.ImportFromFolder(tmpDir)
	if err == nil || !strings.Contains(err.Error(), "source.output") {
		t.Errorf("expected source.output required error, got: %v", err)
	}
}

// ---------- UI 组件（module 模式）导入测试 ----------

// writeUITestPackage 构造一个带 UI 组件 bundle 的临时节点包目录
func writeUITestPackage(t *testing.T, flowxJSON string, widgetContent []byte) (string, func()) {
	t.Helper()
	tmpDir, cleanup := writeTestPackage(t, flowxJSON)
	if widgetContent != nil {
		if err := os.MkdirAll(filepath.Join(tmpDir, "ui"), 0755); err != nil {
			t.Fatalf("failed to create ui dir: %v", err)
		}
		if err := os.WriteFile(filepath.Join(tmpDir, "ui", "node-widget.js"), widgetContent, 0644); err != nil {
			t.Fatalf("failed to write widget bundle: %v", err)
		}
	}
	return tmpDir, cleanup
}

func TestNodeImportService_ImportWithUI(t *testing.T) {
	widget := `export default function mount(el, props) {
  el.textContent = 'status: ' + props.status
  return { update(p) { el.textContent = 'status: ' + p.status }, unmount() { el.textContent = '' } }
}
`
	tmpDir, cleanup := writeUITestPackage(t, `{
  "name": "ui-demo-node",
  "language": "python",
  "entry": "main.py",
  "parameters": [],
  "ui": {
    "entry": "ui/node-widget.js",
    "width": 280,
    "height": 140,
    "collapsed": false,
    "apiVersion": 1
  }
}`, []byte(widget))
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	nodeSvc := NewNodeService(database, event.NewBus())
	importSvc := NewNodeImportService(nodeSvc)

	node, err := importSvc.ImportFromFolder(tmpDir)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	// 导入响应即携带 UI 配置
	if node.UI == nil {
		t.Fatal("expected node.UI to be set")
	}
	if node.UI.Entry != "ui/node-widget.js" || node.UI.Width != 280 || node.UI.Height != 140 {
		t.Errorf("unexpected ui config: %+v", node.UI)
	}
	if node.UI.Collapsed == nil || *node.UI.Collapsed != false {
		t.Errorf("unexpected collapsed: %+v", node.UI.Collapsed)
	}
	if node.Files["ui/node-widget.js"] != widget {
		t.Errorf("widget bundle not stored in Files")
	}

	// 重新读取（走 scanNode）后 UI 仍可用
	got, err := nodeSvc.Get(node.ID)
	if err != nil {
		t.Fatalf("get node failed: %v", err)
	}
	if got.UI == nil || got.UI.Entry != "ui/node-widget.js" {
		t.Errorf("expected UI from scanNode, got: %+v", got.UI)
	}
	if got.Files["ui/node-widget.js"] != widget {
		t.Errorf("widget bundle not persisted")
	}
}

func TestNodeImportService_RejectsInvalidUI(t *testing.T) {
	cases := []struct {
		name        string
		flowxJSON   string
		withWidget  bool
		errContains string
	}{
		{
			name:        "missing entry",
			flowxJSON:   `{"name":"ui-bad-1","language":"python","entry":"main.py","parameters":[],"ui":{"width":100}}`,
			withWidget:  true,
			errContains: "ui.entry is required",
		},
		{
			name:        "non-js entry",
			flowxJSON:   `{"name":"ui-bad-2","language":"python","entry":"main.py","parameters":[],"ui":{"entry":"ui/node-widget.html"}}`,
			withWidget:  true,
			errContains: "single-file .js",
		},
		{
			name:        "path traversal",
			flowxJSON:   `{"name":"ui-bad-3","language":"python","entry":"main.py","parameters":[],"ui":{"entry":"../node-widget.js"}}`,
			withWidget:  true,
			errContains: "relative path",
		},
		{
			name:        "entry file not found",
			flowxJSON:   `{"name":"ui-bad-4","language":"python","entry":"main.py","parameters":[],"ui":{"entry":"ui/node-widget.js"}}`,
			withWidget:  false,
			errContains: "not found",
		},
		{
			name:        "unsupported apiVersion",
			flowxJSON:   `{"name":"ui-bad-5","language":"python","entry":"main.py","parameters":[],"ui":{"entry":"ui/node-widget.js","apiVersion":2}}`,
			withWidget:  true,
			errContains: "ui.apiVersion",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var tmpDir string
			var cleanup func()
			if tc.withWidget {
				tmpDir, cleanup = writeUITestPackage(t, tc.flowxJSON, []byte("export default () => {}"))
			} else {
				tmpDir, cleanup = writeTestPackage(t, tc.flowxJSON)
			}
			defer cleanup()

			database, err := db.New(filepath.Join(tmpDir, "test.db"))
			if err != nil {
				t.Fatalf("failed to open db: %v", err)
			}
			defer database.Close()

			importSvc := NewNodeImportService(NewNodeService(database, event.NewBus()))
			_, err = importSvc.ImportFromFolder(tmpDir)
			if err == nil || !strings.Contains(err.Error(), tc.errContains) {
				t.Errorf("expected error containing %q, got: %v", tc.errContains, err)
			}
		})
	}
}

func TestNodeImportService_RejectsOversizedUI(t *testing.T) {
	oversized := make([]byte, (10<<20)+1)
	for i := range oversized {
		oversized[i] = 'a'
	}
	tmpDir, cleanup := writeUITestPackage(t, `{
  "name": "ui-oversized-node",
  "language": "python",
  "entry": "main.py",
  "parameters": [],
  "ui": {"entry": "ui/node-widget.js"}
}`, oversized)
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	importSvc := NewNodeImportService(NewNodeService(database, event.NewBus()))
	_, err = importSvc.ImportFromFolder(tmpDir)
	if err == nil || !strings.Contains(err.Error(), "10MB") {
		t.Errorf("expected 10MB size limit error, got: %v", err)
	}
}
