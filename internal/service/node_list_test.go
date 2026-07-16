package service

import (
	"path/filepath"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
)

func TestNodeServiceList(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	bus := event.NewBus()
	nodeSvc := NewNodeService(database, bus)

	_, err = nodeSvc.Create(&model.Node{
		Name:     "test-node",
		NodeType: "code",
		Language: "python",
		Code:     "print('hello')",
		Entry:    "main.py",
		Parameters: []model.NodeParameter{
			{Name: "x", Type: "string", Description: "x", Required: true},
		},
	})
	if err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	resp, err := nodeSvc.List("", "", "", "", 1, 20)
	if err != nil {
		t.Fatalf("failed to list nodes: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("expected total 1, got %d", resp.Total)
	}
	items, ok := resp.Items.([]model.Node)
	if !ok {
		t.Fatalf("expected []model.Node, got %T", resp.Items)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Name != "test-node" {
		t.Fatalf("expected test-node, got %s", items[0].Name)
	}
}
