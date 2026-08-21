package validator

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
)

// 节点字段约束
var (
	nodeNamePattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]*$`)
	// supportedLanguages 与 sandbox.Executor 支持的语言保持一致
	supportedLanguages = map[string]bool{
		"python": true, "go": true, "bash": true, "sh": true,
		"javascript": true, "js": true, "node": true,
		"typescript": true, "ts": true, "ruby": true, "php": true,
	}
	paramTypes = map[string]bool{
		"string": true, "integer": true, "float": true,
		"boolean": true, "array": true, "object": true,
	}
)

// ValidateNode 校验节点创建/更新请求的字段合法性（类型/长度/范围）。
func ValidateNode(n *model.Node) error {
	name := strings.TrimSpace(n.Name)
	if name == "" {
		return fmt.Errorf("name is required")
	}
	if len(name) > 64 {
		return fmt.Errorf("name must be at most 64 characters")
	}
	if !nodeNamePattern.MatchString(name) {
		return fmt.Errorf("name must start with a letter and contain only letters, digits, '_' or '-'")
	}

	if n.NodeType != "" && n.NodeType != "code" && n.NodeType != "image" {
		return fmt.Errorf("nodeType must be code or image")
	}

	if n.DisplayName != "" && len([]rune(n.DisplayName)) > 128 {
		return fmt.Errorf("displayName must be at most 128 characters")
	}
	if len([]rune(n.Description)) > 1024 {
		return fmt.Errorf("description must be at most 1024 characters")
	}

	if n.NodeType != "image" {
		if n.Language == "" {
			return fmt.Errorf("language is required for code nodes")
		}
		if !supportedLanguages[strings.ToLower(n.Language)] {
			return fmt.Errorf("unsupported language: %s", n.Language)
		}
	}

	seen := make(map[string]bool, len(n.Parameters))
	for i, p := range n.Parameters {
		if strings.TrimSpace(p.Name) == "" {
			return fmt.Errorf("parameters[%d]: name is required", i)
		}
		if seen[p.Name] {
			return fmt.Errorf("parameters[%d]: duplicate parameter name %q", i, p.Name)
		}
		seen[p.Name] = true
		if p.Type != "" && !paramTypes[p.Type] {
			return fmt.Errorf("parameters[%d]: unsupported type %q (string/integer/float/boolean/array/object)", i, p.Type)
		}
	}

	for i, t := range n.Tags {
		if len(t) > 32 {
			return fmt.Errorf("tags[%d] must be at most 32 characters", i)
		}
	}

	return nil
}
