package service

import (
	"fmt"

	"github.com/LerkoX/flowx-studio/internal/runtime"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// 画布节点"执行器"标签的数据来源（只读，不影响运行）：
//
//	编辑态：用与 Run/Mock/Continue 完全相同的展开链路解析一遍（不执行），
//	        所以画布上显示的执行器 = 实际运行时用的执行器；
//	回放态：直接用执行快照 runtime_yaml（已物化 executor/Executors），
//	        不随后续流水线修改而漂移。
//
// 单独的 ExecutorResolutionResult 便于一次返回"实例表 + 每节点归属"。

// ExecutorInstanceInfo 展开结果里的一条执行器实例（Executors 表条目）
type ExecutorInstanceInfo struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Host  string `json:"host,omitempty"`  // docker 远端地址（快照/注册实例的 config.host）
	Image string `json:"image,omitempty"` // docker 镜像（config.image）
	// Registered 该实例名是否存在于执行器注册表。展开器在"节点声明镜像与共享实例不一致"
	// 时会按节点名合成节点专属条目（如 clip-text-encode-executor，且名字取决于 map 遍历
	// 顺序，逐次运行可能不同）——这类内部条目名不该当作执行器身份展示，徽章回退显示类型。
	Registered bool `json:"registered"`
}

// NodeExecutorInfo 单个节点的执行器归属与来源
type NodeExecutorInfo struct {
	Executor string `json:"executor"`          // 执行器实例名（Executors 的 key）；空表示快照未记录
	Type     string `json:"type"`              // local | docker | ...
	Source   string `json:"source,omitempty"`  // 解析来源（runtime.ExecutorSource*）；快照态为 "snapshot"
	Warning  string `json:"warning,omitempty"` // 降级/匿名实例等需要提示的情况
}

// ExecutorResolutionResult 画布执行器标签的响应体
type ExecutorResolutionResult struct {
	// Source: "workflow"（编辑态，按当前定义实时解析）| "snapshot"（回放态，执行快照）
	Source    string                          `json:"source"`
	Executors map[string]ExecutorInstanceInfo `json:"executors"`
	Nodes     map[string]NodeExecutorInfo     `json:"nodes"`
}

// ResolveNodeExecutors 解析某流水线（或某次执行快照）里每个节点最终跑在哪个执行器上。
// executionID > 0 时优先用该执行的运行时快照（回放态，与当时实际执行一致）。
func (s *WorkflowService) ResolveNodeExecutors(workflowID, executionID int64) (*ExecutorResolutionResult, error) {
	result := &ExecutorResolutionResult{
		Source:    "workflow",
		Executors: map[string]ExecutorInstanceInfo{},
		Nodes:     map[string]NodeExecutorInfo{},
	}

	var (
		configYAML string
		resolved   map[string]runtime.ExecutorResolution
	)

	if executionID > 0 {
		exec, err := s.GetExecution(executionID)
		if err != nil {
			return nil, err
		}
		if exec == nil {
			return nil, fmt.Errorf("execution %d not found", executionID)
		}
		if exec.RuntimeYAML == nil || *exec.RuntimeYAML == "" {
			return nil, fmt.Errorf("execution %d has no runtime snapshot", executionID)
		}
		configYAML = *exec.RuntimeYAML
		result.Source = "snapshot"
	} else {
		wf, err := s.Get(workflowID)
		if err != nil {
			return nil, err
		}
		if wf == nil {
			return nil, fmt.Errorf("workflow %d not found", workflowID)
		}
		// 与运行链路同一套解析（唯一事实源）；observer 只用于回传"为什么是这个执行器"
		resolved = map[string]runtime.ExecutorResolution{}
		expanded, err := runtime.ExpandWorkflowConfigWithExecutorObserver(
			wf.YAMLConfig, s.expandLookup, s.executorResolver(), s.executorTypeResolver(),
			func(nodeName string, res runtime.ExecutorResolution) { resolved[nodeName] = res },
		)
		if err != nil {
			return nil, err
		}
		configYAML = expanded
	}

	var cfg core.WorkflowConfig
	if err := yaml.Unmarshal([]byte(configYAML), &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config yaml: %w", err)
	}

	for name, exec := range cfg.Executors {
		info := ExecutorInstanceInfo{Name: name, Type: exec.Type}
		if s.executors != nil {
			if inst, err := s.executors.GetByName(name); err == nil && inst != nil {
				info.Registered = true
			}
		}
		if exec.Config != nil {
			if host, ok := exec.Config["host"].(string); ok {
				info.Host = host
			}
			if image, ok := exec.Config["image"].(string); ok {
				info.Image = image
			}
		}
		result.Executors[name] = info
	}

	for nodeID, nodeCfg := range cfg.Nodes {
		info := NodeExecutorInfo{Executor: nodeCfg.Executor}
		if info.Executor == "" {
			// 快照里未物化 executor（老快照/手工 YAML）：不猜，交给前端显示"未知"
			info.Source = "unknown"
			result.Nodes[nodeID] = info
			continue
		}
		if inst, ok := result.Executors[info.Executor]; ok {
			info.Type = inst.Type
		}
		if res, ok := resolved[nodeID]; ok {
			info.Source = res.Source
			info.Warning = res.Warning
		} else if result.Source == "snapshot" {
			info.Source = runtime.ExecutorSourceSnapshot
		}
		result.Nodes[nodeID] = info
	}

	return result, nil
}
