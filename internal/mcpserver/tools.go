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
			Name:        "import_node",
			Description: "Import a node package from a git repository or local folder by reading flowx.json. This is the only way to add a node via MCP.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"source_type": map[string]interface{}{
						"type":        "string",
						"description": "git | folder",
					},
					"source_url": map[string]interface{}{
						"type":        "string",
						"description": "Git URL (required when source_type is git)",
					},
					"source_path": map[string]interface{}{
						"type":        "string",
						"description": "Local folder path (required when source_type is folder)",
					},
				},
				"required": []string{"source_type"},
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
					"language":  map[string]interface{}{"type": "string"},
					"tag":       map[string]interface{}{"type": "string"},
					"search":    map[string]interface{}{"type": "string"},
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

func (s *Server) importNode(raw json.RawMessage) (string, bool) {
	var req struct {
		SourceType string `json:"source_type"`
		SourceURL  string `json:"source_url"`
		SourcePath string `json:"source_path"`
	}
	if err := parseParams(raw, &req); err != nil {
		return err.Error(), true
	}

	sourceType := strings.ToLower(strings.TrimSpace(req.SourceType))
	if sourceType != "git" && sourceType != "folder" {
		return "source_type must be git or folder", true
	}

	var node *model.Node
	var err error

	switch sourceType {
	case "git":
		if strings.TrimSpace(req.SourceURL) == "" {
			return "source_url is required for git imports", true
		}
		node, err = s.nodeImportSvc.ImportFromGit(req.SourceURL)
	case "folder":
		if strings.TrimSpace(req.SourcePath) == "" {
			return "source_path is required for folder imports", true
		}
		node, err = s.nodeImportSvc.ImportFromFolder(req.SourcePath)
	}

	if err != nil {
		return fmt.Sprintf("Failed to import node: %v", err), true
	}

	summary := map[string]interface{}{
		"id":           node.ID,
		"name":         node.Name,
		"display_name": node.DisplayName,
		"version":      node.Version,
		"language":     node.Language,
		"node_type":    node.NodeType,
		"image":        node.Image,
		"parameters":   node.Parameters,
		"outputs":      node.Outputs,
	}
	return mustJSONString(summary), false
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
