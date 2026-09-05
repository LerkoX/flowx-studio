package runtime

import (
	"fmt"
	"path"
	"reflect"
	"regexp"
	"sort"
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
	return expandNodeWithExecutorType(node, "", paramBindings...)
}

// expandNodeWithExecutorType 同 ExpandNodeToConfig，但允许调用方覆盖执行器类型。
// 覆盖值来自执行器实例解析（executor.ref / 默认执行器），影响资产引导路径的选择
//（local → cp 物化；docker → 签名 URL 拉取）。空字符串表示按节点包自身声明推断。
func expandNodeWithExecutorType(node *model.Node, executorTypeOverride string, paramBindings ...map[string]string) (*core.NodeConfig, error) {
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

	executorType := executorTypeOverride
	if executorType == "" {
		executorType = pkg.Executor.Type
		if executorType == "" {
			if pkg.Image != "" {
				executorType = "docker"
			} else {
				executorType = "local"
			}
		}
	}

	executorName := node.Name + "-executor"

	var runScript strings.Builder

	// 独立工作目录：每次执行创建临时目录，跑完自动清理，
	// 不再往执行器（server 进程）的 cwd 里散落文件
	runScript.WriteString("FLOWX_WORK_DIR=$(mktemp -d \"${TMPDIR:-/tmp}/flowx-node-XXXXXX\") || exit 1\n")
	runScript.WriteString("trap 'rm -rf \"$FLOWX_WORK_DIR\"' EXIT\n")
	runScript.WriteString("cd \"$FLOWX_WORK_DIR\" || exit 1\n")

	// 环境变量注入
	envMap := buildEnvMap(node, pkg)
	for _, key := range sortedKeys(envMap) {
		template := applyParamBindings(envMap[key], bindings)
		fmt.Fprintf(&runScript, "export %s=\"%s\"\n", key, template)
	}

	// 资产引导三条路径：
	//  1. local 执行器 + 资产库：cp 物化（脚本体积恒定，二进制安全）
	//  2. docker/k8s + 签名 URL：curl/wget HTTP 拉取（容器内看不到宿主机路径）
	//  3. legacy 节点：heredoc 内联（跳过 ui/ 文件）
	hasAssets := len(node.FileAssets) > 0
	cpBacked := node.AssetDir != "" && hasAssets &&
		(executorType == "" || executorType == "local")
	httpBacked := node.AssetURL != "" && hasAssets &&
		(executorType == "docker" || executorType == "k8s")
	// 容器执行器拿不到宿主机文件系统：带 runtime 依赖却没有签名 URL 时直接报错，
	// 避免静默产出缺文件的工作目录
	if !httpBacked && (executorType == "docker" || executorType == "k8s") && hasRuntimeAssets(node, pkg) {
		return nil, fmt.Errorf("node %s has runtime asset files but no signed asset URL; "+
			"configure assets.http_base (FLOWX_STUDIO_ASSETS_HTTP_BASE) to an executor-reachable address", node.Name)
	}
	switch {
	case cpBacked:
		fmt.Fprintf(&runScript, "FLOWX_ASSETS_DIR=%s\n", shellQuote(node.AssetDir))
		writeAssetFetch := func(rel string) {
			if dir := path.Dir(rel); dir != "." {
				fmt.Fprintf(&runScript, "mkdir -p %s\n", shellQuote(dir))
			}
			fmt.Fprintf(&runScript, "cp \"$FLOWX_ASSETS_DIR/%s\" %s\n", rel, shellQuote(rel))
		}
		writeAssetFiles(&runScript, node, pkg, writeAssetFetch)
	case httpBacked:
		fmt.Fprintf(&runScript, "FLOWX_ASSETS_URL=%s\n", shellQuote(node.AssetURL))
		// curl 优先，wget 兜底（精简镜像可能二缺一）
		runScript.WriteString("flowx_fetch() { curl -fsSL \"$FLOWX_ASSETS_URL/$1\" -o \"$1\" 2>/dev/null || wget -qO \"$1\" \"$FLOWX_ASSETS_URL/$1\"; }\n")
		writeAssetFetch := func(rel string) {
			if dir := path.Dir(rel); dir != "." {
				fmt.Fprintf(&runScript, "mkdir -p %s\n", shellQuote(dir))
			}
			fmt.Fprintf(&runScript, "flowx_fetch %s\n", shellQuote(rel))
		}
		writeAssetFiles(&runScript, node, pkg, writeAssetFetch)
	default:
		// 无资产库内容：仅 heredoc 写入入口代码（纯内联节点）。
		// 注意：带 runtime 依赖的 docker/k8s 节点必须在上方走 HTTP 引导，
		// 未配置 assets.http_base 时已在前面报错。
		writeFileHeredoc(&runScript, pkg.Entry, node.Code)
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
			// 物化节点记录完整引用 name@version：快照是执行实例的事实来源，
			// 精确版本保证回放展示与续跑比对可还原到具体节点版本
			"nodeRef": model.FormatNodeRef(node.Name, node.Version),
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

// ExecutorResolver 解析执行器实例：ref 非空时按名称查找注册的执行器；
// ref 为空且 useDefault 为 true 时返回全局默认执行器。
// 由 ExecutorService 实现，供展开器把节点绑定到命名执行器实例。
type ExecutorResolver func(ref string, useDefault bool) (*model.Executor, error)

// ExpandWorkflowConfig 展开工作流 YAML 中的 nodeRef 引用
//
// 执行器解析三级优先级（对每个 nodeRef 节点）：
//  1. flowx.json 声明 executor.ref → 引用注册的执行器实例（多节点共享同一 Executors 条目）
//  2. flowx.json 声明 executor.type (+config) → 内联匿名实例（合成 <node名>-executor）
//  3. 均未声明 → 有 image 归为 docker（默认执行器是 docker 时复用其实例，否则匿名 docker）；
//     无 image 使用全局默认执行器
//
// resolvers 缺省时回退到旧行为（匿名实例合成），便于不挂执行器注册表的场景（测试等）。
func ExpandWorkflowConfig(configYAML string, lookup func(name string) (*model.Node, error), resolvers ...ExecutorResolver) (string, error) {
	var resolve ExecutorResolver
	if len(resolvers) > 0 {
		resolve = resolvers[0]
	}

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
		// 引用格式前置校验（name 或 name@version），格式错误直接报清晰错误
		if _, _, err := model.ParseNodeRef(ref); err != nil {
			return "", err
		}
		// 已物化节点（带 steps，如执行快照中的历史节点）保持原样、跳过重展开：
		// 展开结果依赖执行器注册表/节点包版本等可变状态，重展开会改写
		// executor/steps 字段，导致与快照比对失败（Executors 不可变/已执行节点不可改）
		if len(nodeCfg.Steps) > 0 {
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

		// 解析执行器：ref → 内联 → 默认/docker
		execName, execType, err := resolveNodeExecutor(node, executors, resolve)
		if err != nil {
			return "", fmt.Errorf("failed to expand node %s: %w", ref, err)
		}

		expanded, err := expandNodeWithExecutorType(node, execType, bindings)
		if err != nil {
			return "", fmt.Errorf("failed to expand node %s: %w", ref, err)
		}

		expanded.Executor = execName
		cfg.Nodes[nodeName] = *expanded
	}

	cfg.Executors = executors

	out, err := yaml.Marshal(cfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal workflow yaml: %w", err)
	}

	return string(out), nil
}

// resolveNodeExecutor 为 nodeRef 节点解析执行器，返回 (执行器名, 执行器类型)。
// 命名实例会就地写入 executors map（多节点共享同一条目）；匿名实例合成 <node名>-executor。
//
// 镜像注入：节点声明的 image 会写入其 docker/k8s 执行器条目的 Config["image"]
//（flowx core 执行器按名单例，镜像不同即不同容器）。优先级：节点 image > 条目 config.image。
// 共享条目（ref 实例 / 默认实例）在镜像不一致时复制出节点专属条目，避免不同镜像的
// 节点互相覆盖同一共享容器。
func resolveNodeExecutor(node *model.Node, executors map[string]core.ExecutorConfig, resolve ExecutorResolver) (string, string, error) {
	pkg := node.PackageConfig
	if pkg == nil {
		pkg = &model.NodePackage{Image: node.Image}
	}
	image := nodeImage(pkg, node)

	// 1. executor.ref：引用注册的执行器实例
	if pkg.Executor.Ref != "" {
		if resolve == nil {
			return "", "", fmt.Errorf("node declares executor.ref %q but no executor registry is available", pkg.Executor.Ref)
		}
		inst, err := resolve(pkg.Executor.Ref, false)
		if err != nil {
			return "", "", err
		}
		// 容器执行器且镜像与实例配置不一致：复制实例配置合成节点专属条目
		if isContainerExecutor(inst.Type) && image != "" && configImage(inst.Config) != image {
			cfg := copyExecutorConfig(inst.Config)
			cfg["image"] = image
			if name := findCompatibleExecutor(executors, inst.Type, cfg); name != "" {
				return name, inst.Type, nil
			}
			name := node.Name + "-executor"
			executors[name] = core.ExecutorConfig{Type: inst.Type, Description: inst.Description, Config: cfg}
			return name, inst.Type, nil
		}
		executors[inst.Name] = core.ExecutorConfig{
			Type:        inst.Type,
			Description: inst.Description,
			Config:      inst.Config,
		}
		return inst.Name, inst.Type, nil
	}

	// 2. executor.type (+config)：内联匿名实例（条目本来即节点专属，直接注入镜像）
	if pkg.Executor.Type != "" {
		name := node.Name + "-executor"
		cfg := pkg.Executor.Config
		if isContainerExecutor(pkg.Executor.Type) && image != "" && configImage(cfg) != image {
			cfg = copyExecutorConfig(cfg)
			cfg["image"] = image
		}
		executors[name] = core.ExecutorConfig{
			Type:   pkg.Executor.Type,
			Config: cfg,
		}
		return name, pkg.Executor.Type, nil
	}

	// 3. 未声明：有 image 归为 docker，无 image 走全局默认执行器
	if image != "" {
		// 默认执行器是 docker 且镜像一致时复用其实例（继承 host/registry 等配置）；
		// 镜像不同则继承实例配置合成节点专属条目；无 docker 默认时匿名 docker
		if resolve != nil {
			if def, err := resolve("", true); err == nil && def != nil && def.Type == "docker" {
				if configImage(def.Config) == image {
					if name := findCompatibleExecutor(executors, def.Type, def.Config); name != "" {
						return name, "docker", nil
					}
					executors[def.Name] = core.ExecutorConfig{
						Type:        def.Type,
						Description: def.Description,
						Config:      def.Config,
					}
					return def.Name, "docker", nil
				}
				cfg := copyExecutorConfig(def.Config)
				cfg["image"] = image
				if name := findCompatibleExecutor(executors, "docker", cfg); name != "" {
					return name, "docker", nil
				}
				name := node.Name + "-executor"
				executors[name] = core.ExecutorConfig{
					Type:        "docker",
					Description: def.Description,
					Config:      cfg,
				}
				return name, "docker", nil
			}
		}
		name := node.Name + "-executor"
		executors[name] = core.ExecutorConfig{Type: "docker", Config: map[string]interface{}{"image": image}}
		return name, "docker", nil
	}

	if resolve != nil {
		def, err := resolve("", true)
		if err != nil {
			return "", "", err
		}
		if name := findCompatibleExecutor(executors, def.Type, def.Config); name != "" {
			return name, def.Type, nil
		}
		executors[def.Name] = core.ExecutorConfig{
			Type:        def.Type,
			Description: def.Description,
			Config:      def.Config,
		}
		return def.Name, def.Type, nil
	}

	// 无注册表（测试/兼容场景）：匿名 local
	name := node.Name + "-executor"
	executors[name] = core.ExecutorConfig{Type: "local"}
	return name, "local", nil
}

// nodeImage 节点声明的容器镜像（包配置优先于顶层 legacy 字段）
func nodeImage(pkg *model.NodePackage, node *model.Node) string {
	if pkg.Image != "" {
		return pkg.Image
	}
	return node.Image
}

// isContainerExecutor 是否为容器类执行器（image 配置键对其生效）
func isContainerExecutor(execType string) bool {
	return execType == "docker" || execType == "k8s" || execType == "kubernetes"
}

// configImage 执行器条目 config 中的 image 键（未设置返回空串）
func configImage(c map[string]interface{}) string {
	s, _ := c["image"].(string)
	return s
}

// copyExecutorConfig 浅拷贝执行器 config（注入 image 前防止改到共享的实例配置）
func copyExecutorConfig(c map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(c)+1)
	for k, v := range c {
		out[k] = v
	}
	return out
}

// findCompatibleExecutor 在 executors 中查找与目标类型/配置完全一致的已有条目。
// 续跑修改快照时，新节点的默认执行器解析优先复用快照中已有的同型同配条目，
// 避免往 Executors（不可变字段，仅允许新增）里写入冗余条目。
// 返回空串表示无可复用条目。多个命中时按名称排序取第一个，保证确定性。
func findCompatibleExecutor(executors map[string]core.ExecutorConfig, execType string, config map[string]interface{}) string {
	names := make([]string, 0, len(executors))
	for name := range executors {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		ex := executors[name]
		if ex.Type != execType {
			continue
		}
		if reflect.DeepEqual(normalizeConfigMap(ex.Config), normalizeConfigMap(config)) {
			return name
		}
	}
	return ""
}

// normalizeConfigMap 将空 map 归一化为 nil，保证 DeepEqual 稳定
func normalizeConfigMap(m map[string]interface{}) map[string]interface{} {
	if len(m) == 0 {
		return nil
	}
	return m
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
// hasRuntimeAssets 节点是否有 runtime 类资产（不含入口与 ui 资产）
func hasRuntimeAssets(node *model.Node, pkg *model.NodePackage) bool {
	for rel, asset := range node.FileAssets {
		if rel != pkg.Entry && asset.Kind != "ui" {
			return true
		}
	}
	return false
}

// writeAssetFiles 物化入口 + runtime 资产（ui 资产不进执行链路）。
// 入口不在资产库时（迁移的 legacy 节点）回退 heredoc。
func writeAssetFiles(sb *strings.Builder, node *model.Node, pkg *model.NodePackage, fetch func(rel string)) {
	if _, ok := node.FileAssets[pkg.Entry]; ok {
		fetch(pkg.Entry)
	} else {
		writeFileHeredoc(sb, pkg.Entry, node.Code)
	}
	for _, rel := range sortedFileAssets(node.FileAssets) {
		if rel == pkg.Entry || node.FileAssets[rel].Kind == "ui" {
			continue
		}
		fetch(rel)
	}
}

// writeFileHeredoc 生成 heredoc 写文件命令（legacy 路径）
func writeFileHeredoc(sb *strings.Builder, name, content string) {
	fmt.Fprintf(sb, "cat > %s << 'FLOWX_FILE_EOF'\n", name)
	sb.WriteString(content)
	if !strings.HasSuffix(content, "\n") {
		sb.WriteString("\n")
	}
	sb.WriteString("FLOWX_FILE_EOF\n")
}

// shellQuote 单引号包裹，内部单引号转义为 '\''
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// sortedKeys 返回 map 的有序键（保证展开输出确定，便于测试与 diff）
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// sortedFileAssets 返回资产索引的有序路径
func sortedFileAssets(m map[string]model.NodeFileAsset) []string {
	return sortedKeys(m)
}

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
