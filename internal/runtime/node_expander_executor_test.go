package runtime

import (
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// expandWorkflow 测试辅助：展开单节点工作流并返回解析后的配置
func expandWorkflow(t *testing.T, node *model.Node, resolve ExecutorResolver) *core.PipelineConfig {
	t.Helper()
	wfYAML := `Name: test-wf
Graph: |
  stateDiagram-v2
    [*] --> A
    A --> [*]
Nodes:
  A:
    config:
      nodeRef: ` + node.Name + `
`
	out, err := ExpandWorkflowConfig(wfYAML, func(name string) (*model.Node, error) {
		if name == node.Name {
			return node, nil
		}
		return nil, nil
	}, resolve)
	if err != nil {
		t.Fatalf("ExpandWorkflowConfig() error = %v", err)
	}
	var cfg core.PipelineConfig
	if err := yaml.Unmarshal([]byte(out), &cfg); err != nil {
		t.Fatalf("unmarshal expanded yaml: %v", err)
	}
	return &cfg
}

// staticResolver 返回固定实例表的测试 resolver
func staticResolver(instances map[string]*model.Executor, def *model.Executor) ExecutorResolver {
	return func(ref string, useDefault bool) (*model.Executor, error) {
		if ref != "" {
			if e, ok := instances[ref]; ok {
				return e, nil
			}
			return nil, &testNotFoundError{ref}
		}
		if useDefault {
			return def, nil
		}
		return nil, nil
	}
}

type testNotFoundError struct{ ref string }

func (e *testNotFoundError) Error() string { return "executor " + e.ref + " not found" }

func TestExpandWorkflow_ExecutorRef(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "train",
		Language: "python",
		Entry:    "main.py",
		Executor: model.NodeExecutorConfig{Ref: "docker-gpu"},
	})
	inst := &model.Executor{
		Name:        "docker-gpu",
		Type:        "docker",
		Description: "GPU 节点",
		Config:      map[string]interface{}{"host": "tcp://10.0.0.8:2375"},
	}
	cfg := expandWorkflow(t, node, staticResolver(map[string]*model.Executor{"docker-gpu": inst}, nil))

	execName := cfg.Nodes["A"].Executor
	if execName != "docker-gpu" {
		t.Errorf("node executor = %q, want docker-gpu", execName)
	}
	ec, ok := cfg.Executors["docker-gpu"]
	if !ok {
		t.Fatal("Executors[docker-gpu] missing")
	}
	if ec.Type != "docker" || ec.Config["host"] != "tcp://10.0.0.8:2375" {
		t.Errorf("executor config mismatch: %+v", ec)
	}
	if ec.Description != "GPU 节点" {
		t.Errorf("description = %q, want %q", ec.Description, "GPU 节点")
	}
}

func TestExpandWorkflow_ExecutorRefNotFound(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "train",
		Language: "python",
		Entry:    "main.py",
		Executor: model.NodeExecutorConfig{Ref: "missing"},
	})
	wfYAML := `Name: wf
Graph: |
  stateDiagram-v2
    [*] --> A
Nodes:
  A:
    config: {nodeRef: train}
`
	_, err := ExpandWorkflowConfig(wfYAML, func(name string) (*model.Node, error) { return node, nil },
		staticResolver(nil, nil))
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %v, want ref-not-found", err)
	}
}

func TestExpandWorkflow_ExecutorRefWithoutRegistry(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "train",
		Language: "python",
		Entry:    "main.py",
		Executor: model.NodeExecutorConfig{Ref: "docker-gpu"},
	})
	wfYAML := `Name: wf
Graph: |
  stateDiagram-v2
    [*] --> A
Nodes:
  A:
    config: {nodeRef: train}
`
	// 无 resolver（未挂执行器注册表）→ 明确报错而非静默忽略
	_, err := ExpandWorkflowConfig(wfYAML, func(name string) (*model.Node, error) { return node, nil })
	if err == nil || !strings.Contains(err.Error(), "no executor registry") {
		t.Errorf("error = %v, want registry-missing error", err)
	}
}

func TestExpandWorkflow_InlineExecutorUnchanged(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "build",
		Language: "go",
		Entry:    "main.go",
		Executor: model.NodeExecutorConfig{
			Type:   "docker",
			Config: map[string]interface{}{"network": "host"},
		},
	})
	cfg := expandWorkflow(t, node, nil)

	execName := cfg.Nodes["A"].Executor
	if execName != "build-executor" {
		t.Errorf("node executor = %q, want build-executor", execName)
	}
	ec := cfg.Executors["build-executor"]
	if ec.Type != "docker" || ec.Config["network"] != "host" {
		t.Errorf("inline executor mismatch: %+v", ec)
	}
}

func TestExpandWorkflow_DefaultExecutor(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "notify",
		Language: "bash",
		Entry:    "run.sh",
	})
	def := &model.Executor{Name: "local", Type: "local", IsDefault: true,
		Config: map[string]interface{}{"shell": "bash"}}
	cfg := expandWorkflow(t, node, staticResolver(nil, def))

	execName := cfg.Nodes["A"].Executor
	if execName != "local" {
		t.Errorf("node executor = %q, want local (default)", execName)
	}
	if cfg.Executors["local"].Config["shell"] != "bash" {
		t.Errorf("default executor config not propagated: %+v", cfg.Executors["local"])
	}
}

func TestExpandWorkflow_ImageNodeFallsToDocker(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "compress",
		Language: "python",
		Entry:    "main.py",
		Image:    "python:3.11-slim",
	})
	// 默认执行器是 local → image 节点仍应归为匿名 docker 实例
	def := &model.Executor{Name: "local", Type: "local", IsDefault: true}
	cfg := expandWorkflow(t, node, staticResolver(nil, def))

	execName := cfg.Nodes["A"].Executor
	if execName != "compress-executor" {
		t.Errorf("node executor = %q, want compress-executor", execName)
	}
	ec := cfg.Executors["compress-executor"]
	if ec.Type != "docker" {
		t.Errorf("executor type = %q, want docker", ec.Type)
	}
	// 节点镜像注入执行器条目 config.image，供 docker 执行器消费
	if ec.Config["image"] != "python:3.11-slim" {
		t.Errorf("executor config.image = %v, want python:3.11-slim", ec.Config["image"])
	}
}

func TestExpandWorkflow_ImageNodeInheritsDockerDefault(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "compress",
		Language: "python",
		Entry:    "main.py",
		Image:    "python:3.11-slim",
	})
	// 默认执行器是远程 docker 且未配置镜像 → 继承 host 合成节点专属条目
	//（executor 按名单例，镜像必须落在条目 config 上，不能改共享实例）
	def := &model.Executor{Name: "docker-remote", Type: "docker", IsDefault: true,
		Config: map[string]interface{}{"host": "tcp://192.168.1.10:2375"}}
	cfg := expandWorkflow(t, node, staticResolver(nil, def))

	if cfg.Nodes["A"].Executor != "compress-executor" {
		t.Errorf("node executor = %q, want compress-executor", cfg.Nodes["A"].Executor)
	}
	ec := cfg.Executors["compress-executor"]
	if ec.Config["host"] != "tcp://192.168.1.10:2375" {
		t.Errorf("docker default host not inherited: %+v", ec.Config)
	}
	if ec.Config["image"] != "python:3.11-slim" {
		t.Errorf("executor config.image = %v, want python:3.11-slim", ec.Config["image"])
	}
	if _, ok := cfg.Executors["docker-remote"]; ok {
		t.Error("shared docker-remote entry should not be written when image differs")
	}
}

func TestExpandWorkflow_ImageNodeReusesDockerDefault(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "compress",
		Language: "python",
		Entry:    "main.py",
		Image:    "python:3.11-slim",
	})
	// 默认 docker 实例配置的镜像与节点一致 → 直接复用实例条目
	def := &model.Executor{Name: "docker-remote", Type: "docker", IsDefault: true,
		Config: map[string]interface{}{"host": "tcp://192.168.1.10:2375", "image": "python:3.11-slim"}}
	cfg := expandWorkflow(t, node, staticResolver(nil, def))

	if cfg.Nodes["A"].Executor != "docker-remote" {
		t.Errorf("node executor = %q, want docker-remote", cfg.Nodes["A"].Executor)
	}
	if cfg.Executors["docker-remote"].Config["host"] != "tcp://192.168.1.10:2375" {
		t.Errorf("docker default config not propagated: %+v", cfg.Executors["docker-remote"])
	}
}

func TestExpandWorkflow_RefInstanceImageOverride(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "train",
		Language: "python",
		Entry:    "main.py",
		Image:    "pytorch:2.1-cuda",
		Executor: model.NodeExecutorConfig{Ref: "docker-gpu"},
	})
	// ref 实例未配置镜像、节点自带镜像 → 复制实例配置（host）合成节点专属条目
	inst := &model.Executor{Name: "docker-gpu", Type: "docker",
		Config: map[string]interface{}{"host": "tcp://10.0.0.8:2375"}}
	cfg := expandWorkflow(t, node, staticResolver(map[string]*model.Executor{"docker-gpu": inst}, nil))

	if cfg.Nodes["A"].Executor != "train-executor" {
		t.Errorf("node executor = %q, want train-executor", cfg.Nodes["A"].Executor)
	}
	ec := cfg.Executors["train-executor"]
	if ec.Config["host"] != "tcp://10.0.0.8:2375" {
		t.Errorf("ref instance host not inherited: %+v", ec.Config)
	}
	if ec.Config["image"] != "pytorch:2.1-cuda" {
		t.Errorf("executor config.image = %v, want pytorch:2.1-cuda", ec.Config["image"])
	}
	// 实例配置不被修改
	if _, ok := inst.Config["image"]; ok {
		t.Error("shared instance config mutated")
	}
}

func TestExpandWorkflow_RefInstanceImageMatch(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "train",
		Language: "python",
		Entry:    "main.py",
		Image:    "pytorch:2.1-cuda",
		Executor: model.NodeExecutorConfig{Ref: "docker-gpu"},
	})
	// ref 实例镜像与节点一致 → 直接复用实例条目（多节点可共享）
	inst := &model.Executor{Name: "docker-gpu", Type: "docker",
		Config: map[string]interface{}{"image": "pytorch:2.1-cuda"}}
	cfg := expandWorkflow(t, node, staticResolver(map[string]*model.Executor{"docker-gpu": inst}, nil))

	if cfg.Nodes["A"].Executor != "docker-gpu" {
		t.Errorf("node executor = %q, want docker-gpu", cfg.Nodes["A"].Executor)
	}
}

func TestExpandWorkflow_InlineDockerImageInjection(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "compress",
		Language: "python",
		Entry:    "main.py",
		Image:    "python:3.11-slim",
		Executor: model.NodeExecutorConfig{Type: "docker", Config: map[string]interface{}{"network": "host"}},
	})
	// 内联 docker 执行器：节点 image 注入条目 config
	cfg := expandWorkflow(t, node, staticResolver(nil, nil))

	ec := cfg.Executors["compress-executor"]
	if ec.Config["image"] != "python:3.11-slim" {
		t.Errorf("executor config.image = %v, want python:3.11-slim", ec.Config["image"])
	}
	if ec.Config["network"] != "host" {
		t.Errorf("inline config lost: %+v", ec.Config)
	}
}

func TestExpandWorkflow_LocalExecutorIgnoresImage(t *testing.T) {
	node := newTestNode(&model.NodePackage{
		Name:     "compress",
		Language: "python",
		Entry:    "main.py",
		Image:    "python:3.11-slim", // 仅作 docker 能力声明
		Executor: model.NodeExecutorConfig{Type: "local"},
	})
	// local 执行器不注入 image（镜像只是元信息）
	cfg := expandWorkflow(t, node, staticResolver(nil, nil))

	ec := cfg.Executors["compress-executor"]
	if ec.Type != "local" {
		t.Errorf("executor type = %q, want local", ec.Type)
	}
	if _, ok := ec.Config["image"]; ok {
		t.Errorf("local executor should not carry image: %+v", ec.Config)
	}
}

func TestExpandWorkflow_SharedRefInstanceAcrossNodes(t *testing.T) {
	pkgA := &model.NodePackage{Name: "node-a", Language: "python", Entry: "a.py",
		Executor: model.NodeExecutorConfig{Ref: "docker-gpu"}}
	pkgB := &model.NodePackage{Name: "node-b", Language: "python", Entry: "b.py",
		Executor: model.NodeExecutorConfig{Ref: "docker-gpu"}}
	nodes := map[string]*model.Node{"node-a": newTestNode(pkgA), "node-b": newTestNode(pkgB)}

	wfYAML := `Name: wf
Graph: |
  stateDiagram-v2
    [*] --> A
    A --> B
Nodes:
  A:
    config: {nodeRef: node-a}
  B:
    config: {nodeRef: node-b}
`
	inst := &model.Executor{Name: "docker-gpu", Type: "docker"}
	out, err := ExpandWorkflowConfig(wfYAML, func(name string) (*model.Node, error) { return nodes[name], nil },
		staticResolver(map[string]*model.Executor{"docker-gpu": inst}, nil))
	if err != nil {
		t.Fatalf("ExpandWorkflowConfig() error = %v", err)
	}
	var cfg core.PipelineConfig
	if err := yaml.Unmarshal([]byte(out), &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cfg.Nodes["A"].Executor != "docker-gpu" || cfg.Nodes["B"].Executor != "docker-gpu" {
		t.Errorf("executors = %q/%q, want both docker-gpu", cfg.Nodes["A"].Executor, cfg.Nodes["B"].Executor)
	}
	// 共享实例在 Executors 中只出现一次
	if len(cfg.Executors) != 1 {
		t.Errorf("Executors has %d entries, want 1 shared entry", len(cfg.Executors))
	}
}
