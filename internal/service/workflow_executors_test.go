package service

import (
	"path/filepath"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
)

// resolveExecutorsFixture 建一个带执行器注册表的最小环境：
// 一个 docker 实例 + 默认 local 实例 + 一个声明 preferredType=docker 的节点包。
func resolveExecutorsFixture(t *testing.T) (*WorkflowService, *db.DB) {
	t.Helper()
	database, err := db.New(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	nodeSvc := NewNodeService(database, event.NewBus())
	node := &model.Node{
		Name: "gen-image", Version: "1.0.0", NodeType: "code", Language: "python", Entry: "main.py",
		Code: "print('hi')\n",
	}
	if _, err := nodeSvc.Create(node); err != nil {
		t.Fatalf("create node: %v", err)
	}

	// 默认 local 执行器由初始迁移种下，无需创建
	execSvc := NewExecutorService(database, event.NewBus())
	if err := execSvc.Create(&model.Executor{
		Name: "docker-remote-211", Type: "docker",
		Config: map[string]interface{}{"host": "tcp://1.2.3.4:12268"},
	}); err != nil {
		t.Fatalf("create docker executor: %v", err)
	}

	svc := &WorkflowService{
		db:        database,
		nodeSvc:   nodeSvc,
		executors: execSvc,
		metaCache: map[int64]map[string]interface{}{},
	}
	// 种子流水线 id=1（description 显式空串：模型不允许 NULL）
	if _, err := database.Exec(
		`INSERT INTO workflows (name, description, intent, yaml_config) VALUES ('wf', '', '', 'Name: wf')`); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	return svc, database
}

// 编辑态：按当前定义实时解析，等价于运行链路；节点–执行器归属与来源都要有
func TestResolveNodeExecutors_WorkflowMode(t *testing.T) {
	svc, database := resolveExecutorsFixture(t)

	yamlConfig := `Name: wf
Graph: |
  stateDiagram-v2
    [*] --> DockerNode
    DockerNode --> LocalNode
    LocalNode --> [*]
Nodes:
  DockerNode:
    config:
      nodeRef: gen-image@1.0.0
      executor:
        type: docker
        ref: docker-remote-211
  LocalNode:
    config:
      nodeRef: gen-image@1.0.0
      executor: local
`
	if _, err := database.Exec(
		`UPDATE workflows SET yaml_config = ? WHERE id = 1`, yamlConfig); err != nil {
		t.Fatalf("update workflow yaml: %v", err)
	}

	result, err := svc.ResolveNodeExecutors(1, 0)
	if err != nil {
		t.Fatalf("ResolveNodeExecutors: %v", err)
	}
	if result.Source != "workflow" {
		t.Fatalf("source = %q, want workflow", result.Source)
	}

	if got := result.Executors["docker-remote-211"]; got.Type != "docker" || got.Host != "tcp://1.2.3.4:12268" {
		t.Fatalf("docker instance = %+v, want type/host", got)
	}
	if got := result.Executors["local"]; got.Type != "local" {
		t.Fatalf("local instance = %+v, want local", got)
	}

	dockerNode := result.Nodes["DockerNode"]
	if dockerNode.Executor != "docker-remote-211" || dockerNode.Type != "docker" {
		t.Fatalf("DockerNode = %+v, want docker-remote-211/docker", dockerNode)
	}
	localNode := result.Nodes["LocalNode"]
	if localNode.Executor != "local" || localNode.Type != "local" {
		t.Fatalf("LocalNode = %+v, want local/local", localNode)
	}
}

// 回放态：用执行快照（已物化 executor），不随后续流水线修改漂移
func TestResolveNodeExecutors_SnapshotMode(t *testing.T) {
	svc, database := resolveExecutorsFixture(t)

	snapshot := `Name: wf
Executors:
  docker-remote-211:
    type: docker
    config:
      host: tcp://9.9.9.9:12268
      image: repo/nodes:v1.0.0
  local:
    type: local
Graph: |
  stateDiagram-v2
    [*] --> A
Nodes:
  A:
    executor: docker-remote-211
    steps:
      - name: run
        run: echo hi
  B:
    steps:
      - name: run
        run: echo hi
`
	res, err := database.Exec(
		`INSERT INTO executions (workflow_id, status, runtime_yaml) VALUES (1, 'success', ?)`, snapshot)
	if err != nil {
		t.Fatalf("seed execution: %v", err)
	}
	execID, _ := res.LastInsertId()

	out, err := svc.ResolveNodeExecutors(1, execID)
	if err != nil {
		t.Fatalf("ResolveNodeExecutors(snapshot): %v", err)
	}
	if out.Source != "snapshot" {
		t.Fatalf("source = %q, want snapshot", out.Source)
	}
	if got := out.Nodes["A"]; got.Executor != "docker-remote-211" || got.Type != "docker" || got.Source != "snapshot" {
		t.Fatalf("node A = %+v, want snapshot docker-remote-211/docker", got)
	}
	if got := out.Executors["docker-remote-211"]; got.Host != "tcp://9.9.9.9:12268" || got.Image != "repo/nodes:v1.0.0" {
		t.Fatalf("snapshot instance = %+v, want host+image from snapshot", got)
	}
	// 快照未记录 executor 的节点：不猜，标记 unknown（前端显示"未知"而不是错标 local）
	if got := out.Nodes["B"]; got.Executor != "" || got.Source != "unknown" {
		t.Fatalf("node B = %+v, want empty executor/unknown source", got)
	}
}

// 执行不存在/无快照：返回错误而不是空结果（前端据此不显示徽章）
func TestResolveNodeExecutors_Errors(t *testing.T) {
	svc, database := resolveExecutorsFixture(t)
	if _, err := svc.ResolveNodeExecutors(1, 999); err == nil {
		t.Fatal("expected error for missing execution")
	}

	res, err := database.Exec(`INSERT INTO executions (workflow_id, status) VALUES (1, 'running')`)
	if err != nil {
		t.Fatalf("seed execution: %v", err)
	}
	execID, _ := res.LastInsertId()
	if _, err := svc.ResolveNodeExecutors(1, execID); err == nil {
		t.Fatal("expected error for execution without snapshot")
	}
	if _, err := svc.ResolveNodeExecutors(999, 0); err == nil {
		t.Fatal("expected error for missing workflow")
	}
}
