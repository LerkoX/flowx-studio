package runtime

import (
	"fmt"
	"strconv"

	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// InjectRuntimeContext 向（展开后的）工作流 YAML 中每个节点注入运行时上下文环境变量：
//
//	FLOWX_EXECUTION_ID  执行实例 ID
//	FLOWX_NODE_ID       节点实例 ID（YAML Nodes 键，与执行事件的 node_id 一致）
//
// 对同一 execID 幂等：续跑重展开时注入相同值，不改变已物化节点（快照比对无 diff）。
//
// 注：实时预览不走 env 注入回调——节点经 stdout 的 FLOWX_PREVIEW 标记上报
// 预览帧地址（推理服务 HTTP 端点），Studio 从日志管道拦截后中转拉帧给画布，
// 媒体全程 HTTP 二进制，不经 base64，Studio 也无需对节点开放回调接口。
func InjectRuntimeContext(configYAML string, execID int64) (string, error) {
	var cfg core.WorkflowConfig
	if err := yaml.Unmarshal([]byte(configYAML), &cfg); err != nil {
		return "", fmt.Errorf("failed to parse workflow yaml: %w", err)
	}

	for nodeName, nodeCfg := range cfg.Nodes {
		config := nodeCfg.Config
		if config == nil {
			config = make(map[string]interface{})
		}
		env, _ := config["env"].(map[string]interface{})
		if env == nil {
			env = make(map[string]interface{})
		}
		env["FLOWX_EXECUTION_ID"] = strconv.FormatInt(execID, 10)
		env["FLOWX_NODE_ID"] = nodeName
		config["env"] = env
		nodeCfg.Config = config
		cfg.Nodes[nodeName] = nodeCfg
	}

	out, err := yaml.Marshal(&cfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal workflow yaml: %w", err)
	}
	return string(out), nil
}
