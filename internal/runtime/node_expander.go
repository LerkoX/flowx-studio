package runtime

import (
	"fmt"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// ExpandNodeToConfig 将 model.Node 展开为 flowx 核心的 NodeConfig
func ExpandNodeToConfig(node *model.Node) (*core.NodeConfig, error) {
	pkg := node.PackageConfig
	if pkg == nil {
		pkg = &model.NodePackage{
			Language:   node.Language,
			Entry:      node.Entry,
			Image:      node.Image,
			Parameters: node.Parameters,
			Outputs:    node.Outputs,
		}
	}

	executorType := pkg.Executor.Type
	if executorType == "" {
		if pkg.Image != "" {
			executorType = "docker"
		} else {
			executorType = "local"
		}
	}

	executorName := node.Name + "-executor"

	var runScript strings.Builder

	// 环境变量注入
	envMap := buildEnvMap(node, pkg)
	for key, template := range envMap {
		fmt.Fprintf(&runScript, "export %s=\"%s\"\n", key, template)
	}

	// 写入入口文件
	fmt.Fprintf(&runScript, "cat > %s << 'FLOWX_FILE_EOF'\n", pkg.Entry)
	runScript.WriteString(node.Code)
	if !strings.HasSuffix(node.Code, "\n") {
		runScript.WriteString("\n")
	}
	runScript.WriteString("FLOWX_FILE_EOF\n")

	// 写入额外文件
	for filename, content := range node.Files {
		fmt.Fprintf(&runScript, "cat > %s << 'FLOWX_FILE_EOF'\n", filename)
		runScript.WriteString(content)
		if !strings.HasSuffix(content, "\n") {
			runScript.WriteString("\n")
		}
		runScript.WriteString("FLOWX_FILE_EOF\n")
	}

	// 执行命令
	cmd := pkg.Run
	if cmd == "" {
		cmd = defaultRunCommand(node.Language, node.Entry)
	}
	if cmd == "" {
		return nil, fmt.Errorf("cannot determine run command for node %s", node.Name)
	}
	runScript.WriteString(cmd)
	if !strings.HasSuffix(cmd, "\n") {
		runScript.WriteString("\n")
	}

	nodeCfg := &core.NodeConfig{
		Name:     node.DisplayName,
		Executor: executorName,
		Image:    pkg.Image,
		Steps: []core.Step{
			{
				Name: "run",
				Run:  runScript.String(),
			},
		},
		Config: map[string]interface{}{
			"nodeRef": node.Name,
		},
	}

	if pkg.Extract != nil {
		nodeCfg.Extract = &core.ExtractConfig{
			Type:          pkg.Extract.Type,
			Patterns:      pkg.Extract.Patterns,
			MaxOutputSize: pkg.Extract.MaxOutputSize,
		}
	} else {
		nodeCfg.Extract = &core.ExtractConfig{Type: "codec-block"}
	}

	return nodeCfg, nil
}

// ExpandWorkflowConfig 展开工作流 YAML 中的 nodeRef 引用
func ExpandWorkflowConfig(configYAML string, lookup func(name string) (*model.Node, error)) (string, error) {
	var cfg core.PipelineConfig
	if err := yaml.Unmarshal([]byte(configYAML), &cfg); err != nil {
		return "", fmt.Errorf("failed to parse workflow yaml: %w", err)
	}

	executors := cfg.Executors
	if executors == nil {
		executors = make(map[string]core.ExecutorConfig)
	}

	for nodeName, nodeCfg := range cfg.Nodes {
		ref := ""
		if nodeCfg.Config != nil {
			if v, ok := nodeCfg.Config["nodeRef"].(string); ok {
				ref = v
			}
		}
		if ref == "" {
			continue
		}

		node, err := lookup(ref)
		if err != nil {
			return "", fmt.Errorf("failed to lookup node %s: %w", ref, err)
		}
		if node == nil {
			return "", fmt.Errorf("node %s not found", ref)
		}

		expanded, err := ExpandNodeToConfig(node)
		if err != nil {
			return "", fmt.Errorf("failed to expand node %s: %w", ref, err)
		}

		expanded.Executor = fmt.Sprintf("%s-executor", node.Name)
		cfg.Nodes[nodeName] = *expanded

		execType := node.PackageConfig.Executor.Type
		if execType == "" {
			if node.PackageConfig.Image != "" {
				execType = "docker"
			} else {
				execType = "local"
			}
		}
		executors[expanded.Executor] = core.ExecutorConfig{
			Type:   execType,
			Config: node.PackageConfig.Executor.Config,
		}
	}

	cfg.Executors = executors

	out, err := yaml.Marshal(cfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal workflow yaml: %w", err)
	}

	return string(out), nil
}

func buildEnvMap(node *model.Node, pkg *model.NodePackage) map[string]string {
	if len(pkg.Env) > 0 {
		return pkg.Env
	}

	env := make(map[string]string)
	for _, param := range node.Parameters {
		key := fmt.Sprintf("FLOWX_PARAM_%s", strings.ToUpper(param.Name))
		env[key] = fmt.Sprintf("{{ Param.%s }}", param.Name)
	}
	return env
}

func defaultRunCommand(language, entry string) string {
	lang := strings.ToLower(language)
	switch lang {
	case "python":
		return fmt.Sprintf("python3 %s", entry)
	case "go":
		return fmt.Sprintf("go run %s", entry)
	case "bash", "sh":
		return fmt.Sprintf("bash %s", entry)
	case "node", "javascript", "js":
		return fmt.Sprintf("node %s", entry)
	case "typescript", "ts":
		return fmt.Sprintf("ts-node %s", entry)
	case "ruby":
		return fmt.Sprintf("ruby %s", entry)
	case "php":
		return fmt.Sprintf("php %s", entry)
	default:
		return ""
	}
}
