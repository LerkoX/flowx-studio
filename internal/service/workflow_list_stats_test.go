package service

import (
	"path/filepath"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
)

// List 返回的执行统计：卡片需要运行中/成功/失败次数，统计必须与 executions 表一致，
// 且无执行记录的 workflow 保持 nil（前端显示 0 而不是报错）。
func TestListIncludesExecutionStats(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	svc := &WorkflowService{db: database}

	seedWorkflow := func(name string) int64 {
		res, err := database.Exec(
			`INSERT INTO workflows (name, description, intent, yaml_config) VALUES (?, '', '', 'Name: x')`, name)
		if err != nil {
			t.Fatalf("seed workflow: %v", err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	seedExec := func(workflowID int64, status string) {
		if _, err := database.Exec(
			`INSERT INTO executions (workflow_id, status) VALUES (?, ?)`, workflowID, status); err != nil {
			t.Fatalf("seed execution: %v", err)
		}
	}

	wfA := seedWorkflow("a")
	wfB := seedWorkflow("b")
	seedWorkflow("c") // 无执行记录

	seedExec(wfA, "success")
	seedExec(wfA, "success")
	seedExec(wfA, "failed")
	seedExec(wfA, "running")
	seedExec(wfA, "paused")
	seedExec(wfA, "cancelled")

	seedExec(wfB, "failed")

	resp, err := svc.List("", "", 1, 50)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	items, ok := resp.Items.([]model.WorkflowListItem)
	if !ok {
		t.Fatalf("items type = %T, want []model.WorkflowListItem", resp.Items)
	}
	if len(items) != 3 {
		t.Fatalf("items = %d, want 3", len(items))
	}

	byID := make(map[int64]model.WorkflowListItem, len(items))
	for _, it := range items {
		byID[it.ID] = it
	}

	a := byID[wfA]
	if a.Stats == nil {
		t.Fatalf("workflow %d stats is nil", wfA)
	}
	want := model.WorkflowStats{Total: 6, Running: 2, Success: 2, Failed: 1, Cancelled: 1}
	if *a.Stats != want {
		t.Errorf("workflow A stats = %+v, want %+v", *a.Stats, want)
	}

	b := byID[wfB]
	if b.Stats == nil {
		t.Fatalf("workflow %d stats is nil", wfB)
	}
	if wantB := (model.WorkflowStats{Total: 1, Failed: 1}); *b.Stats != wantB {
		t.Errorf("workflow B stats = %+v, want %+v", *b.Stats, wantB)
	}

	if c := byID[wfA+2]; c.Stats != nil {
		t.Errorf("workflow C stats = %+v, want nil", *c.Stats)
	}
}
