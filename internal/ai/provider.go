package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Provider AI 提供商接口
type Provider interface {
	Name() string
	ChatStream(ctx context.Context, req ChatRequest, onChunk func(ChatChunk)) error
	HealthCheck(ctx context.Context) error
}

// ChatRequest 聊天请求
type ChatRequest struct {
	Model       string
	Messages    []Message
	Temperature float64
	MaxTokens   int
	APIKey      string
	BaseURL     string
}

// Message 消息
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatChunk 流式响应块
type ChatChunk struct {
	Content string
	Done    bool
	Error   error
}

// BaseProvider 基础提供商
type BaseProvider struct {
	client  *http.Client
	apiKey  string
	baseURL string
	model   string
}

func newBaseProvider(apiKey, baseURL, model string) BaseProvider {
	return BaseProvider{
		client:  &http.Client{Timeout: 120 * time.Second},
		apiKey:  apiKey,
		baseURL: baseURL,
		model:   model,
	}
}

// OpenAIProvider OpenAI 兼容提供商（支持 OpenAI、Ollama、Custom）
type OpenAIProvider struct {
	BaseProvider
}

// NewOpenAIProvider 创建 OpenAI 提供商
func NewOpenAIProvider(apiKey, baseURL, model string) *OpenAIProvider {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &OpenAIProvider{
		BaseProvider: newBaseProvider(apiKey, baseURL, model),
	}
}

// Name 返回提供商名称
func (p *OpenAIProvider) Name() string {
	return "openai"
}

// ChatStream 流式聊天
func (p *OpenAIProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(ChatChunk)) error {
	url := p.baseURL + "/chat/completions"

	messages := make([]map[string]string, len(req.Messages))
	for i, m := range req.Messages {
		messages[i] = map[string]string{
			"role":    m.Role,
			"content": m.Content,
		}
	}

	body := map[string]interface{}{
		"model":       req.Model,
		"messages":    messages,
		"stream":      true,
		"temperature": req.Temperature,
	}
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request failed: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return p.parseStream(resp.Body, onChunk)
}

func (p *OpenAIProvider) parseStream(reader io.Reader, onChunk func(ChatChunk)) error {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		if !bytes.HasPrefix([]byte(line), []byte("data: ")) {
			continue
		}

		data := line[6:] // 去掉 "data: "
		if data == "[DONE]" {
			onChunk(ChatChunk{Done: true})
			return nil
		}

		var event struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}

		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		if event.Error != nil {
			onChunk(ChatChunk{Error: fmt.Errorf("stream error: %s", event.Error.Message)})
			return nil
		}

		if len(event.Choices) > 0 {
			choice := event.Choices[0]
			if choice.FinishReason != "" {
				onChunk(ChatChunk{Done: true})
				return nil
			}
			if choice.Delta.Content != "" {
				onChunk(ChatChunk{Content: choice.Delta.Content})
			}
		}
	}

	return scanner.Err()
}

// HealthCheck 健康检查
func (p *OpenAIProvider) HealthCheck(ctx context.Context) error {
	url := p.baseURL + "/models"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed: %d", resp.StatusCode)
	}
	return nil
}

// AnthropicProvider Anthropic 提供商
type AnthropicProvider struct {
	BaseProvider
}

// NewAnthropicProvider 创建 Anthropic 提供商
func NewAnthropicProvider(apiKey, baseURL, model string) *AnthropicProvider {
	if baseURL == "" {
		baseURL = "https://api.anthropic.com/v1"
	}
	return &AnthropicProvider{
		BaseProvider: newBaseProvider(apiKey, baseURL, model),
	}
}

// Name 返回提供商名称
func (p *AnthropicProvider) Name() string {
	return "anthropic"
}

// ChatStream 流式聊天
func (p *AnthropicProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(ChatChunk)) error {
	url := p.baseURL + "/messages"

	// Anthropic 消息格式转换
	messages := make([]map[string]interface{}, 0)
	var systemPrompt string
	for _, m := range req.Messages {
		if m.Role == "system" {
			systemPrompt = m.Content
			continue
		}
		role := m.Role
		if role == "assistant" {
			role = "assistant"
		} else {
			role = "user"
		}
		messages = append(messages, map[string]interface{}{
			"role":    role,
			"content": m.Content,
		})
	}

	body := map[string]interface{}{
		"model":     req.Model,
		"messages":  messages,
		"stream":    true,
		"max_tokens": req.MaxTokens,
	}
	if systemPrompt != "" {
		body["system"] = systemPrompt
	}
	if req.Temperature > 0 {
		body["temperature"] = req.Temperature
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request failed: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", req.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return p.parseAnthropicStream(resp.Body, onChunk)
}

func (p *AnthropicProvider) parseAnthropicStream(reader io.Reader, onChunk func(ChatChunk)) error {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		if !bytes.HasPrefix([]byte(line), []byte("data: ")) {
			continue
		}

		data := line[6:]
		if data == "[DONE]" {
			onChunk(ChatChunk{Done: true})
			return nil
		}

		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Text string `json:"text"`
			} `json:"delta"`
			ContentBlock struct {
				Text string `json:"text"`
			} `json:"content_block"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}

		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		if event.Error != nil {
			onChunk(ChatChunk{Error: fmt.Errorf("stream error: %s", event.Error.Message)})
			return nil
		}

		switch event.Type {
		case "content_block_delta":
			if event.Delta.Text != "" {
				onChunk(ChatChunk{Content: event.Delta.Text})
			}
		case "message_stop":
			onChunk(ChatChunk{Done: true})
			return nil
		}
	}

	return scanner.Err()
}

// HealthCheck 健康检查
func (p *AnthropicProvider) HealthCheck(ctx context.Context) error {
	// Anthropic 没有直接的模型列表 API，用简单的请求验证
	req := ChatRequest{
		Model:    p.model,
		APIKey:   p.apiKey,
		BaseURL:  p.baseURL,
		Messages: []Message{{Role: "user", Content: "Hi"}},
		MaxTokens: 1,
	}
	
	err := p.ChatStream(ctx, req, func(chunk ChatChunk) {
		// 忽略响应，只检查是否成功
	})
	return err
}

// OllamaProvider Ollama 本地提供商
type OllamaProvider struct {
	BaseProvider
}

// NewOllamaProvider 创建 Ollama 提供商
func NewOllamaProvider(baseURL, model string) *OllamaProvider {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	return &OllamaProvider{
		BaseProvider: newBaseProvider("", baseURL, model),
	}
}

// Name 返回提供商名称
func (p *OllamaProvider) Name() string {
	return "ollama"
}

// ChatStream 流式聊天
func (p *OllamaProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(ChatChunk)) error {
	url := p.baseURL + "/api/chat"

	messages := make([]map[string]string, len(req.Messages))
	for i, m := range req.Messages {
		messages[i] = map[string]string{
			"role":    m.Role,
			"content": m.Content,
		}
	}

	body := map[string]interface{}{
		"model":    req.Model,
		"messages": messages,
		"stream":   true,
	}
	if req.Temperature > 0 {
		body["options"] = map[string]interface{}{
			"temperature": req.Temperature,
		}
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request failed: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return err
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return p.parseOllamaStream(resp.Body, onChunk)
}

func (p *OllamaProvider) parseOllamaStream(reader io.Reader, onChunk func(ChatChunk)) error {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var event struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Done  bool   `json:"done"`
			Error string `json:"error"`
		}

		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		if event.Error != "" {
			onChunk(ChatChunk{Error: fmt.Errorf("stream error: %s", event.Error)})
			return nil
		}

		if event.Message.Content != "" {
			onChunk(ChatChunk{Content: event.Message.Content})
		}

		if event.Done {
			onChunk(ChatChunk{Done: true})
			return nil
		}
	}

	return scanner.Err()
}

// HealthCheck 健康检查
func (p *OllamaProvider) HealthCheck(ctx context.Context) error {
	url := p.baseURL + "/api/tags"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed: %d", resp.StatusCode)
	}
	return nil
}
