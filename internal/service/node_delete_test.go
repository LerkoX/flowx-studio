package service

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
)

func setupDeleteEnv(t *testing.T) *NodeService {
	t.Helper()
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return NewNodeService(database, event.NewBus())
}

func createTestNode(t *testing.T, svc *NodeService, name string) int64 {
	t.Helper()
	node, err := svc.Create(&model.Node{
		Name:     name,
		NodeType: "code",
		Language: "python",
		Code:     "print('hello')",
		Entry:    "main.py",
	})
	if err != nil {
		t.Fatalf("failed to create node %s: %v", name, err)
	}
	return node.ID
}

func createTestWorkflow(t *testing.T, svc *NodeService, name, yaml string) {
	t.Helper()
	_, err := svc.db.Exec(
		"INSERT INTO workflows (name, yaml_config, status) VALUES (?, ?, 'draft')", name, yaml)
	if err != nil {
		t.Fatalf("failed to insert workflow %s: %v", name, err)
	}
}

const refWorkflowYAML = `Version: "1.0"
Name: demo
Graph: a
Nodes:
  a:
    executor: default
    config:
      nodeRef: ref-node
`

func TestDeleteNodeReferencedBlocked(t *testing.T) {
	svc := setupDeleteEnv(t)
	id := createTestNode(t, svc, "ref-node")
	createTestWorkflow(t, svc, "wf-1", refWorkflowYAML)
	createTestWorkflow(t, svc, "wf-2", refWorkflowYAML)

	err := svc.Delete(id)
	if !errors.Is(err, ErrNodeReferenced) {
		t.Fatalf("expected ErrNodeReferenced, got %v", err)
	}
	if !strings.Contains(err.Error(), "wf-1") || !strings.Contains(err.Error(), "wf-2") {
		t.Fatalf("error should list referencing workflows, got %v", err)
	}

	// 节点未被删除
	if _, getErr := svc.Get(id); getErr != nil {
		t.Fatalf("node should still exist: %v", getErr)
	}
}

func TestDeleteNodeUnreferencedAllowed(t *testing.T) {
	svc := setupDeleteEnv(t)
	id := createTestNode(t, svc, "free-node")
	createTestWorkflow(t, svc, "wf-1", refWorkflowYAML) // 引用的是 ref-node，与 free-node 无关

	if err := svc.Delete(id); err != nil {
		t.Fatalf("expected delete to succeed, got %v", err)
	}
	if _, getErr := svc.Get(id); getErr == nil {
		t.Fatal("node should be deleted")
	}
}

func TestDeleteNodeNameInCommentNotBlocked(t *testing.T) {
	svc := setupDeleteEnv(t)
	id := createTestNode(t, svc, "commented-node")
	// 节点名仅出现在描述性字段中，并非 nodeRef 引用
	createTestWorkflow(t, svc, "wf-comment", `Version: "1.0"
Name: demo
Graph: a
Nodes:
  a:
    executor: default
    name: uses commented-node inline
    steps: []
`)

	if err := svc.Delete(id); err != nil {
		t.Fatalf("expected delete to succeed, got %v", err)
	}
}

func TestDeleteNodeInvalidWorkflowYAMLIgnored(t *testing.T) {
	svc := setupDeleteEnv(t)
	id := createTestNode(t, svc, "bad-yaml-node")
	createTestWorkflow(t, svc, "wf-bad", ":::not valid yaml:::")

	if err := svc.Delete(id); err != nil {
		t.Fatalf("expected delete to succeed, got %v", err)
	}
}
