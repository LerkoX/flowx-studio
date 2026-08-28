package runtime

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// ExpandNodeToConfig 将 model.Node 展开为 flowx 核心的 NodeConfig
// paramBindings 为 pipeline YAML 中 config.params 提供的参数绑定（接线）：
// 值可以是常量，也可以是引用本流水线中上游节点实例的模板（如 {{ GetWeather.city }}），
// 绑定值会替换节点包 env/run 模板中的 {{ Param.<name> }} 引用。
func ExpandNodeToConfig(node *model.Node, paramBindings ...map[string]string) (*core.NodeConfig, error) {
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

	var bindings map[string]string
	if len(paramBindings) > 0 {
		bindings = paramBindings[0]
	}
	if err := validateBindings(pkg, bindings); err != nil {
		return nil, err
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
		template = applyParamBindings(template, bindings)
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
	cmd = applyParamBindings(cmd, bindings)
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

		bindings, err := parseParamBindings(nodeName, nodeCfg.Config)
		if err != nil {
			return "", err
		}

		expanded, err := ExpandNodeToConfig(node, bindings)
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

// parseParamBindings 从 pipeline YAML 的节点 config.params 中提取参数绑定。
// 值为标量或模板字符串（如 {{ GetWeather.city }}），统一转为 string。
func parseParamBindings(nodeName string, config map[string]interface{}) (map[string]string, error) {
	if config == nil {
		return nil, nil
	}
	raw, ok := config["params"]
	if !ok {
		return nil, nil
	}
	bindings := make(map[string]string)
	switch m := raw.(type) {
	case map[string]interface{}:
		for k, v := range m {
			bindings[k] = fmt.Sprintf("%v", v)
		}
	case map[string]string:
		for k, v := range m {
			bindings[k] = v
		}
	default:
		return nil, fmt.Errorf("node %s: config.params must be a map of parameter bindings", nodeName)
	}
	return bindings, nil
}

// validateBindings 校验 pipeline 层绑定的参数名都已在节点包 parameters 中声明
func validateBindings(pkg *model.NodePackage, bindings map[string]string) error {
	if len(bindings) == 0 {
		return nil
	}
	declared := make(map[string]bool, len(pkg.Parameters))
	for _, p := range pkg.Parameters {
		declared[p.Name] = true
	}
	for name := range bindings {
		if !declared[name] {
			return fmt.Errorf("config.params references undeclared parameter %q of node %s", name, pkg.Name)
		}
	}
	return nil
}

// applyParamBindings 将模板中的 {{ Param.<name> ... }} 引用替换为 pipeline 层提供的绑定值。
// 绑定值若是完整模板（{{ GetWeather.city }}），取其内部表达式并保留后续过滤器；
// 若是常量，则转为字符串字面量。未绑定的参数保留 {{ Param.<name> }} 引用，
// 运行时由 pipeline 级 Param / 运行时参数解析。
func applyParamBindings(tmpl string, bindings map[string]string) string {
	if tmpl == "" || len(bindings) == 0 {
		return tmpl
	}
	for name, bound := range bindings {
		inner := bindingInnerExpr(bound)
		re := regexp.MustCompile(`Param\.` + regexp.QuoteMeta(name) + `($|[^a-zA-Z0-9_-])`)
		tmpl = re.ReplaceAllString(tmpl, inner+`$1`)
	}
	return tmpl
}

// bindingInnerExpr 提取绑定值的模板内部表达式；常量转为字符串字面量
func bindingInnerExpr(v string) string {
	t := strings.TrimSpace(v)
	if strings.HasPrefix(t, "{{") && strings.HasSuffix(t, "}}") {
		return strings.TrimSpace(t[2 : len(t)-2])
	}
	return strconv.Quote(v)
}
