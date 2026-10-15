package service

import (
	"testing"
	"time"

	"github.com/LerkoX/flowx-studio/internal/runtime"
)

// TestExecutionCompleteKeepsCancelledStatus 回归（dev-log §58.8）：
// 用户取消后 CancelExecution 已落库 cancelled；被取消的节点以 SIGTERM(143) 退出，
// dag 的 execution_complete 事件会报 FAILED——事件处理器不得把它覆盖回 failed。
func TestExecutionCompleteKeepsCancelledStatus(t *testing.T) {
	svc := newCancelTestService(t, 101, "")
	if _, err := svc.db.Exec("UPDATE executions SET status = 'cancelled', completed_at = ? WHERE id = 101", time.Now()); err != nil {
		t.Fatalf("seed cancelled: %v", err)
	}

	svc.persistRuntimeEvent(runtime.ExecutionEvent{
		Type: "execution_complete", ExecutionID: 101, Status: "FAILED",
	})

	var status string
	if err := svc.db.Get(&status, "SELECT status FROM executions WHERE id = ?", 101); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "cancelled" {
		t.Fatalf("取消后的执行状态被覆盖：got %q, want %q", status, "cancelled")
	}
}

// TestExecutionCompleteWritesFailedWhenNotCancelled 对照：没取消过的执行照常落 failed
// （守卫只针对 cancelled，不得把真正的失败吞掉）。
func TestExecutionCompleteWritesFailedWhenNotCancelled(t *testing.T) {
	svc := newCancelTestService(t, 102, "")
	svc.persistRuntimeEvent(runtime.ExecutionEvent{
		Type: "execution_complete", ExecutionID: 102, Status: "FAILED",
	})

	var status string
	if err := svc.db.Get(&status, "SELECT status FROM executions WHERE id = ?", 102); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "failed" {
		t.Fatalf("非取消执行的状态错误：got %q, want %q", status, "failed")
	}
}
