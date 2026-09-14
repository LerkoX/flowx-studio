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
	out, err := InjectRuntimeContext(injectTestYAML, 42, "http://192.168.1.10:8080", "http://127.0.0.1:8080", "tok123")
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
	// 测试 YAML 未声明 Executors（无法判定 local），用 callbackBase
	wantURL := "http://192.168.1.10:8080/api/v1/executions/42/nodes/Sampler/preview"
	if env["FLOWX_CALLBACK_URL"] != wantURL {
		t.Errorf("FLOWX_CALLBACK_URL = %v, want %s", env["FLOWX_CALLBACK_URL"], wantURL)
	}
	if env["FLOWX_AUTH_TOKEN"] != "tok123" {
		t.Errorf("FLOWX_AUTH_TOKEN = %v, want tok123", env["FLOWX_AUTH_TOKEN"])
	}
	// PUBLIC 地址恒为 callbackBase（供节点转发给远程服务）
	if env["FLOWX_CALLBACK_URL_PUBLIC"] != wantURL {
		t.Errorf("FLOWX_CALLBACK_URL_PUBLIC = %v, want %s", env["FLOWX_CALLBACK_URL_PUBLIC"], wantURL)
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
	once, err := InjectRuntimeContext(injectTestYAML, 42, "http://192.168.1.10:8080", "http://127.0.0.1:8080", "tok123")
	if err != nil {
		t.Fatalf("first inject failed: %v", err)
	}
	twice, err := InjectRuntimeContext(once, 42, "http://192.168.1.10:8080", "http://127.0.0.1:8080", "tok123")
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

func TestInjectRuntimeContext_EmptyBasePassthrough(t *testing.T) {
	out, err := InjectRuntimeContext(injectTestYAML, 42, "", "", "tok123")
	if err != nil {
		t.Fatalf("inject failed: %v", err)
	}
	if out != injectTestYAML {
		t.Errorf("expected passthrough when callbackBase empty")
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
	out, err := InjectRuntimeContext(yamlSrc, 7, "http://127.0.0.1:8080", "", "")
	if err != nil {
		t.Fatalf("inject failed: %v", err)
	}
	if !strings.Contains(out, "FLOWX_CALLBACK_URL") {
		t.Errorf("expected callback env injected for node without config")
	}
	// token 为空时不注入 FLOWX_AUTH_TOKEN
	if strings.Contains(out, "FLOWX_AUTH_TOKEN") {
		t.Errorf("FLOWX_AUTH_TOKEN should be omitted when token empty")
	}
}

func TestInjectRuntimeContext_LocalExecutorUsesLoopback(t *testing.T) {
	yamlSrc := `Version: "1"
Name: demo
Executors:
  local:
    type: local
  gpu:
    type: docker
Nodes:
  LocalNode:
    executor: local
    steps:
      - name: run
        run: echo hi
  DockerNode:
    executor: gpu
    steps:
      - name: run
        run: echo hi
`
	out, err := InjectRuntimeContext(yamlSrc, 9, "http://192.168.1.10:8080", "http://127.0.0.1:8080", "tok")
	if err != nil {
		t.Fatalf("inject failed: %v", err)
	}
	var cfg core.WorkflowConfig
	if err := yaml.Unmarshal([]byte(out), &cfg); err != nil {
		t.Fatal(err)
	}
	localEnv := cfg.Nodes["LocalNode"].Config["env"].(map[string]interface{})
	dockerEnv := cfg.Nodes["DockerNode"].Config["env"].(map[string]interface{})
	wantLocal := "http://127.0.0.1:8080/api/v1/executions/9/nodes/LocalNode/preview"
	if localEnv["FLOWX_CALLBACK_URL"] != wantLocal {
		t.Errorf("local node callback = %v, want %s", localEnv["FLOWX_CALLBACK_URL"], wantLocal)
	}
	wantDocker := "http://192.168.1.10:8080/api/v1/executions/9/nodes/DockerNode/preview"
	if dockerEnv["FLOWX_CALLBACK_URL"] != wantDocker {
		t.Errorf("docker node callback = %v, want %s", dockerEnv["FLOWX_CALLBACK_URL"], wantDocker)
	}
	// local 节点的 PUBLIC 地址仍是 callbackBase（LAN 地址，供转发远程服务用）
	if localEnv["FLOWX_CALLBACK_URL_PUBLIC"] != "http://192.168.1.10:8080/api/v1/executions/9/nodes/LocalNode/preview" {
		t.Errorf("local node PUBLIC callback = %v", localEnv["FLOWX_CALLBACK_URL_PUBLIC"])
	}
}
