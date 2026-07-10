package mcpserver

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/LerkoX/flowx-studio/internal/service"
)

// JSONRPCRequest JSON-RPC 2.0 请求
type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      interface{}     `json:"id,omitempty"`
}

// JSONRPCResponse JSON-RPC 2.0 响应
type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   *JSONRPCError `json:"error,omitempty"`
}

// JSONRPCError JSON-RPC 2.0 错误
type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Server 是基于 stdio 的 MCP 服务
type Server struct {
	workflowSvc *service.WorkflowService
	nodeSvc     *service.NodeService
	in          io.Reader
	out         io.Writer
}

// New 创建 MCP 服务
func New(workflowSvc *service.WorkflowService, nodeSvc *service.NodeService) *Server {
	return &Server{
		workflowSvc: workflowSvc,
		nodeSvc:     nodeSvc,
		in:          io.Reader(nil),
		out:         io.Writer(nil),
	}
}

// SetIO 设置输入输出
func (s *Server) SetIO(in io.Reader, out io.Writer) {
	s.in = in
	s.out = out
}

// Run 开始监听 stdio
func (s *Server) Run(ctx context.Context) error {
	if s.in == nil {
		s.in = os.Stdin
	}
	if s.out == nil {
		s.out = os.Stdout
	}

	scanner := bufio.NewScanner(s.in)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		var req JSONRPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			s.writeError(nil, -32700, "Parse error: "+err.Error())
			continue
		}

		if req.JSONRPC != "2.0" {
			s.writeError(req.ID, -32600, "Invalid Request: jsonrpc must be 2.0")
			continue
		}

		resp := s.handleRequest(ctx, &req)
		if resp == nil {
			continue
		}
		if err := s.writeResponse(resp); err != nil {
			return err
		}
	}

	return scanner.Err()
}

func (s *Server) handleRequest(ctx context.Context, req *JSONRPCRequest) *JSONRPCResponse {
	switch req.Method {
	case "initialize":
		return s.handleInitialize(req.ID)
	case "initialized":
		// 通知无需响应
		return nil
	case "tools/list":
		return s.handleToolsList(req.ID)
	case "tools/call":
		return s.handleToolCall(ctx, req)
	default:
		return s.errorResponse(req.ID, -32601, "Method not found: "+req.Method)
	}
}

func (s *Server) handleInitialize(id interface{}) *JSONRPCResponse {
	return &JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result: map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"serverInfo": map[string]interface{}{
				"name":    "flowx-studio",
				"version": "1.0.0",
			},
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{},
			},
		},
	}
}

func (s *Server) handleToolsList(id interface{}) *JSONRPCResponse {
	return &JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result: map[string]interface{}{
			"tools": toolsList(),
		},
	}
}

func (s *Server) handleToolCall(ctx context.Context, req *JSONRPCRequest) *JSONRPCResponse {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil || params.Name == "" {
		return s.errorResponse(req.ID, -32602, "Invalid params")
	}

	// 优先使用标准 MCP arguments 字段，兼容顶层字段
	toolParams := params.Arguments
	if len(toolParams) == 0 || string(toolParams) == "{}" {
		toolParams = req.Params
	}

	text, isError := s.dispatchTool(ctx, params.Name, toolParams)
	result := map[string]interface{}{
		"content": []map[string]interface{}{
			{
				"type": "text",
				"text": text,
			},
		},
		"isError": isError,
	}
	return &JSONRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: result}
}

func (s *Server) dispatchTool(ctx context.Context, name string, rawParams json.RawMessage) (string, bool) {
	switch name {
	case "create_pipeline":
		return s.createPipeline(rawParams)
	case "update_pipeline":
		return s.updatePipeline(rawParams)
	case "delete_pipeline":
		return s.deletePipeline(rawParams)
	case "list_pipelines":
		return s.listPipelines(rawParams)
	case "run_pipeline":
		return s.runPipeline(rawParams)
	case "create_node":
		return s.createNode(rawParams)
	case "delete_node":
		return s.deleteNode(rawParams)
	case "list_nodes":
		return s.listNodes(rawParams)
	default:
		return fmt.Sprintf("Unknown tool: %s", name), true
	}
}

func (s *Server) errorResponse(id interface{}, code int, message string) *JSONRPCResponse {
	return &JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &JSONRPCError{Code: code, Message: message},
	}
}

func (s *Server) writeError(id interface{}, code int, message string) {
	resp := s.errorResponse(id, code, message)
	_ = s.writeResponse(resp)
}

func (s *Server) writeResponse(resp *JSONRPCResponse) error {
	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(s.out, string(data))
	return err
}

func mustJSONString(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func parseParams(raw json.RawMessage, v interface{}) error {
	return json.Unmarshal(raw, v)
}
