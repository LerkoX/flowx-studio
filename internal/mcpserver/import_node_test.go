package mcpserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/service"
)

func newTestServer(t *testing.T) *Server {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	bus := event.NewBus()
	nodeSvc := service.NewNodeService(database, bus)
	nodeImportSvc := service.NewNodeImportService(nodeSvc)
	return New(nil, nodeSvc, nodeImportSvc)
}

func TestImportNodeFromFolder(t *testing.T) {
	s := newTestServer(t)

	dir := t.TempDir()
	flowxJSON := `{
  "name": "hello-world",
  "displayName": "Hello World",
  "version": "1.0.0",
  "language": "python",
  "entry": "main.py",
  "parameters": [
    {"name": "name", "type": "string", "description": "name to greet", "required": true}
  ],
  "outputs": [
    {"name": "greeting", "type": "string", "description": "greeting text"}
  ]
}`
	if err := os.WriteFile(filepath.Join(dir, "flowx.json"), []byte(flowxJSON), 0644); err != nil {
		t.Fatalf("failed to write flowx.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.py"), []byte(`print("hello")`), 0644); err != nil {
		t.Fatalf("failed to write main.py: %v", err)
	}

	params, _ := json.Marshal(map[string]string{
		"source_type": "folder",
		"source_path": dir,
	})

	text, isErr := s.importNode(params)
	if isErr {
		t.Fatalf("importNode returned error: %s", text)
	}

	if !strings.Contains(text, `"id"`) || !strings.Contains(text, `"hello-world"`) {
		t.Fatalf("unexpected response: %s", text)
	}
}

func TestImportNodeInvalidSourceType(t *testing.T) {
	s := newTestServer(t)

	params, _ := json.Marshal(map[string]string{
		"source_type": "image",
		"source_url":  "python:3.11",
	})
	text, isErr := s.importNode(params)
	if !isErr {
		t.Fatalf("expected error, got: %s", text)
	}
	if !strings.Contains(text, "source_type must be git or folder") {
		t.Fatalf("unexpected error message: %s", text)
	}
}

func TestImportNodeMissingFolderPath(t *testing.T) {
	s := newTestServer(t)

	params, _ := json.Marshal(map[string]string{
		"source_type": "folder",
	})
	text, isErr := s.importNode(params)
	if !isErr {
		t.Fatalf("expected error, got: %s", text)
	}
	if !strings.Contains(text, "source_path is required") {
		t.Fatalf("unexpected error message: %s", text)
	}
}

func TestImportNodeMissingGitURL(t *testing.T) {
	s := newTestServer(t)

	params, _ := json.Marshal(map[string]string{
		"source_type": "git",
	})
	text, isErr := s.importNode(params)
	if !isErr {
		t.Fatalf("expected error, got: %s", text)
	}
	if !strings.Contains(text, "source_url is required") {
		t.Fatalf("unexpected error message: %s", text)
	}
}

func TestImportNodeInvalidFlowxJSON(t *testing.T) {
	s := newTestServer(t)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "flowx.json"), []byte(`{invalid json`), 0644); err != nil {
		t.Fatalf("failed to write flowx.json: %v", err)
	}

	params, _ := json.Marshal(map[string]string{
		"source_type": "folder",
		"source_path": dir,
	})

	text, isErr := s.importNode(params)
	if !isErr {
		t.Fatalf("expected error for invalid flowx.json, got: %s", text)
	}
	if !strings.Contains(text, "Failed to import node") {
		t.Fatalf("unexpected error message: %s", text)
	}
}
