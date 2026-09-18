package runtime

import (
	"strings"
	"testing"

	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

const injectTestYAML = `Version: "1"
Name: demo
Nodes:
  Sampler:
    executor: local-executor
    steps:
      - name: run
        run: python3 main.py
    config:
      nodeRef: comfyui-sampler@1.0.0
      params:
        prompt: a cat
      env:
        FLOWX_PARAM_PROMPT: "{{ Param.prompt }}"
`

func TestInjectRuntimeContext_InjectsEnv(t *testing.T) {
	out, err := InjectRuntimeContext(injectTestYAML, 42)
	if err != nil {
		t.Fatalf("inject failed: %v", err)
	}

	var cfg core.WorkflowConfig
	if err := yaml.Unmarshal([]byte(out), &cfg); err != nil {
		t.Fatalf("output not parseable: %v", err)
	}
	node := cfg.Nodes["Sampler"]
	env, ok := node.Config["env"].(map[string]interface{})
	if !ok {
		t.Fatalf("env missing or wrong type: %#v", node.Config["env"])
	}

	// 原有 env 保留
	if env["FLOWX_PARAM_PROMPT"] != "{{ Param.prompt }}" {
		t.Errorf("existing env entry lost: %v", env["FLOWX_PARAM_PROMPT"])
	}
	if env["FLOWX_EXECUTION_ID"] != "42" {
		t.Errorf("FLOWX_EXECUTION_ID = %v, want 42", env["FLOWX_EXECUTION_ID"])
	}
	if env["FLOWX_NODE_ID"] != "Sampler" {
		t.Errorf("FLOWX_NODE_ID = %v, want Sampler", env["FLOWX_NODE_ID"])
	}
	// 预览回调注入已移除（预览改走 stdout 标记 + Studio 中转拉帧）
	for _, k := range []string{"FLOWX_CALLBACK_URL", "FLOWX_CALLBACK_URL_PUBLIC", "FLOWX_AUTH_TOKEN"} {
		if _, ok := env[k]; ok {
			t.Errorf("legacy callback env %s should not be injected", k)
		}
	}
	// 节点其他字段不受影响
	if node.Config["nodeRef"] != "comfyui-sampler@1.0.0" {
		t.Errorf("nodeRef changed: %v", node.Config["nodeRef"])
	}
	if len(node.Steps) != 1 || node.Steps[0].Run != "python3 main.py" {
		t.Errorf("steps changed: %+v", node.Steps)
	}
}

func TestInjectRuntimeContext_Idempotent(t *testing.T) {
	once, err := InjectRuntimeContext(injectTestYAML, 42)
	if err != nil {
		t.Fatalf("first inject failed: %v", err)
	}
	twice, err := InjectRuntimeContext(once, 42)
	if err != nil {
		t.Fatalf("second inject failed: %v", err)
	}
	var c1, c2 core.WorkflowConfig
	if err := yaml.Unmarshal([]byte(once), &c1); err != nil {
		t.Fatal(err)
	}
	if err := yaml.Unmarshal([]byte(twice), &c2); err != nil {
		t.Fatal(err)
	}
	env1 := c1.Nodes["Sampler"].Config["env"].(map[string]interface{})
	env2 := c2.Nodes["Sampler"].Config["env"].(map[string]interface{})
	if len(env1) != len(env2) {
		t.Errorf("not idempotent: %d keys after once, %d after twice", len(env1), len(env2))
	}
}

func TestInjectRuntimeContext_NodeWithoutConfig(t *testing.T) {
	yamlSrc := `Version: "1"
Name: demo
Nodes:
  Plain:
    executor: local-executor
    steps:
      - name: run
        run: echo hi
`
	out, err := InjectRuntimeContext(yamlSrc, 7)
	if err != nil {
		t.Fatalf("inject failed: %v", err)
	}
	if !strings.Contains(out, "FLOWX_EXECUTION_ID") || !strings.Contains(out, "FLOWX_NODE_ID") {
		t.Errorf("expected runtime context env injected for node without config")
	}
}
