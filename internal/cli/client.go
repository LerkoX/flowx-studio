// Package cli 实现 flowx-studio 的客户端子命令。
//
// 这些子命令是 `flowx-studio server` 的 HTTP 客户端，供 AI Agent（经 SKILL）
// 与终端用户调用。约定：
//   - 全局 flag：--server（或 FLOWX_STUDIO_SERVER_URL）、--json、--schema
//   - 退出码：0 成功；1 业务/校验失败（stderr 含错误详情与重试指引）；2 用法错误
package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 全局 flag 绑定的变量（由 AddGlobalFlags 注册）。
var (
	ServerURL  string
	JSONOutput bool
	ShowSchema bool
)

const defaultServerURL = "http://127.0.0.1:8080"

// baseURL 解析 server 地址：--server flag > FLOWX_STUDIO_SERVER_URL > 默认值。
func baseURL() string {
	if ServerURL != "" {
		return strings.TrimRight(ServerURL, "/")
	}
	if env := strings.TrimSpace(os.Getenv("FLOWX_STUDIO_SERVER_URL")); env != "" {
		return strings.TrimRight(env, "/")
	}
	return defaultServerURL
}

// apiResponse 与服务端 handler.Response 对应。
type apiResponse struct {
	Code    int             `json:"code"`
	Data    json.RawMessage `json:"data"`
	Message string          `json:"message"`
}

// httpClient 共享的 HTTP 客户端。
var httpClient = &http.Client{Timeout: 60 * time.Second}

// do 发起一次 API 调用，返回 data 字段。
// 网络错误与非 0 业务码都会转换为带上下文的 error。
func do(ctx context.Context, method, path string, query url.Values, body interface{}) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to encode request body: %w", err)
		}
		reader = bytes.NewReader(buf)
	}

	u := baseURL() + "/api/v1" + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, fmt.Errorf("failed to build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// 本地 token 认证：优先 FLOWX_STUDIO_AUTH_TOKEN，其次 <data-dir>/auth.token
	if tok := authToken(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cannot connect to server at %s: %w. Is `flowx-studio server` running?", baseURL(), err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var ar apiResponse
	if err := json.Unmarshal(raw, &ar); err != nil {
		return nil, fmt.Errorf("invalid response from server (HTTP %d): %s", resp.StatusCode, truncate(string(raw), 200))
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, &APIError{Status: resp.StatusCode, Message: "unauthorized: token mismatch. Check FLOWX_STUDIO_AUTH_TOKEN or <data-dir>/auth.token"}
	}
	if resp.StatusCode >= 400 || ar.Code >= 400 {
		return nil, &APIError{Status: resp.StatusCode, Message: ar.Message}
	}
	return ar.Data, nil
}

// APIError 表示服务端返回的业务错误。
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return e.Message }

// fail 构造面向 Agent 的业务错误。retryHint 为 true 时附加重试指引，
// 使「错误文本即重试指令」。
func fail(action string, err error, retryHint bool) error {
	if ae, ok := err.(*APIError); ok {
		if retryHint {
			return fmt.Errorf("failed to %s: %s. Please regenerate the YAML and retry.", action, ae.Message)
		}
		return fmt.Errorf("failed to %s: %s", action, ae.Message)
	}
	return err
}

// readFileOrStdin 读取文件内容；"-" 表示 stdin。
func readFileOrStdin(path string) ([]byte, error) {
	if path == "-" {
		return io.ReadAll(os.Stdin)
	}
	return os.ReadFile(path)
}

// printData 按 --json 或自定义回调输出结果。
func printData(data json.RawMessage, human func()) {
	if JSONOutput {
		var buf bytes.Buffer
		if err := json.Indent(&buf, data, "", "  "); err == nil {
			fmt.Println(buf.String())
			return
		}
		fmt.Println(string(data))
		return
	}
	human()
}

// printTable 输出简单对齐表格。
func printTable(headers []string, rows [][]string) {
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(h)
	}
	for _, row := range rows {
		for i, cell := range row {
			if i < len(widths) && len(cell) > widths[i] {
				widths[i] = len(cell)
			}
		}
	}
	line := func(cells []string) {
		parts := make([]string, len(headers))
		for i := range headers {
			cell := ""
			if i < len(cells) {
				cell = cells[i]
			}
			parts[i] = fmt.Sprintf("%-*s", widths[i], cell)
		}
		fmt.Println(strings.TrimRight(strings.Join(parts, "  "), " "))
	}
	line(headers)
	sep := make([]string, len(headers))
	for i, w := range widths {
		sep[i] = strings.Repeat("-", w)
	}
	line(sep)
	for _, row := range rows {
		line(row)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// authToken 解析认证 token：FLOWX_STUDIO_AUTH_TOKEN > <data-dir>/auth.token。
// 读取失败（如 server 未启动过、token 文件不存在）时返回空串，由服务端决定是否拒绝。
func authToken() string {
	if env := strings.TrimSpace(os.Getenv("FLOWX_STUDIO_AUTH_TOKEN")); env != "" {
		return env
	}
	dataDir := strings.TrimSpace(os.Getenv("FLOWX_STUDIO_DATA_DIR"))
	if dataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		dataDir = filepath.Join(home, ".flowx-studio")
	}
	raw, err := os.ReadFile(filepath.Join(dataDir, "auth.token"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}
