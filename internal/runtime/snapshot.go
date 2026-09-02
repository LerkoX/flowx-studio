package runtime

import (
	"gopkg.in/yaml.v3"
)

// StripRuntimeSections 剥离快照 YAML 中各节点的 runtime 状态段（状态/时间戳/执行器实例信息）。
// 这些段对前端渲染图结构是噪音（约占快照体积 1/3），且属于易变运行态；
// 节点定义（steps/extract/config.nodeRef）与 Graph 原样保留。
// 解析失败时原样返回，不阻断调用方。
func StripRuntimeSections(snapshotYAML string) string {
	var doc map[string]interface{}
	if err := yaml.Unmarshal([]byte(snapshotYAML), &doc); err != nil {
		return snapshotYAML
	}
	nodes, ok := doc["Nodes"].(map[string]interface{})
	if !ok {
		return snapshotYAML
	}
	for _, nodeVal := range nodes {
		if nodeObj, ok := nodeVal.(map[string]interface{}); ok {
			delete(nodeObj, "runtime")
		}
	}
	out, err := yaml.Marshal(doc)
	if err != nil {
		return snapshotYAML
	}
	return string(out)
}
