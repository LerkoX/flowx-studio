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
