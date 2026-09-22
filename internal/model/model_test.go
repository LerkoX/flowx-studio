package model

import (
	"strings"
	"testing"
)

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

func TestDeriveExecutorPortableDeclaration(t *testing.T) {
	n := &Node{PackageConfig: &NodePackage{Name: "portable",
		Executor: NodeExecutorConfig{SupportedTypes: []string{"local", "docker"}, PreferredType: "docker"}}}
	n.DeriveExecutor()
	if n.Executor == nil {
		t.Fatal("Executor = nil, want portable declaration")
	}
	if n.Executor.PreferredType != "docker" || len(n.Executor.SupportedTypes) != 2 {
		t.Errorf("Executor = %+v, want supportedTypes/local,docker preferred docker", n.Executor)
	}
}

// 执行器声明一致性护栏：与仓库侧 check-bundle.py 同源（那边以 Dockerfile 为准，
// 这里只能做声明自洽检查）。三类真实事故都要能被指出来。
func TestNodeCheckExecutorContract(t *testing.T) {
	cases := []struct {
		name       string
		pkg        *NodePackage
		wantNil    bool
		wantDockOK bool
		wantIssue  string // 期望 issues 里包含的子串（空=无 issue）
	}{
		{
			name: "声明 docker 且 image+bundled 齐备 → dockerOk",
			pkg: &NodePackage{
				Image: "repo/nodes:v1.6.0",
				Executor: NodeExecutorConfig{
					SupportedTypes: []string{"local", "docker"},
					PreferredType:  "docker",
					Bundled:        true,
				},
			},
			wantDockOK: true,
		},
		{
			name: "声明 docker 但无 image 无 bundled（exec 363 事故）",
			pkg: &NodePackage{
				Executor: NodeExecutorConfig{
					SupportedTypes: []string{"local", "docker"},
					PreferredType:  "local",
				},
			},
			wantIssue: "既未声明 image 也未声明 executor.bundled",
		},
		{
			name: "声明 docker 且 bundled 但没有 image",
			pkg: &NodePackage{
				Executor: NodeExecutorConfig{
					SupportedTypes: []string{"docker"},
					Bundled:        true,
				},
			},
			wantIssue: "未声明 image",
		},
		{
			name: "声明 docker 有 image 但没声明 bundled（镜像里可能没有该节点）",
			pkg: &NodePackage{
				Image:    "repo/nodes:v1.6.0",
				Executor: NodeExecutorConfig{SupportedTypes: []string{"docker"}},
			},
			wantIssue: "未声明 executor.bundled",
		},
		{
			name: "bundled 但 supportedTypes 不含 docker → 自相矛盾",
			pkg: &NodePackage{
				Image:    "repo/nodes:v1.6.0",
				Executor: NodeExecutorConfig{SupportedTypes: []string{"local"}, Bundled: true},
			},
			wantIssue: "supportedTypes 不含 docker",
		},
		{
			name: "preferredType 不在 supportedTypes 内",
			pkg: &NodePackage{
				Image: "repo/nodes:v1.6.0",
				Executor: NodeExecutorConfig{
					SupportedTypes: []string{"docker"}, PreferredType: "local", Bundled: true,
				},
			},
			wantDockOK: true,
			wantIssue:  "偏好不会生效",
		},
		{
			// 只声明 local：仍然回传检查结果（UI 可显示"仅本机"），但没有 issues
			name: "纯本地节点（无 image 无 bundled）→ 无 issues",
			pkg:  &NodePackage{Executor: NodeExecutorConfig{SupportedTypes: []string{"local"}, PreferredType: "local"}},
		},
		{
			name:    "完全未声明执行器 → 不产生检查结果",
			pkg:     &NodePackage{},
			wantNil: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			n := &Node{Name: tc.pkg.Name, PackageConfig: tc.pkg}
			n.DeriveExecutor()
			if tc.wantNil {
				if n.ExecutorCheck != nil {
					t.Fatalf("ExecutorCheck = %+v, want nil", n.ExecutorCheck)
				}
				return
			}
			if n.ExecutorCheck == nil {
				t.Fatal("ExecutorCheck = nil, want non-nil")
			}
			if n.ExecutorCheck.DockerOK != tc.wantDockOK {
				t.Errorf("DockerOK = %v, want %v", n.ExecutorCheck.DockerOK, tc.wantDockOK)
			}
			if tc.wantIssue == "" {
				if len(n.ExecutorCheck.Issues) != 0 {
					t.Errorf("Issues = %v, want empty", n.ExecutorCheck.Issues)
				}
				return
			}
			joined := strings.Join(n.ExecutorCheck.Issues, "; ")
			if !strings.Contains(joined, tc.wantIssue) {
				t.Errorf("Issues = %q, want contains %q", joined, tc.wantIssue)
			}
		})
	}
}
