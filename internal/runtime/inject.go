package runtime

import (
	"fmt"
	"net/url"
	"strconv"

	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// InjectRuntimeContext 向（展开后的）工作流 YAML 中每个节点注入运行时上下文环境变量：
//
//	FLOWX_EXECUTION_ID  执行实例 ID
//	FLOWX_NODE_ID       节点实例 ID（YAML Nodes 键，与执行事件的 node_id 一致）
//	FLOWX_CALLBACK_URL        节点实时预览回调地址（按执行器类型选择，见下）
//	FLOWX_CALLBACK_URL_PUBLIC 预览回调的公网/LAN 可达地址（恒为 callbackBase）：
//	                          节点自身不推送、需把回调地址转发给远程服务
//	                          （如 ksampler 透传给推理服务）时使用
//	FLOWX_AUTH_TOKEN          回调认证 token（server 启用本地 token 认证时需要）
//
// 节点脚本可借此在执行中途向 Studio 推送实时预览（如 KSampler 采样逐帧图像）。
// 对同一 execID 幂等：续跑重展开时注入相同值，不改变已物化节点（快照比对无 diff）。
// callbackBase 为空时原样返回（无 server 的纯展开场景，如 Mock 校验）。
//
// FLOWX_CALLBACK_URL 按执行器类型选择：local 执行器与 server 同机，用 loopbackBase
//（127.0.0.1:port，避免 http_base 配为局域网 IP 时本机不可达导致回调卡死）；
// docker/k8s 等容器执行器用 callbackBase（执行器网络可达地址，同资产签名 URL）。
func InjectRuntimeContext(configYAML string, execID int64, callbackBase, loopbackBase, token string) (string, error) {
	if callbackBase == "" {
		return configYAML, nil
	}

	var cfg core.WorkflowConfig
	if err := yaml.Unmarshal([]byte(configYAML), &cfg); err != nil {
		return "", fmt.Errorf("failed to parse workflow yaml: %w", err)
	}

	for nodeName, nodeCfg := range cfg.Nodes {
		base := callbackBase
		if loopbackBase != "" {
			if execCfg, ok := cfg.Executors[nodeCfg.Executor]; ok && execCfg.Type == "local" {
				base = loopbackBase
			}
		}
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
		env["FLOWX_CALLBACK_URL"] = fmt.Sprintf("%s/api/v1/executions/%d/nodes/%s/preview",
			base, execID, url.PathEscape(nodeName))
		env["FLOWX_CALLBACK_URL_PUBLIC"] = fmt.Sprintf("%s/api/v1/executions/%d/nodes/%s/preview",
			callbackBase, execID, url.PathEscape(nodeName))
		if token != "" {
			env["FLOWX_AUTH_TOKEN"] = token
		}
		config["env"] = env
		nodeCfg.Config = config
		cfg.Nodes[nodeName] = nodeCfg
	}

	out, err := yaml.Marshal(cfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal workflow yaml: %w", err)
	}
	return string(out), nil
}
