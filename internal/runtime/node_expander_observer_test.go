package runtime

import (
	"testing"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// 画布执行器标签依赖的"解析来源"必须准确：同一个节点在不同环境下可能落到不同
// 分支，展示错了会让人以为执行器变了。
func TestExpandWorkflowConfigWithExecutorObserver(t *testing.T) {
	dockerInst := &model.Executor{
		Name: "docker-remote", Type: "docker",
		Config: map[string]interface{}{"host": "tcp://1.2.3.4:2375"},
	}
	localInst := &model.Executor{Name: "local", Type: "local"}
	// 默认执行器是 docker：未声明执行器但有镜像的节点应复用它（而非合成匿名实例）
	dockerDefault := &model.Executor{
		Name: "docker-default", Type: "docker", IsDefault: true,
		Config: map[string]interface{}{"host": "tcp://5.6.7.8:2375"},
	}
	resolve := staticResolver(map[string]*model.Executor{
		"docker-remote": dockerInst, "local": localInst, "docker-default": dockerDefault,
	}, dockerDefault)
	resolveType := func(execType string) (*model.Executor, error) {
		switch execType {
		case "docker":
			return dockerInst, nil
		case "local":
			return localInst, nil
		}
		return nil, nil
	}

	mkNode := func(name string, pkg *model.NodePackage) *model.Node {
		pkg.Name = name
		pkg.Language = "python"
		pkg.Entry = "main.py"
		return newTestNode(pkg)
	}
	nodes := map[string]*model.Node{
		// 1. 显式选择实例
		"explicit": mkNode("explicit", &model.NodePackage{
			Executor: model.NodeExecutorConfig{
				Ref:            "docker-remote",
				SupportedTypes: []string{"docker", "local"},
				PreferredType:  "docker",
			},
		}),
		// 2. 包内声明 executor.ref
		"pkgref": mkNode("pkgref", &model.NodePackage{
			Executor: model.NodeExecutorConfig{Ref: "local"},
		}),
		// 3. 包内声明 executor.type（内联匿名）
		"pkginline": mkNode("pkginline", &model.NodePackage{
			Executor: model.NodeExecutorConfig{Type: "docker"},
			Image:    "repo/nodes:v1.0.0",
		}),
		// 4. 偏好命中（preferred 有实例）
		"preferred": mkNode("preferred", &model.NodePackage{
			Executor: model.NodeExecutorConfig{
				SupportedTypes: []string{"docker", "local"},
				PreferredType:  "docker",
			},
		}),
		// 5. 偏好不可用 → 降级到次选
		"degraded": mkNode("degraded", &model.NodePackage{
			Executor: model.NodeExecutorConfig{
				SupportedTypes: []string{"k8s", "local"},
				PreferredType:  "k8s",
			},
		}),
		// 6. 未声明 + 有镜像 → docker 默认实例复用
		"imagedefault": mkNode("imagedefault", &model.NodePackage{Image: "repo/nodes:v1.0.0"}),
	}

	yamlText := `Name: obs
Graph: |
  stateDiagram-v2
    [*] --> explicit
Nodes:
  explicit:
    config:
      nodeRef: explicit
      executor:
        type: docker
        ref: docker-remote
  pkgref:
    config:
      nodeRef: pkgref
  pkginline:
    config:
      nodeRef: pkginline
  preferred:
    config:
      nodeRef: preferred
  degraded:
    config:
      nodeRef: degraded
  imagedefault:
    config:
      nodeRef: imagedefault
`
	got := map[string]ExecutorResolution{}
	out, err := ExpandWorkflowConfigWithExecutorObserver(
		yamlText,
		func(name string) (*model.Node, error) { return nodes[name], nil },
		resolve, resolveType,
		func(nodeName string, res ExecutorResolution) { got[nodeName] = res },
	)
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	if len(got) != len(nodes) {
		t.Fatalf("observer called for %d nodes, want %d (%v)", len(got), len(nodes), got)
	}

	cases := []struct {
		node    string
		source  string
		execTyp string
		warning bool
	}{
		{"explicit", ExecutorSourceWorkflowExplicit, "docker", false},
		{"pkgref", ExecutorSourcePackageRef, "local", false},
		{"pkginline", ExecutorSourcePackageInline, "docker", false},
		{"preferred", ExecutorSourcePackagePreferred, "docker", false},
		{"degraded", ExecutorSourcePackageDegraded, "local", true},
		{"imagedefault", ExecutorSourceDockerDefault, "docker", false},
	}
	for _, tc := range cases {
		res, ok := got[tc.node]
		if !ok {
			t.Fatalf("observer missing node %s", tc.node)
		}
		if res.Source != tc.source {
			t.Errorf("node %s source = %q, want %q", tc.node, res.Source, tc.source)
		}
		if res.Type != tc.execTyp {
			t.Errorf("node %s type = %q, want %q", tc.node, res.Type, tc.execTyp)
		}
		if (res.Warning != "") != tc.warning {
			t.Errorf("node %s warning = %q, want warning=%v", tc.node, res.Warning, tc.warning)
		}
	}

	// 展开结果本身不受观察者影响：节点与 Executors 表仍按原语义物化
	var cfg core.WorkflowConfig
	if err := yaml.Unmarshal([]byte(out), &cfg); err != nil {
		t.Fatalf("unmarshal expanded: %v", err)
	}
	if cfg.Nodes["explicit"].Executor == "" || cfg.Executors[cfg.Nodes["explicit"].Executor].Type != "docker" {
		t.Fatalf("explicit node executor not materialized: %+v", cfg.Nodes["explicit"])
	}
	if img, _ := cfg.Executors[cfg.Nodes["pkginline"].Executor].Config["image"].(string); img != "repo/nodes:v1.0.0" {
		t.Fatalf("inline docker image not injected: %v", cfg.Executors)
	}
}
