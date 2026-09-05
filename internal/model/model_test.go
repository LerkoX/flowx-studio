package model

import "testing"

func TestDeriveExecutor(t *testing.T) {
	tests := []struct {
		name     string
		node     *Node
		wantNil  bool
		wantRef  string
		wantType string
	}{
		{
			name:    "无包配置",
			node:    &Node{},
			wantNil: true,
		},
		{
			name:    "包未声明 executor",
			node:    &Node{PackageConfig: &NodePackage{Name: "a"}},
			wantNil: true,
		},
		{
			name: "内联 type",
			node: &Node{PackageConfig: &NodePackage{Name: "a",
				Executor: NodeExecutorConfig{Type: "local"}}},
			wantType: "local",
		},
		{
			name: "ref 引用实例",
			node: &Node{PackageConfig: &NodePackage{Name: "a",
				Executor: NodeExecutorConfig{Ref: "docker-gpu"}}},
			wantRef: "docker-gpu",
		},
		{
			name: "仅 config 也透出",
			node: &Node{PackageConfig: &NodePackage{Name: "a",
				Executor: NodeExecutorConfig{Config: map[string]interface{}{"shell": "bash"}}}},
			wantType: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.node.DeriveExecutor()
			if tt.wantNil {
				if tt.node.Executor != nil {
					t.Fatalf("Executor = %+v, want nil", tt.node.Executor)
				}
				return
			}
			if tt.node.Executor == nil {
				t.Fatal("Executor = nil, want non-nil")
			}
			if tt.node.Executor.Ref != tt.wantRef {
				t.Errorf("Ref = %q, want %q", tt.node.Executor.Ref, tt.wantRef)
			}
			if tt.node.Executor.Type != tt.wantType {
				t.Errorf("Type = %q, want %q", tt.node.Executor.Type, tt.wantType)
			}
		})
	}

	// 重复调用幂等（先透出后清空场景）
	n := &Node{PackageConfig: &NodePackage{Name: "a",
		Executor: NodeExecutorConfig{Type: "local"}}}
	n.DeriveExecutor()
	n.PackageConfig.Executor = NodeExecutorConfig{}
	n.DeriveExecutor()
	if n.Executor != nil {
		t.Errorf("re-derive after clearing should reset Executor to nil, got %+v", n.Executor)
	}
}
