package service

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/runtime"
)

// TestRun_PersistsInitialSnapshot 回归：运行中的执行必须已有初始运行时快照。
// 事故：快照此前仅在执行完成/暂停时导出——运行中选中该执行时前端拿不到快照，
// 回放画布回退用流水线模板渲染，模板编辑（加节点）会漏进运行中执行的回放画面，
// 执行完成后快照落库又把新节点"刷掉"。启动即冻结图后，回放自始至终渲染快照。
func TestRun_PersistsInitialSnapshot(t *testing.T) {
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	yamlConfig := `Name: t
Graph: |
  stateDiagram-v2
  [*] --> A
  A --> [*]
Nodes:
  A:
    executor: local-shell
    steps:
      - name: run
        run: sleep 1
Executors:
  local-shell:
    type: local
    config:
      shell: bash
`
	if _, err := database.Exec("INSERT INTO workflows (id, name, description, intent, yaml_config) VALUES (1, 't', '', '', ?)", yamlConfig); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}

	rt := runtime.NewAdapter()
	defer rt.Stop()
	svc := NewWorkflowService(database, rt, event.NewBus(), nil)

	execID, _, err := svc.Run(1, nil, false)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	// 快照在 ExecuteWorkflow 之前落库：节点 sleep 1s 提供了充裕的运行中窗口。
	// 轮询等待 goroutine 写入，且读到时执行必须仍处于 running（否则窗口失效）
	var snap string
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if y, err := svc.GetExecutionYAML(execID); err == nil && y != "" {
			snap = y
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if snap == "" {
		t.Fatal("运行中 GetExecutionYAML 应返回初始快照（修复前此处报「无快照」）")
	}
	var status string
	if err := database.Get(&status, "SELECT status FROM executions WHERE id = ?", execID); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "running" {
		t.Fatalf("读到快照时执行状态 = %q，测试窗口失效（应为 running）", status)
	}
	if !strings.Contains(snap, "A:") {
		t.Errorf("初始快照应包含节点定义 A，got: %.200s", snap)
	}
}
