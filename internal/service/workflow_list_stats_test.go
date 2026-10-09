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

	resp, err := svc.List(ListFilter{}, 1, 50)
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

// 列表过滤：search 覆盖名称/备注/YAML 配置全文；node 精确匹配 nodeRef；
// exec_status 按最近一次执行状态过滤（never=从未运行，running 含 pending/paused）。
func TestListFilters(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()
	svc := &WorkflowService{db: database}

	seed := func(name, desc, yaml string) int64 {
		res, err := database.Exec(
			`INSERT INTO workflows (name, description, intent, yaml_config) VALUES (?, ?, '', ?)`,
			name, desc, yaml)
		if err != nil {
			t.Fatalf("seed workflow: %v", err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	exec := func(wfID int64, status string) {
		if _, err := database.Exec(
			`INSERT INTO executions (workflow_id, status) VALUES (?, ?)`, wfID, status); err != nil {
			t.Fatalf("seed execution: %v", err)
		}
	}

	wfFlux := seed("flux-txt2img", "FLUX 文生图", "nodeRef: flux-sampler@2.0.0")
	wfSD := seed("sd-txt2img", "SD1.5 文生图", "nodeRef: ksampler@1.0.0\nnodeRef: flux-sampler-xl@9.9.9")
	wfIdle := seed("never-ran", "", "nodeRef: ksampler@1.0.0")
	exec(wfFlux, "success")
	exec(wfSD, "success")
	exec(wfSD, "failed") // 最近一次 failed

	listIDs := func(f ListFilter) map[int64]bool {
		resp, err := svc.List(f, 1, 50)
		if err != nil {
			t.Fatalf("List %+v: %v", f, err)
		}
		out := map[int64]bool{}
		for _, it := range resp.Items.([]model.WorkflowListItem) {
			out[it.ID] = true
		}
		return out
	}

	// search 命中 YAML 配置文本
	if got := listIDs(ListFilter{Search: "flux-sampler@2.0.0"}); !got[wfFlux] || got[wfSD] {
		t.Fatalf("search yaml_config: %v", got)
	}
	// search 命中备注
	if got := listIDs(ListFilter{Search: "FLUX 文生图"}); !got[wfFlux] || len(got) != 1 {
		t.Fatalf("search description: %v", got)
	}
	// node 精确匹配：flux-sampler 不得误中 flux-sampler-xl
	if got := listIDs(ListFilter{Node: "flux-sampler"}); !got[wfFlux] || got[wfSD] {
		t.Fatalf("node exact: %v", got)
	}
	if got := listIDs(ListFilter{Node: "ksampler"}); !got[wfSD] || !got[wfIdle] || got[wfFlux] {
		t.Fatalf("node ksampler: %v", got)
	}
	// exec_status：最近一次执行状态
	if got := listIDs(ListFilter{ExecStatus: "failed"}); !got[wfSD] || len(got) != 1 {
		t.Fatalf("exec failed: %v", got)
	}
	if got := listIDs(ListFilter{ExecStatus: "success"}); !got[wfFlux] || len(got) != 1 {
		t.Fatalf("exec success: %v", got)
	}
	if got := listIDs(ListFilter{ExecStatus: "never"}); !got[wfIdle] || len(got) != 1 {
		t.Fatalf("exec never: %v", got)
	}
	if got := listIDs(ListFilter{ExecStatus: "running"}); len(got) != 0 {
		t.Fatalf("exec running: %v", got)
	}
	// 组合：node + exec_status
	if got := listIDs(ListFilter{Node: "ksampler", ExecStatus: "failed"}); !got[wfSD] || len(got) != 1 {
		t.Fatalf("combo: %v", got)
	}
}
