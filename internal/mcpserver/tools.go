package mcpserver

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
)

// tool 定义
type tool struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema interface{} `json:"inputSchema"`
}

func toolsList() []tool {
	return []tool{
		{
			Name:        "create_pipeline",
			Description: "Create a new pipeline/workflow with YAML config. If YAML is invalid, the tool will fail with a validation error so the AI can regenerate.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type":        "string",
						"description": "Pipeline name",
					},
					"description": map[string]interface{}{
						"type":        "string",
						"description": "Pipeline description",
					},
					"intent": map[string]interface{}{
						"type":        "string",
						"description": "Pipeline intent",
					},
					"yaml_config": map[string]interface{}{
						"type":        "string",
						"description": "FlowX YAML pipeline config (must be valid YAML)",
					},
					"status": map[string]interface{}{
						"type":        "string",
						"description": "Pipeline status (draft | active | archived)",
					},
				},
				"required": []string{"name", "yaml_config"},
			},
		},
		{
			Name:        "update_pipeline",
			Description: "Update an existing pipeline/workflow. Invalid YAML will be rejected.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"id": map[string]interface{}{
						"type":        "integer",
						"description": "Pipeline ID",
					},
					"name": map[string]interface{}{
						"type": "string",
					},
					"description": map[string]interface{}{
						"type": "string",
					},
					"intent": map[string]interface{}{
						"type": "string",
					},
					"yaml_config": map[string]interface{}{
						"type": "string",
					},
					"status": map[string]interface{}{
						"type": "string",
					},
				},
				"required": []string{"id", "name", "yaml_config"},
			},
		},
		{
			Name:        "delete_pipeline",
			Description: "Delete a pipeline by ID.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"id": map[string]interface{}{
						"type":        "integer",
						"description": "Pipeline ID",
					},
				},
				"required": []string{"id"},
			},
		},
		{
			Name:        "list_pipelines",
			Description: "List pipelines with optional filters.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"status": map[string]interface{}{"type": "string"},
					"search": map[string]interface{}{"type": "string"},
					"page": map[string]interface{}{
						"type":    "integer",
						"default": 1,
					},
					"page_size": map[string]interface{}{
						"type":    "integer",
						"default": 20,
					},
				},
			},
		},
		{
			Name:        "run_pipeline",
			Description: "Run a pipeline by ID.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"id": map[string]interface{}{
						"type":        "integer",
						"description": "Pipeline ID",
					},
				},
				"required": []string{"id"},
			},
		},
		{
			Name:        "create_node",
			Description: "Create a node by importing from git, image or folder. Manual code creation is not allowed.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type": "string",
					},
					"display_name": map[string]interface{}{"type": "string"},
					"description": map[string]interface{}{"type": "string"},
					"node_type": map[string]interface{}{
						"type":        "string",
						"description": "code | image",
					},
					"source_type": map[string]interface{}{
						"type":        "string",
						"description": "git | image | folder",
					},
					"source_url": map[string]interface{}{
						"type":        "string",
						"description": "Git URL or image name",
					},
					"source_path": map[string]interface{}{
						"type":        "string",
						"description": "Local folder path",
					},
					"image": map[string]interface{}{
						"type":        "string",
						"description": "Docker image (for image nodes)",
					},
					"language": map[string]interface{}{"type": "string"},
					"parameters": map[string]interface{}{
						"type": "array",
					},
					"outputs": map[string]interface{}{
						"type": "array",
					},
					"tags": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{"type": "string"},
					},
				},
				"required": []string{"name", "node_type", "source_type"},
			},
		},
		{
			Name:        "delete_node",
			Description: "Delete a node by ID.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"id": map[string]interface{}{
						"type":        "integer",
						"description": "Node ID",
					},
				},
				"required": []string{"id"},
			},
		},
		{
			Name:        "list_nodes",
			Description: "List nodes with optional filters.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"language": map[string]interface{}{"type": "string"},
					"tag": map[string]interface{}{"type": "string"},
					"search": map[string]interface{}{"type": "string"},
					"node_type": map[string]interface{}{"type": "string"},
					"page": map[string]interface{}{
						"type":    "integer",
						"default": 1,
					},
					"page_size": map[string]interface{}{
						"type":    "integer",
						"default": 20,
					},
				},
			},
		},
	}
}

func (s *Server) createPipeline(raw json.RawMessage) (string, bool) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Intent      string `json:"intent"`
		YAMLConfig  string `json:"yaml_config"`
		Status      string `json:"status"`
	}
	if err := parseParams(raw, &req); err != nil {
		return err.Error(), true
	}
	if req.Status == "" {
		req.Status = "draft"
	}

	wf := &model.Workflow{
		Name:        req.Name,
		Description: req.Description,
		Intent:      req.Intent,
		YAMLConfig:  req.YAMLConfig,
		Status:      req.Status,
	}
	created, err := s.workflowSvc.Create(wf)
	if err != nil {
		return fmt.Sprintf("Failed to create pipeline: %v. Please regenerate the YAML and retry.", err), true
	}
	return fmt.Sprintf("Created pipeline id=%d name=%s", created.ID, created.Name), false
}

func (s *Server) updatePipeline(raw json.RawMessage) (string, bool) {
	var req struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Intent      string `json:"intent"`
		YAMLConfig  string `json:"yaml_config"`
		Status      string `json:"status"`
	}
	if err := parseParams(raw, &req); err != nil {
		return err.Error(), true
	}

	wf := &model.Workflow{
		Name:        req.Name,
		Description: req.Description,
		Intent:      req.Intent,
		YAMLConfig:  req.YAMLConfig,
		Status:      req.Status,
	}
	if err := s.workflowSvc.Update(req.ID, wf); err != nil {
		return fmt.Sprintf("Failed to update pipeline: %v. Please regenerate the YAML and retry.", err), true
	}
	return fmt.Sprintf("Updated pipeline id=%d", req.ID), false
}

func (s *Server) deletePipeline(raw json.RawMessage) (string, bool) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := parseParams(raw, &req); err != nil {
		return err.Error(), true
	}
	if err := s.workflowSvc.Delete(req.ID); err != nil {
		return fmt.Sprintf("Failed to delete pipeline: %v", err), true
	}
	return fmt.Sprintf("Deleted pipeline id=%d", req.ID), false
}

func (s *Server) listPipelines(raw json.RawMessage) (string, bool) {
	var req struct {
		Status   string `json:"status"`
		Search   string `json:"search"`
		Page     int    `json:"page"`
		PageSize int    `json:"page_size"`
	}
	parseParams(raw, &req)

	resp, err := s.workflowSvc.List(req.Status, req.Search, req.Page, req.PageSize)
	if err != nil {
		return fmt.Sprintf("Failed to list pipelines: %v", err), true
	}
	return mustJSONString(resp), false
}

func (s *Server) runPipeline(raw json.RawMessage) (string, bool) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := parseParams(raw, &req); err != nil {
		return err.Error(), true
	}
	execID, streamURL, err := s.workflowSvc.Run(req.ID, nil, false)
	if err != nil {
		return fmt.Sprintf("Failed to run pipeline: %v", err), true
	}
	return fmt.Sprintf("Started execution id=%d streamUrl=%s", execID, streamURL), false
}

func (s *Server) createNode(raw json.RawMessage) (string, bool) {
	var req struct {
		Name        string            `json:"name"`
		DisplayName string            `json:"display_name"`
		Description string            `json:"description"`
		NodeType    string            `json:"node_type"`
		SourceType  string            `json:"source_type"`
		SourceURL   string            `json:"source_url"`
		SourcePath  string            `json:"source_path"`
		Image       string            `json:"image"`
		Language    string            `json:"language"`
		Parameters  []model.NodeParameter `json:"parameters"`
		Outputs     []model.NodeOutput    `json:"outputs"`
		Tags        []string          `json:"tags"`
	}
	if err := parseParams(raw, &req); err != nil {
		return err.Error(), true
	}

	sourceType := strings.ToLower(req.SourceType)
	if sourceType != "git" && sourceType != "image" && sourceType != "folder" {
		return "source_type must be one of git, image, folder (manual code creation is not allowed)", true
	}

	if sourceType == "image" && strings.TrimSpace(req.Image) == "" {
		return "image is required for image nodes", true
	}
	if (sourceType == "git" || sourceType == "folder") && strings.TrimSpace(req.SourceURL) == "" && strings.TrimSpace(req.SourcePath) == "" {
		return "source_url or source_path is required for git/folder nodes", true
	}

	node := &model.Node{
		Name:        req.Name,
		DisplayName: req.DisplayName,
		Description: req.Description,
		NodeType:    req.NodeType,
		SourceType:  sourceType,
		SourceURL:   req.SourceURL,
		SourcePath:  req.SourcePath,
		Image:       req.Image,
		Language:    req.Language,
		Parameters:  req.Parameters,
		Outputs:     req.Outputs,
		Tags:        req.Tags,
	}
	if node.NodeType == "" {
		node.NodeType = "code"
	}
	if node.Parameters == nil {
		node.Parameters = []model.NodeParameter{}
	}

	created, err := s.nodeSvc.Create(node)
	if err != nil {
		return fmt.Sprintf("Failed to create node: %v", err), true
	}
	return fmt.Sprintf("Created node id=%d name=%s", created.ID, created.Name), false
}

func (s *Server) deleteNode(raw json.RawMessage) (string, bool) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := parseParams(raw, &req); err != nil {
		return err.Error(), true
	}
	if err := s.nodeSvc.Delete(req.ID); err != nil {
		return fmt.Sprintf("Failed to delete node: %v", err), true
	}
	return fmt.Sprintf("Deleted node id=%d", req.ID), false
}

func (s *Server) listNodes(raw json.RawMessage) (string, bool) {
	var req struct {
		Language string `json:"language"`
		Tag      string `json:"tag"`
		Search   string `json:"search"`
		NodeType string `json:"node_type"`
		Page     int    `json:"page"`
		PageSize int    `json:"page_size"`
	}
	parseParams(raw, &req)

	resp, err := s.nodeSvc.List(req.Language, req.Tag, req.Search, req.NodeType, req.Page, req.PageSize)
	if err != nil {
		return fmt.Sprintf("Failed to list nodes: %v", err), true
	}
	return mustJSONString(resp), false
}
