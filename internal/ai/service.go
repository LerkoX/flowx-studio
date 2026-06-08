package ai

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Service AI 服务
type Service struct {
	getConfig func() (string, string, string, string, error) // provider, apiKey, baseURL, model
}

// NewService 创建 AI 服务
func NewService(getConfig func() (string, string, string, string, error)) *Service {
	return &Service{getConfig: getConfig}
}

// ChatStream 流式对话
func (s *Service) ChatStream(ctx context.Context, messages []Message, onChunk func(ChatChunk)) error {
	provider, apiKey, baseURL, model, err := s.getConfig()
	if err != nil {
		return fmt.Errorf("failed to get AI config: %w", err)
	}

	req := ChatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: 0.7,
		MaxTokens:   4096,
		APIKey:      apiKey,
		BaseURL:     baseURL,
	}

	var p Provider
	switch provider {
	case "openai", "custom":
		p = NewOpenAIProvider(apiKey, baseURL, model)
	case "anthropic":
		p = NewAnthropicProvider(apiKey, baseURL, model)
	case "ollama":
		p = NewOllamaProvider(baseURL, model)
	default:
		return fmt.Errorf("unsupported provider: %s", provider)
	}

	return p.ChatStream(ctx, req, onChunk)
}

// GenerateNodePrompt 生成节点 Prompt
func (s *Service) GenerateNodePrompt(description, language, preferredName string, existingNodes []string) string {
	var b strings.Builder
	b.WriteString("你是一个 FlowX 节点开发专家。FlowX 是一个工作流引擎，节点是可复用的执行单元。\n\n")
	b.WriteString("## 任务\n根据用户描述，生成一个符合 FlowX 规范的节点。\n\n")
	b.WriteString("## 节点规范\n")
	b.WriteString("1. **输入**：节点通过环境变量接收参数，参数名使用大写+下划线格式，如 `URL`、`TIMEOUT`\n")
	b.WriteString("2. **输出**：节点将结果输出到 stdout，使用 JSON 格式\n")
	b.WriteString("3. **错误**：错误信息输出到 stderr，进程 exit code 非 0\n")
	b.WriteString("4. **语言**：支持 Python、Go、Bash 等\n\n")
	b.WriteString("## 输出格式\n")
	b.WriteString("必须以 JSON 格式返回，包含以下字段：\n")
	b.WriteString("- name: 节点名称（蛇形命名，如 image_downloader）\n")
	b.WriteString("- description: 节点描述\n")
	b.WriteString("- language: 编程语言\n")
	b.WriteString("- parameters: 参数列表，每个参数包含 name, type, description, required, default\n")
	b.WriteString("- code: 完整实现代码\n")
	b.WriteString("- mock_code: Mock 测试代码（不依赖外部服务，返回模拟数据）\n\n")

	if len(existingNodes) > 0 {
		b.WriteString("## 已有节点\n")
		for _, n := range existingNodes {
			b.WriteString(fmt.Sprintf("- %s\n", n))
		}
		b.WriteString("\n")
	}

	b.WriteString(fmt.Sprintf("## 用户需求\n%s\n\n", description))
	if language != "" {
		b.WriteString(fmt.Sprintf("## 偏好语言\n%s\n\n", language))
	}
	if preferredName != "" {
		b.WriteString(fmt.Sprintf("## 偏好名称\n%s\n\n", preferredName))
	}

	b.WriteString("请生成节点：")
	return b.String()
}

// GenerateWorkflowPrompt 生成工作流 Prompt
func (s *Service) GenerateWorkflowPrompt(description string, availableNodes []string) string {
	var b strings.Builder
	b.WriteString("你是一个工作流编排专家。FlowX 使用 YAML 配置定义工作流，图结构使用 Mermaid stateDiagram-v2 语法。\n\n")
	b.WriteString("## 可用节点\n")
	for _, n := range availableNodes {
		b.WriteString(fmt.Sprintf("- %s\n", n))
	}
	b.WriteString("\n")
	b.WriteString(fmt.Sprintf("## 用户需求\n%s\n\n", description))
	b.WriteString("## 输出要求\n")
	b.WriteString("1. 生成完整的 FlowX YAML 配置\n")
	b.WriteString("2. 如果现有节点不够用，列出需要新建的节点\n")
	b.WriteString("3. 图结构必须正确，使用 Mermaid stateDiagram-v2 语法\n")
	b.WriteString("4. 节点配置必须引用正确的参数\n\n")
	b.WriteString("## YAML 结构示例\n```yaml\n")
	b.WriteString("name: workflow_name\nversion: \"1.0\"\ngraph: |\n")
	b.WriteString("  stateDiagram-v2\n    [*] --> node1\n    node1 --> node2\n    node2 --> [*]\n")
	b.WriteString("nodes:\n  node1:\n    steps:\n      - name: step1\n")
	b.WriteString("        executor: local\n        commands:\n          - python {{.node.code}}\n```\n\n")
	b.WriteString("请生成工作流配置：")
	return b.String()
}

// RetryWithBackoff 带指数退避的重试
func RetryWithBackoff(maxRetries int, fn func() error) error {
	var lastErr error
	for i := 0; i <= maxRetries; i++ {
		if err := fn(); err != nil {
			lastErr = err
			if i < maxRetries {
				delay := time.Duration(1<<i) * time.Second
				if delay > 30*time.Second {
					delay = 30 * time.Second
				}
				time.Sleep(delay)
			}
			continue
		}
		return nil
	}
	return fmt.Errorf("max retries exceeded: %w", lastErr)
}
