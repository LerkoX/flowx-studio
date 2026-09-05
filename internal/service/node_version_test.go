package service

import (
	"errors"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/model"
)

func createVersionedTestNode(t *testing.T, svc *NodeService, name, version string) int64 {
	t.Helper()
	node, err := svc.Create(&model.Node{
		Name:     name,
		Version:  version,
		NodeType: "code",
		Language: "python",
		Code:     "print('hello')",
		Entry:    "main.py",
	})
	if err != nil {
		t.Fatalf("failed to create node %s@%s: %v", name, version, err)
	}
	return node.ID
}

// GetByRef：精确版本匹配；裸名称解析到最新版本（数值比较 1.10.0 > 1.9.0）
func TestGetByRefLatestVersion(t *testing.T) {
	svc := setupDeleteEnv(t)
	createVersionedTestNode(t, svc, "multi", "1.9.0")
	latestID := createVersionedTestNode(t, svc, "multi", "1.10.0")
	createVersionedTestNode(t, svc, "multi", "1.2.0")

	exact, err := svc.GetByRef("multi", "1.2.0")
	if err != nil || exact == nil || exact.Version != "1.2.0" {
		t.Fatalf("GetByRef exact = %+v, err=%v", exact, err)
	}

	latest, err := svc.GetByRef("multi", "")
	if err != nil || latest == nil {
		t.Fatalf("GetByRef latest err=%v", err)
	}
	if latest.ID != latestID {
		t.Errorf("bare ref should resolve to 1.10.0 (id=%d), got id=%d version=%s",
			latestID, latest.ID, latest.Version)
	}

	missing, err := svc.GetByRef("multi", "9.9.9")
	if err != nil || missing != nil {
		t.Errorf("missing version should return (nil, nil), got %+v, %v", missing, err)
	}
	if n, err := svc.GetByRef("ghost", ""); err != nil || n != nil {
		t.Errorf("missing name should return (nil, nil), got %+v, %v", n, err)
	}
}

// 删除保护：name@version 精确引用只挡删该版本
func TestDeleteVersionedRefBlocksOnlyThatVersion(t *testing.T) {
	svc := setupDeleteEnv(t)
	v1 := createVersionedTestNode(t, svc, "pinned", "1.0.0")
	v2 := createVersionedTestNode(t, svc, "pinned", "2.0.0")
	createTestWorkflow(t, svc, "wf-pinned", `Version: "1.0"
Name: demo
Graph: a
Nodes:
  a:
    executor: default
    config:
      nodeRef: pinned@1.0.0
`)

	// v2 未被引用，可删
	if err := svc.Delete(v2); err != nil {
		t.Fatalf("v2 (unreferenced) delete should succeed, got %v", err)
	}
	// v1 被精确引用，挡删
	if err := svc.Delete(v1); !errors.Is(err, ErrNodeReferenced) {
		t.Fatalf("v1 delete expected ErrNodeReferenced, got %v", err)
	}
}

// 删除保护：裸名称引用挡删其当前解析到的版本（最新版），旧版本放行
func TestDeleteBareRefBlocksResolvedLatest(t *testing.T) {
	svc := setupDeleteEnv(t)
	v1 := createVersionedTestNode(t, svc, "bare", "1.0.0")
	v2 := createVersionedTestNode(t, svc, "bare", "2.0.0")
	createTestWorkflow(t, svc, "wf-bare", `Version: "1.0"
Name: demo
Graph: a
Nodes:
  a:
    executor: default
    config:
      nodeRef: bare
`)

	// 裸引用解析到最新版 v2 → 挡删 v2
	if err := svc.Delete(v2); !errors.Is(err, ErrNodeReferenced) {
		t.Fatalf("v2 (bare-ref target) delete expected ErrNodeReferenced, got %v", err)
	}
	// 旧版本 v1 放行
	if err := svc.Delete(v1); err != nil {
		t.Fatalf("v1 (stale version) delete should succeed, got %v", err)
	}
	// v1 删除后裸引用解析到 v2（仍被挡删）
	if err := svc.Delete(v2); !errors.Is(err, ErrNodeReferenced) {
		t.Fatalf("v2 should still be blocked, got %v", err)
	}
}
