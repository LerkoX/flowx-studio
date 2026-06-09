package mcp

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/LerkoX/flowx-studio/internal/model"
)

// Connection MCP 连接
type Connection struct {
	ID       int64
	Config   model.MCPConfig
	Status   string // connected | disconnected | error
	LastError string
	
	// 本地模式
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
	
	// 远程模式
	client     *http.Client
	sseReader  *bufio.Reader
	sseCancel  context.CancelFunc
	
	// 通用
	tools      []Tool
	mu         sync.RWMutex
	heartbeatStop chan struct{}
}

// Tool MCP 工具定义
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// CallResult 工具调用结果
type CallResult struct {
	Success bool                   `json:"success"`
	Result  map[string]interface{} `json:"result,omitempty"`
	Error   string                 `json:"error,omitempty"`
}

// Manager MCP 连接管理器
type Manager struct {
	connections map[int64]*Connection
	mu          sync.RWMutex
}

// NewManager 创建 MCP 管理器
func NewManager() *Manager {
	return &Manager{
		connections: make(map[int64]*Connection),
	}
}

// Connect 建立 MCP 连接
func (m *Manager) Connect(cfg model.MCPConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// 断开已有连接
	if conn, ok := m.connections[cfg.ID]; ok {
		m.disconnectInternal(conn)
	}
	
	conn := &Connection{
		ID:            cfg.ID,
		Config:        cfg,
		Status:        "connecting",
		heartbeatStop: make(chan struct{}),
	}
	m.connections[cfg.ID] = conn
	
	var err error
	if cfg.Mode == "local" {
		err = m.connectLocal(conn)
	} else {
		err = m.connectRemote(conn)
	}
	
	if err != nil {
		conn.Status = "error"
		conn.LastError = err.Error()
		return err
	}
	
	conn.Status = "connected"
	
	// 启动心跳检测
	go m.heartbeat(conn)
	
	// 发现工具
	go m.discoverTools(conn)
	
	return nil
}

// Disconnect 断开 MCP 连接
func (m *Manager) Disconnect(id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	conn, ok := m.connections[id]
	if !ok {
		return fmt.Errorf("connection not found")
	}
	
	m.disconnectInternal(conn)
	delete(m.connections, id)
	
	return nil
}

// GetConnection 获取连接
func (m *Manager) GetConnection(id int64) *Connection {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.connections[id]
}

// GetAllConnections 获取所有连接
func (m *Manager) GetAllConnections() []*Connection {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	conns := make([]*Connection, 0, len(m.connections))
	for _, conn := range m.connections {
		conns = append(conns, conn)
	}
	return conns
}

// CallTool 调用 MCP 工具
func (m *Manager) CallTool(id int64, toolName string, params map[string]interface{}) (*CallResult, error) {
	conn := m.GetConnection(id)
	if conn == nil {
		return nil, fmt.Errorf("connection not found")
	}
	
	if conn.Status != "connected" {
		return nil, fmt.Errorf("connection not connected, status: %s", conn.Status)
	}
	
	if conn.Config.Mode == "local" {
		return m.callToolLocal(conn, toolName, params)
	}
	
	return m.callToolRemote(conn, toolName, params)
}

// GetTools 获取工具列表
func (m *Manager) GetTools(id int64) []Tool {
	conn := m.GetConnection(id)
	if conn == nil {
		return nil
	}
	
	conn.mu.RLock()
	defer conn.mu.RUnlock()
	
	tools := make([]Tool, len(conn.tools))
	copy(tools, conn.tools)
	return tools
}

// ========== 本地模式 ==========

func (m *Manager) connectLocal(conn *Connection) error {
	cfg := conn.Config
	
	// 黑名单校验
	if isBlacklisted(cfg.Command) {
		return fmt.Errorf("command is in blacklist: %s", cfg.Command)
	}
	
	// 检查命令是否存在
	cmdPath, err := exec.LookPath(cfg.Command)
	if err != nil {
		return fmt.Errorf("command not found: %s", cfg.Command)
	}
	
	// 启动子进程
	cmd := exec.Command(cmdPath, cfg.Args...)
	
	// 设置环境变量
	env := os.Environ()
	for k, v := range cfg.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env
	
	// 获取管道
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}
	
	// 启动进程
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}
	
	conn.cmd = cmd
	conn.stdin = stdin
	conn.stdout = stdout
	conn.stderr = stderr
	
	// 等待初始化完成（读取第一行输出）
	reader := bufio.NewReader(stdout)
	line, err := reader.ReadString('\n')
	if err != nil {
		cmd.Process.Kill()
		return fmt.Errorf("failed to read initialization output: %w", err)
	}
	
	// 检查初始化输出
	line = strings.TrimSpace(line)
	if line != "" {
		var initResp map[string]interface{}
		if err := json.Unmarshal([]byte(line), &initResp); err == nil {
			if status, ok := initResp["status"].(string); ok && status == "error" {
				cmd.Process.Kill()
				return fmt.Errorf("server initialization failed: %v", initResp["message"])
			}
		}
	}
	
	// 保存 reader 用于后续通信
	conn.stdout = &readCloser{Reader: reader, Closer: stdout}
	
	return nil
}

func (m *Manager) callToolLocal(conn *Connection, toolName string, params map[string]interface{}) (*CallResult, error) {
	// 构建 JSON-RPC 请求
	request := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "tools/call",
		"params": map[string]interface{}{
			"name":      toolName,
			"arguments": params,
		},
		"id": time.Now().UnixNano(),
	}
	
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}
	
	// 发送请求
	if _, err := fmt.Fprintf(conn.stdin, "%s\n", requestJSON); err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	
	// 读取响应
	reader := bufio.NewReader(conn.stdout)
	responseJSON, err := reader.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	
	// 解析响应
	var response struct {
		Result map[string]interface{} `json:"result"`
		Error  struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	
	if err := json.Unmarshal([]byte(responseJSON), &response); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	if response.Error.Message != "" {
		return &CallResult{
			Success: false,
			Error:   response.Error.Message,
		}, nil
	}
	
	return &CallResult{
		Success: true,
		Result:  response.Result,
	}, nil
}

// ========== 远程模式 ==========

func (m *Manager) connectRemote(conn *Connection) error {
	cfg := conn.Config
	
	// 创建 HTTP 客户端
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	
	conn.client = client
	
	// 建立 SSE 连接
	ctx, cancel := context.WithCancel(context.Background())
	conn.sseCancel = cancel
	
	req, err := http.NewRequestWithContext(ctx, "GET", cfg.URL+"/sse", nil)
	if err != nil {
		return fmt.Errorf("failed to create SSE request: %w", err)
	}
	
	// 设置认证头
	if cfg.AuthHeaderKey != "" && cfg.AuthHeaderValue != "" {
		req.Header.Set(cfg.AuthHeaderKey, cfg.AuthHeaderValue)
	}
	
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to SSE endpoint: %w", err)
	}
	
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return fmt.Errorf("SSE connection failed with status: %d", resp.StatusCode)
	}
	
	conn.sseReader = bufio.NewReader(resp.Body)
	
	// 读取 SSE 事件
	go func() {
		defer resp.Body.Close()
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			
			line, err := conn.sseReader.ReadString('\n')
			if err != nil {
				if ctx.Err() == nil {
					conn.mu.Lock()
					conn.Status = "error"
					conn.LastError = fmt.Sprintf("SSE read error: %v", err)
					conn.mu.Unlock()
				}
				return
			}
			
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			
			// 解析 SSE 事件
			if strings.HasPrefix(line, "data: ") {
				data := line[6:]
				m.handleSSEEvent(conn, data)
			}
		}
	}()
	
	return nil
}

func (m *Manager) callToolRemote(conn *Connection, toolName string, params map[string]interface{}) (*CallResult, error) {
	// 构建请求
	request := map[string]interface{}{
		"name":      toolName,
		"arguments": params,
	}
	
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}
	
	// 发送 HTTP POST 请求
	req, err := http.NewRequest("POST", conn.Config.URL+"/tools/call", strings.NewReader(string(requestJSON)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Content-Type", "application/json")
	if conn.Config.AuthHeaderKey != "" && conn.Config.AuthHeaderValue != "" {
		req.Header.Set(conn.Config.AuthHeaderKey, conn.Config.AuthHeaderValue)
	}
	
	resp, err := conn.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(body))
	}
	
	// 解析响应
	var result CallResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	
	return &result, nil
}

func (m *Manager) handleSSEEvent(conn *Connection, data string) {
	var event map[string]interface{}
	if err := json.Unmarshal([]byte(data), &event); err != nil {
		return
	}
	
	// 处理工具列表更新
	if tools, ok := event["tools"].([]interface{}); ok {
		conn.mu.Lock()
		conn.tools = make([]Tool, 0, len(tools))
		for _, t := range tools {
			if toolMap, ok := t.(map[string]interface{}); ok {
				tool := Tool{
					Name:        getString(toolMap, "name"),
					Description: getString(toolMap, "description"),
				}
				if params, ok := toolMap["parameters"].(map[string]interface{}); ok {
					tool.Parameters = params
				}
				conn.tools = append(conn.tools, tool)
			}
		}
		conn.mu.Unlock()
	}
}

// ========== 通用方法 ==========

func (m *Manager) heartbeat(conn *Connection) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			if conn.Status != "connected" {
				return
			}
			
			// 发送心跳
			if conn.Config.Mode == "local" {
				if conn.cmd == nil || conn.cmd.Process == nil {
					conn.Status = "error"
					conn.LastError = "process not running"
					return
				}
				if err := conn.cmd.Process.Signal(os.Signal(nil)); err != nil {
					conn.Status = "error"
					conn.LastError = fmt.Sprintf("heartbeat failed: %v", err)
					return
				}
			}
			
		case <-conn.heartbeatStop:
			return
		}
	}
}

func (m *Manager) discoverTools(conn *Connection) {
	// 等待连接稳定
	time.Sleep(1 * time.Second)
	
	if conn.Status != "connected" {
		return
	}
	
	// 发送工具发现请求
	if conn.Config.Mode == "local" {
		request := map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "tools/list",
			"id":      time.Now().UnixNano(),
		}
		
		requestJSON, _ := json.Marshal(request)
		fmt.Fprintf(conn.stdin, "%s\n", requestJSON)
		
		// 读取响应
		reader := bufio.NewReader(conn.stdout)
		responseJSON, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		
		var response struct {
			Result struct {
				Tools []Tool `json:"tools"`
			} `json:"result"`
		}
		
		if err := json.Unmarshal([]byte(responseJSON), &response); err == nil {
			conn.mu.Lock()
			conn.tools = response.Result.Tools
			conn.mu.Unlock()
		}
	}
}

func (m *Manager) disconnectInternal(conn *Connection) {
	// 停止心跳
	close(conn.heartbeatStop)
	
	// 断开本地连接
	if conn.cmd != nil && conn.cmd.Process != nil {
		conn.cmd.Process.Kill()
		conn.cmd.Wait()
	}
	
	if conn.stdin != nil {
		conn.stdin.Close()
	}
	if conn.stdout != nil {
		conn.stdout.Close()
	}
	if conn.stderr != nil {
		conn.stderr.Close()
	}
	
	// 断开远程连接
	if conn.sseCancel != nil {
		conn.sseCancel()
	}
	
	conn.Status = "disconnected"
}

// ========== 辅助函数 ==========

func isBlacklisted(cmd string) bool {
	cmd = strings.TrimSpace(cmd)
	
	// 检查是否包含 shell 操作符
	for _, op := range []string{">", ">>", "|", ";", "&&", "||", "`", "$"} {
		if strings.Contains(cmd, op) {
			return true
		}
	}
	
	// 默认黑名单
	defaultBlacklist := []string{
		"rm", "rmdir", "del", "format", "mkfs", "fdisk", "dd",
		"curl", "wget", "nc", "netcat", "telnet", "ssh", "scp",
		"sudo", "su", "chmod", "chown", "mount", "umount",
		"reboot", "shutdown", "halt", "poweroff", "kill", "killall",
	}
	
	parts := strings.Fields(cmd)
	if len(parts) == 0 {
		return false
	}
	
	base := filepath.Base(parts[0])
	for _, b := range defaultBlacklist {
		if base == b {
			return true
		}
	}
	
	return false
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// readCloser 包装 Reader 和 Closer
type readCloser struct {
	io.Reader
	io.Closer
}
