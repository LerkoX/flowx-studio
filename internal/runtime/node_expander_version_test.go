package runtime

import (
	"testing"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// 版本锁定引用：nodeRef 写 name@version 时 lookup 收到完整引用，
// 物化后的 config.nodeRef 记录精确版本（快照可还原）
func TestExpandWorkflowConfig_VersionedRef(t *testing.T) {
	node := &model.Node{
		Name:     "echo",
		Version:  "2.0.0",
		Language: "python",
		Code:     "print('hi')",
		Entry:    "main.py",
	}
	wfYAML := `Name: test-wf
Graph: |
  stateDiagram-v2
    [*] --> A
    A --> [*]
Nodes:
  A:
    config:
      nodeRef: echo@2.0.0
`
	var gotRef string
	out, err := ExpandWorkflowConfig(wfYAML, func(ref string) (*model.Node, error) {
		gotRef = ref
		return node, nil
	})
	if err != nil {
		t.Fatalf("ExpandWorkflowConfig() error = %v", err)
	}
	if gotRef != "echo@2.0.0" {
		t.Errorf("lookup should receive raw ref, got %q", gotRef)
	}

	var cfg core.PipelineConfig
	if err := yaml.Unmarshal([]byte(out), &cfg); err != nil {
		t.Fatalf("unmarshal expanded yaml: %v", err)
	}
	got := cfg.Nodes["A"].Config["nodeRef"]
	if got != "echo@2.0.0" {
		t.Errorf("materialized nodeRef = %v, want echo@2.0.0", got)
	}
}

// 无版本节点物化后归一记录 name@0
func TestExpandWorkflowConfig_MaterializedRefNormalizesEmptyVersion(t *testing.T) {
	node := &model.Node{
		Name:     "echo",
		Language: "python",
		Code:     "print('hi')",
		Entry:    "main.py",
	}
	cfg := expandWorkflow(t, node, nil)
	got := cfg.Nodes["A"].Config["nodeRef"]
	if got != "echo@0" {
		t.Errorf("materialized nodeRef = %v, want echo@0", got)
	}
}

// 非法引用格式直接报错
func TestExpandWorkflowConfig_InvalidRef(t *testing.T) {
	wfYAML := `Name: test-wf
Graph: |
  stateDiagram-v2
    [*] --> A
    A --> [*]
Nodes:
  A:
    config:
      nodeRef: "echo@1.0@extra"
`
	_, err := ExpandWorkflowConfig(wfYAML, func(ref string) (*model.Node, error) {
		return nil, nil
	})
	if err == nil {
		t.Fatal("expected error for invalid nodeRef")
	}
}
