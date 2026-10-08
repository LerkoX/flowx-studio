package service

import (
	"fmt"
	"time"
	"path/filepath"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
)

// TestResolveFinalStatusFromNodes 执行实例已从 runtime 删除（RunAsync 完成即删）
// 且事件桥也未落库终态时，按节点状态兜底判断的回归测试：
// 节点停留在 running/pending 属于异常终止（节点收尾事件丢失），
// 绝不能判为 success（执行 180 事故的根因）。
func TestResolveFinalStatusFromNodes(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	svc := &WorkflowService{db: database}

	if _, err := database.Exec(`INSERT INTO workflows (name, yaml_config) VALUES ('wf', 'Name: wf')`); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	seedExec := func(nodeStatuses ...string) int64 {
		res, err := database.Exec(`INSERT INTO executions (workflow_id, status) VALUES (1, 'running')`)
		if err != nil {
			t.Fatalf("seed execution: %v", err)
		}
		execID, _ := res.LastInsertId()
		for i, st := range nodeStatuses {
			if _, err := database.Exec(
				`INSERT INTO execution_nodes (execution_id, node_id, status) VALUES (?, ?, ?)`,
				execID, string(rune('A'+i)), st); err != nil {
				t.Fatalf("seed node: %v", err)
			}
		}
		return execID
	}

	cases := []struct {
		name        string
		nodes       []string
		wantStatus  string
		wantErrPart string
	}{
		{"all success", []string{"success", "success"}, "success", ""},
		{"any failed", []string{"success", "failed"}, "failed", ""},
		{"cancelled", []string{"success", "cancelled"}, "cancelled", ""},
		// 关键回归：实例已终结但节点仍 running → failed，不是 success
		{"stuck running is failure", []string{"running"}, "failed", "still running"},
		{"stuck pending is failure", []string{"success", "pending"}, "failed", "still pending"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			execID := seedExec(tc.nodes...)
			status, errMsg := svc.resolveFinalStatusFromNodes(execID)
			if status != tc.wantStatus {
				t.Errorf("status = %q, want %q", status, tc.wantStatus)
			}
			if tc.wantErrPart != "" && !contains(errMsg, tc.wantErrPart) {
				t.Errorf("errMsg = %q, want containing %q", errMsg, tc.wantErrPart)
			}
		})
	}

	// 无节点记录
	emptyID := seedExec()
	if status, errMsg := svc.resolveFinalStatusFromNodes(emptyID); status != "failed" || errMsg == "" {
		t.Errorf("no nodes: status = %q errMsg = %q, want failed with message", status, errMsg)
	}
}

// TestPollWorkflowTerminal exec-550 假阳性事故回归：轮询循环读到终态后，
// RunAsync 的 defer 立刻删除实例，之后任何重读都只会拿到 err/空串。
// 因此终态必须在循环内捕获并返回；若出循环重读，FAILED 会被误判成 success。
func TestPollWorkflowTerminal(t *testing.T) {
	// 场景 1：实例先给出 FAILED，随后（模拟被删）只会 err——必须捕获到 FAILED
	calls := 0
	terminal, err := pollWorkflowTerminal(func() (string, error) {
		calls++
		if calls == 1 {
			return "RUNNING", nil
		}
		if calls == 2 {
			return "FAILED", nil
		}
		return "", fmt.Errorf("workflow not found") // 实例已删
	}, time.Millisecond)
	if err != nil || terminal != "FAILED" {
		t.Errorf("terminal = %q err = %v, want FAILED nil", terminal, err)
	}

	// 场景 2：从未读到终态实例就消失（竞态跑输）——返回 err，交给事件桥/节点兜底
	terminal, err = pollWorkflowTerminal(func() (string, error) {
		return "", fmt.Errorf("workflow not found")
	}, time.Millisecond)
	if err == nil || terminal != "" {
		t.Errorf("terminal = %q err = %v, want empty + error", terminal, err)
	}

	// 场景 3：正常成功路径
	calls = 0
	terminal, err = pollWorkflowTerminal(func() (string, error) {
		calls++
		if calls < 3 {
			return "RUNNING", nil
		}
		return "SUCCESS", nil
	}, time.Millisecond)
	if err != nil || terminal != "SUCCESS" {
		t.Errorf("terminal = %q err = %v, want SUCCESS nil", terminal, err)
	}
}
