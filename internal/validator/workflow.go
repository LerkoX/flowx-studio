package validator

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
	"gopkg.in/yaml.v3"
)

// WorkflowValidator 工作流 YAML 校验器
type WorkflowValidator struct{}

// NewWorkflowValidator 创建校验器
func NewWorkflowValidator() *WorkflowValidator {
	return &WorkflowValidator{}
}

// Validate 校验工作流 YAML
func (v *WorkflowValidator) Validate(cfg string) error {
	if strings.TrimSpace(cfg) == "" {
		return fmt.Errorf("yaml_config is empty")
	}

	var doc map[string]interface{}
	if err := yaml.Unmarshal([]byte(cfg), &doc); err != nil {
		return fmt.Errorf("failed to parse YAML: %w", err)
	}

	if err := v.requireString(doc, "Name"); err != nil {
		return err
	}

	nodes, ok := doc["Nodes"]
	if !ok {
		return fmt.Errorf("missing required field 'Nodes'")
	}
	nodeMap, ok := nodes.(map[string]interface{})
	if !ok {
		return fmt.Errorf("'Nodes' must be a map")
	}
	if len(nodeMap) == 0 {
		return fmt.Errorf("'Nodes' must not be empty")
	}

	graph, ok := doc["Graph"]
	if !ok {
		return fmt.Errorf("missing required field 'Graph'")
	}
	graphStr, ok := graph.(string)
	if !ok || strings.TrimSpace(graphStr) == "" {
		return fmt.Errorf("'Graph' must be a non-empty string")
	}
	if err := v.validateGraph(graphStr); err != nil {
		return err
	}

	if err := v.validateExecutors(doc, nodeMap); err != nil {
		return err
	}

	return nil
}

// ValidateWorkflow 校验工作流模型
func (v *WorkflowValidator) ValidateWorkflow(wf *model.Workflow) error {
	if strings.TrimSpace(wf.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if strings.TrimSpace(wf.YAMLConfig) == "" {
		return fmt.Errorf("yaml_config is required")
	}
	return v.Validate(wf.YAMLConfig)
}

func (v *WorkflowValidator) requireString(doc map[string]interface{}, key string) error {
	val, ok := doc[key]
	if !ok {
		return fmt.Errorf("missing required field '%s'", key)
	}
	str, ok := val.(string)
	if !ok || strings.TrimSpace(str) == "" {
		return fmt.Errorf("'%s' must be a non-empty string", key)
	}
	return nil
}

func (v *WorkflowValidator) validateGraph(graph string) error {
	lines := strings.Split(graph, "\n")
	foundHeader := false
	foundTransition := false

	transitionRegex := regexp.MustCompile(`^\s*(\[\*\]|[\w-]+)\s*-->\s*(\[\*\]|[\w-]+)`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "%%") {
			continue
		}
		if strings.HasPrefix(trimmed, "stateDiagram") {
			foundHeader = true
			continue
		}
		if transitionRegex.MatchString(line) {
			foundTransition = true
		}
	}

	if !foundHeader {
		return fmt.Errorf("'Graph' must start with 'stateDiagram-v2'")
	}
	if !foundTransition {
		return fmt.Errorf("'Graph' must contain at least one state transition (e.g. A --\u003e B)")
	}

	return nil
}

func (v *WorkflowValidator) validateExecutors(doc map[string]interface{}, nodeMap map[string]interface{}) error {
	executors, ok := doc["Executors"]
	if !ok {
		return nil // Executors optional? still validate referenced if present
	}
	execMap, ok := executors.(map[string]interface{})
	if !ok {
		return fmt.Errorf("'Executors' must be a map")
	}

	for nodeName, nodeVal := range nodeMap {
		nodeObj, ok := nodeVal.(map[string]interface{})
		if !ok {
			continue
		}
		execName, ok := nodeObj["executor"].(string)
		if !ok || execName == "" {
			return fmt.Errorf("node '%s' must have a non-empty 'executor'", nodeName)
		}
		if _, exists := execMap[execName]; !exists {
			return fmt.Errorf("node '%s' references undefined executor '%s'", nodeName, execName)
		}
	}

	return nil
}
