package service

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/sandbox"
)

// NodeImportService 节点导入服务
type NodeImportService struct {
	nodeSvc *NodeService
}

// NewNodeImportService 创建节点导入服务
func NewNodeImportService(nodeSvc *NodeService) *NodeImportService {
	return &NodeImportService{nodeSvc: nodeSvc}
}

// ImportFromGit 从 Git 仓库导入节点包
func (s *NodeImportService) ImportFromGit(url string) (*model.Node, error) {
	if strings.TrimSpace(url) == "" {
		return nil, fmt.Errorf("git url is required")
	}

	tmpDir, err := os.MkdirTemp("", "flowx-node-import-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cloneDir := filepath.Join(tmpDir, "repo")
	if err := s.gitClone(url, cloneDir); err != nil {
		return nil, fmt.Errorf("failed to clone git repo: %w", err)
	}

	node, err := s.importFromPath(cloneDir, "git", url, "")
	if err != nil {
		return nil, err
	}
	return node, nil
}

// ImportFromFolder 从本地文件夹导入节点包
func (s *NodeImportService) ImportFromFolder(path string) (*model.Node, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("folder path is required")
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve folder path: %w", err)
	}

	node, err := s.importFromPath(absPath, "folder", "", absPath)
	if err != nil {
		return nil, err
	}
	return node, nil
}

func (s *NodeImportService) gitClone(url, dir string) error {
	cmd := exec.Command("git", "clone", "--depth", "1", url, dir)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func (s *NodeImportService) importFromPath(dir, sourceType, sourceURL, sourcePath string) (*model.Node, error) {
	configPath := filepath.Join(dir, "flowx.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read flowx.json: %w", err)
	}

	var pkg model.NodePackage
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil, fmt.Errorf("failed to parse flowx.json: %w", err)
	}

	if err := s.validatePackage(dir, &pkg); err != nil {
		return nil, fmt.Errorf("invalid flowx.json: %w", err)
	}

	node, err := s.buildNode(dir, &pkg, sourceType, sourceURL, sourcePath)
	if err != nil {
		return nil, err
	}

	created, err := s.nodeSvc.Create(node)
	if err != nil {
		return nil, err
	}
	s.nodeSvc.auditRecord("import_node", fmt.Sprintf("%d", created.ID),
		fmt.Sprintf("name=%s source=%s", created.Name, sourceType))
	return created, nil
}

func (s *NodeImportService) validatePackage(dir string, pkg *model.NodePackage) error {
	if strings.TrimSpace(pkg.Name) == "" {
		return fmt.Errorf("name is required")
	}

	validName := regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]*$`)
	if !validName.MatchString(pkg.Name) {
		return fmt.Errorf("name must be snake_case or kebab-case and start with a letter")
	}

	if strings.TrimSpace(pkg.Language) == "" {
		return fmt.Errorf("language is required")
	}

	if !sandbox.IsLanguageSupported(pkg.Language) {
		return fmt.Errorf("unsupported language: %s", pkg.Language)
	}

	if strings.TrimSpace(pkg.Entry) == "" {
		return fmt.Errorf("entry is required")
	}

	entryPath := filepath.Join(dir, pkg.Entry)
	if _, err := os.Stat(entryPath); err != nil {
		return fmt.Errorf("entry file %s not found: %w", pkg.Entry, err)
	}

	for _, filename := range pkg.Files {
		filePath := filepath.Join(dir, filename)
		if _, err := os.Stat(filePath); err != nil {
			return fmt.Errorf("file %s not found: %w", filename, err)
		}
	}

	seen := make(map[string]bool)
	for _, param := range pkg.Parameters {
		if strings.TrimSpace(param.Name) == "" {
			return fmt.Errorf("parameter name is required")
		}
		if seen[param.Name] {
			return fmt.Errorf("duplicate parameter name: %s", param.Name)
		}
		seen[param.Name] = true

		if !isValidParamType(param.Type) {
			return fmt.Errorf("invalid parameter type %s for %s", param.Type, param.Name)
		}
	}

	if pkg.Executor.Type != "" {
		if !isValidExecutorType(pkg.Executor.Type) {
			return fmt.Errorf("invalid executor type: %s", pkg.Executor.Type)
		}
	}

	if pkg.Mock != nil && pkg.Mock.Enabled && strings.TrimSpace(pkg.Mock.Entry) != "" {
		mockPath := filepath.Join(dir, pkg.Mock.Entry)
		if _, err := os.Stat(mockPath); err != nil {
			return fmt.Errorf("mock entry file %s not found: %w", pkg.Mock.Entry, err)
		}
	}

	return nil
}

func isValidParamType(t string) bool {
	switch strings.ToLower(t) {
	case "string", "integer", "int", "float", "boolean", "bool", "array", "object":
		return true
	}
	return false
}

func isValidExecutorType(t string) bool {
	switch strings.ToLower(t) {
	case "local", "docker", "k8s", "kubernetes":
		return true
	}
	return false
}

func (s *NodeImportService) buildNode(dir string, pkg *model.NodePackage, sourceType, sourceURL, sourcePath string) (*model.Node, error) {
	entryPath := filepath.Join(dir, pkg.Entry)
	code, err := os.ReadFile(entryPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read entry file: %w", err)
	}

	files := make(map[string]string)
	for _, filename := range pkg.Files {
		filePath := filepath.Join(dir, filename)
		content, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to read file %s: %w", filename, err)
		}
		files[filename] = string(content)
	}

	requirements := pkg.Requirements
	if len(requirements) == 0 {
		requirements = s.readRequirementsFile(dir)
	}

	nodeType := "code"
	if strings.TrimSpace(pkg.Entry) == "" && strings.TrimSpace(pkg.Image) != "" {
		nodeType = "image"
	}

	var mockConfig *model.NodeMockConfig
	if pkg.Mock != nil && pkg.Mock.Enabled {
		mockConfig = &model.NodeMockConfig{
			Enabled: pkg.Mock.Enabled,
			Entry:   pkg.Mock.Entry,
		}
		if strings.TrimSpace(pkg.Mock.Entry) != "" {
			mockPath := filepath.Join(dir, pkg.Mock.Entry)
			mockCode, err := os.ReadFile(mockPath)
			if err != nil {
				return nil, fmt.Errorf("failed to read mock file: %w", err)
			}
			mockConfig.Code = string(mockCode)
		}
	}

	var dockerConfig *model.NodeDockerConfig
	if pkg.Image != "" || pkg.Executor.Config != nil {
		workdir := ""
		if v, ok := pkg.Executor.Config["workdir"].(string); ok {
			workdir = v
		}
		dockerConfig = &model.NodeDockerConfig{
			Image:   pkg.Image,
			Workdir: workdir,
		}
	}

	node := &model.Node{
		Name:          pkg.Name,
		DisplayName:   pkg.DisplayName,
		Description:   pkg.Description,
		Version:       pkg.Version,
		Author:        pkg.Author,
		Icon:          pkg.Icon,
		NodeType:      nodeType,
		Language:      pkg.Language,
		Code:          string(code),
		Entry:         pkg.Entry,
		Files:         files,
		Image:         pkg.Image,
		DockerConfig:  dockerConfig,
		Requirements:  requirements,
		Parameters:    pkg.Parameters,
		Outputs:       pkg.Outputs,
		MockConfig:    mockConfig,
		SourceType:    sourceType,
		SourceURL:     sourceURL,
		SourcePath:    sourcePath,
		Tags:          pkg.Tags,
		PackageConfig: pkg,
	}

	return node, nil
}

func (s *NodeImportService) readRequirementsFile(dir string) []string {
	reqPath := filepath.Join(dir, "requirements.txt")
	data, err := os.ReadFile(reqPath)
	if err != nil {
		return nil
	}

	var reqs []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		reqs = append(reqs, line)
	}
	return reqs
}
