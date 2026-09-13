package runtime

import (
	"fmt"
	"net/url"
	"path"
	"reflect"
	"sort"
	"strings"

	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx/core"
	"gopkg.in/yaml.v3"
)

// ExpandNodeToConfig 将 model.Node 展开为 flowx 核心的 NodeConfig
// paramBindings 为 workflow YAML 中 config.params 提供的参数绑定（接线）：
// 值可以是常量，也可以是引用 workflow 级 Param / 上游节点输出的模板
//（如 {{ Param.project_dir }}/backend、{{ GetWeather.city }}）。
// 绑定与节点包 env 模板原样写入物化节点的 params/env，由 dag 运行时统一渲染。
func ExpandNodeToConfig(node *model.Node, paramBindings ...map[string]string) (*core.NodeConfig, error) {
	return expandNodeWithExecutorType(node, "", paramBindings...)
}

// expandNodeWithExecutorType 同 ExpandNodeToConfig，但允许调用方覆盖执行器类型。
// 覆盖值来自执行器实例解析（executor.ref / 默认执行器），影响资产引导路径的选择
// （local → cp 物化；docker → 签名 URL 拉取）。空字符串表示按节点包自身声明推断。
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

	// 环境变量不再拼接 export 行进脚本：模板原样写入物化节点的 env，
	// 由 dag 在节点作用域（params 绑定优先）渲染后，经执行器以真实进程
	// 环境变量注入——不经 shell 解析，值中的引号/换行/特殊字符天然安全
	envMap := buildEnvMap(node, pkg)

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
		// AssetURL 形如 http://host/api/v1/assets/nodes/<name>@<ver>?expires=..&sig=..
		// 文件路径必须插在查询串之前（路由 /:nodeRef/*filepath），
		// 直接往末尾追加会污染 sig 参数导致验签 403。
		// flowx_fetch <完整URL> <本地相对路径>；curl 优先，wget 次之，python3(urllib) 兑底
		//（python:*-slim 镜像 curl/wget 都没有，但 python3 必然存在）
		runScript.WriteString("flowx_fetch() { curl -fsSL \"$1\" -o \"$2\" 2>/dev/null || wget -qO \"$2\" \"$1\" 2>/dev/null || python3 -c 'import sys,urllib.request;urllib.request.urlretrieve(sys.argv[1],sys.argv[2])' \"$1\" \"$2\"; }\n")
		writeAssetFetch := func(rel string) {
			if dir := path.Dir(rel); dir != "." {
				fmt.Fprintf(&runScript, "mkdir -p %s\n", shellQuote(dir))
			}
			fmt.Fprintf(&runScript, "flowx_fetch %s %s\n", shellQuote(assetFileURL(node.AssetURL, rel)), shellQuote(rel))
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
	// run 命令模板原样保留 {{ Param.x }} 引用，dag 运行时统一渲染
	runScript.WriteString(cmd)
	if !strings.HasSuffix(cmd, "\n") {
		runScript.WriteString("\n")
	}

	nodeConfig := map[string]interface{}{
		// 物化节点记录完整引用 name@version：快照是执行实例的事实来源，
		// 精确版本保证回放展示与续跑比对可还原到具体节点版本
		"nodeRef": model.FormatNodeRef(node.Name, node.Version),
	}
	if len(bindings) > 0 {
		// 保留原始参数绑定（常量或 {{ 上游.输出 }} 模板原样）：快照导出后
		// 供前端回放态展示节点参数；dag 渲染本节点模板时以此作为节点级
		// 参数作用域（优先于 workflow 级 Param），运行时统一求值
		nodeConfig["params"] = bindings
	}
	if len(envMap) > 0 {
		// 节点包 env 模板原样下发，dag 渲染后经执行器真实注入（见上）
		nodeConfig["env"] = envMap
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
		Config: nodeConfig,
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

// ExecutorTypeResolver 按类型选择注册执行器实例（docker 可多实例）；
// 没有该类型实例时返回 nil。由 ExecutorService 实现。
type ExecutorTypeResolver func(execType string) (*model.Executor, error)

// ExpandWorkflowConfig 展开工作流 YAML 中的 nodeRef 引用。
// 保持旧签名供测试/兼容场景使用；需要按类型选择注册执行器时使用
// ExpandWorkflowConfigWithTypeResolver。
func ExpandWorkflowConfig(configYAML string, lookup func(name string) (*model.Node, error), resolvers ...ExecutorResolver) (string, error) {
	var resolve ExecutorResolver
	if len(resolvers) > 0 {
		resolve = resolvers[0]
	}
	return expandWorkflowConfig(configYAML, lookup, resolve, nil)
}

// ExpandWorkflowConfigWithTypeResolver 展开 nodeRef，并支持 workflow 对每个节点
// 通过 config.executor 选择执行器类型或具体执行器实例。
func ExpandWorkflowConfigWithTypeResolver(configYAML string, lookup func(name string) (*model.Node, error), resolve ExecutorResolver, resolveType ExecutorTypeResolver) (string, error) {
	return expandWorkflowConfig(configYAML, lookup, resolve, resolveType)
}

// expandWorkflowConfig 展开工作流 YAML 中的 nodeRef 引用
//
// 执行器解析优先级（对每个 nodeRef 节点）：
//  1. workflow YAML 的 config.executor 显式选择（type 或 ref，需被节点 supportedTypes 允许）
//  2. flowx.json 旧版 executor.ref → 引用注册的执行器实例（多节点共享同一 Executors 条目）
//  3. flowx.json 旧版 executor.type (+config) → 内联匿名实例（合成 <node名>-executor）
//  4. flowx.json supportedTypes/preferredType → 按偏好选择可用类型，不可用时按声明顺序降级
//  5. 均未声明 → 有 image 归为 docker（默认执行器是 docker 时复用其实例，否则匿名 docker）；
//     无 image 使用全局默认执行器
//
// resolvers 缺省时回退到旧行为（匿名实例合成），便于不挂执行器注册表的场景（测试等）。
func expandWorkflowConfig(configYAML string, lookup func(name string) (*model.Node, error), resolve ExecutorResolver, resolveType ExecutorTypeResolver) (string, error) {

	var cfg core.WorkflowConfig
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
		selection, err := parseExecutorSelection(nodeName, nodeCfg.Config)
		if err != nil {
			return "", err
		}

		// 解析执行器：workflow 显式选择 → ref → 内联 → 偏好/降级 → 默认/docker
		execName, execType, err := resolveNodeExecutor(node, executors, resolve, resolveType, selection)
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
// （flowx core 执行器按名单例，镜像不同即不同容器）。优先级：节点 image > 条目 config.image。
// 共享条目（ref 实例 / 默认实例）在镜像不一致时复制出节点专属条目，避免不同镜像的
// 节点互相覆盖同一共享容器。
func resolveNodeExecutor(node *model.Node, executors map[string]core.ExecutorConfig, resolve ExecutorResolver, resolveType ExecutorTypeResolver, selection *nodeExecutorSelection) (string, string, error) {
	pkg := node.PackageConfig
	if pkg == nil {
		pkg = &model.NodePackage{Image: node.Image}
	}
	image := nodeImage(pkg, node)

	// 0. workflow YAML 显式选择：config.executor 可为 "local"/"docker"、实例名，
	// 或 {type: docker, ref: docker-gpu}。选择类型必须被节点 supportedTypes 允许。
	if selection != nil {
		if selection.Ref != "" {
			if resolve == nil {
				return "", "", fmt.Errorf("workflow selects executor %q but no executor registry is available", selection.Ref)
			}
			inst, err := resolve(selection.Ref, false)
			if err != nil {
				return "", "", err
			}
			if selection.Type != "" && inst.Type != selection.Type {
				return "", "", fmt.Errorf("workflow selects executor %q of type %q, want %q", selection.Ref, inst.Type, selection.Type)
			}
			if err := ensureExecutorTypeAllowed(node.Name, pkg, inst.Type); err != nil {
				return "", "", err
			}
			return addRegisteredExecutor(node, image, inst, executors), inst.Type, nil
		}
		if selection.Type != "" {
			if err := ensureExecutorTypeAllowed(node.Name, pkg, selection.Type); err != nil {
				return "", "", err
			}
			if resolveType != nil {
				inst, err := resolveType(selection.Type)
				if err != nil {
					return "", "", err
				}
				if inst != nil {
					return addRegisteredExecutor(node, image, inst, executors), inst.Type, nil
				}
			}
			return addAnonymousExecutor(node, selection.Type, image, pkg.Executor.Config, executors), selection.Type, nil
		}
	}

	// 1. 旧版 executor.ref：引用注册的执行器实例
	if pkg.Executor.Ref != "" {
		if resolve == nil {
			return "", "", fmt.Errorf("node declares executor.ref %q but no executor registry is available", pkg.Executor.Ref)
		}
		inst, err := resolve(pkg.Executor.Ref, false)
		if err != nil {
			return "", "", err
		}
		return addRegisteredExecutor(node, image, inst, executors), inst.Type, nil
	}

	// 2. 旧版 executor.type (+config)：内联匿名实例（条目本来即节点专属，直接注入镜像）
	if pkg.Executor.Type != "" {
		return addAnonymousExecutor(node, pkg.Executor.Type, image, pkg.Executor.Config, executors), pkg.Executor.Type, nil
	}

	// 3. portable 声明：supportedTypes + preferredType。优先 preferred；该类型没有
	// 注册实例时按 supportedTypes 声明顺序降级到其他类型。所有类型都没有实例时，
	// 使用偏好类型合成匿名执行器（docker 会注入节点 image/config）。
	if candidates := portableExecutorCandidates(pkg); len(candidates) > 0 {
		if resolveType != nil {
			for _, execType := range candidates {
				inst, err := resolveType(execType)
				if err != nil {
					return "", "", err
				}
				if inst != nil {
					return addRegisteredExecutor(node, image, inst, executors), inst.Type, nil
				}
			}
		}
		return addAnonymousExecutor(node, candidates[0], image, pkg.Executor.Config, executors), candidates[0], nil
	}

	// 4. 未声明：有 image 归为 docker，无 image 走全局默认执行器
	if image != "" {
		// 默认执行器是 docker 且镜像一致时复用其实例（继承 host/registry 等配置）；
		// 镜像不同则继承实例配置合成节点专属条目；无 docker 默认时匿名 docker
		if resolve != nil {
			if def, err := resolve("", true); err == nil && def != nil && def.Type == "docker" {
				return addRegisteredExecutor(node, image, def, executors), "docker", nil
			}
		}
		return addAnonymousExecutor(node, "docker", image, nil, executors), "docker", nil
	}

	if resolve != nil {
		def, err := resolve("", true)
		if err != nil {
			return "", "", err
		}
		return addRegisteredExecutor(node, image, def, executors), def.Type, nil
	}

	// 无注册表（测试/兼容场景）：匿名 local
	return addAnonymousExecutor(node, "local", image, nil, executors), "local", nil
}

// nodeExecutorSelection workflow YAML 中单个 nodeRef 节点的执行器选择。
// Ref 是用户环境中的具体执行器实例名；Type 是 local/docker 类型级选择。
type nodeExecutorSelection struct {
	Ref  string
	Type string
}

// parseExecutorSelection 解析 config.executor。支持三种写法：
//
//	executor: local                 # 类型级选择
//	executor: docker-gpu            # 具体实例（字符串形式下 local/docker 保留为类型名）
//	executor: {type: docker, ref: docker-gpu}
func parseExecutorSelection(nodeName string, config map[string]interface{}) (*nodeExecutorSelection, error) {
	if config == nil {
		return nil, nil
	}
	raw, ok := config["executor"]
	if !ok || raw == nil {
		return nil, nil
	}

	switch v := raw.(type) {
	case string:
		s := strings.ToLower(strings.TrimSpace(v))
		if s == "" {
			return nil, nil
		}
		if s == "local" || s == "docker" {
			return &nodeExecutorSelection{Type: s}, nil
		}
		return &nodeExecutorSelection{Ref: strings.TrimSpace(v)}, nil
	case map[string]interface{}:
		selection := &nodeExecutorSelection{}
		for key, value := range v {
			s, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("node %s: config.executor.%s must be a string", nodeName, key)
			}
			switch key {
			case "type":
				selection.Type = strings.ToLower(strings.TrimSpace(s))
			case "ref":
				selection.Ref = strings.TrimSpace(s)
			default:
				return nil, fmt.Errorf("node %s: unknown config.executor key %q (supported: type, ref)", nodeName, key)
			}
		}
		if selection.Type != "" && selection.Type != "local" && selection.Type != "docker" {
			return nil, fmt.Errorf("node %s: unsupported config.executor.type %q (only local and docker are supported)", nodeName, selection.Type)
		}
		if selection.Type == "" && selection.Ref == "" {
			return nil, nil
		}
		return selection, nil
	default:
		return nil, fmt.Errorf("node %s: config.executor must be a string or a map with type/ref", nodeName)
	}
}

// portableExecutorCandidates 返回节点包声明的执行器类型候选顺序：preferredType 第一，
// 其余 supportedTypes 保持声明顺序。
func portableExecutorCandidates(pkg *model.NodePackage) []string {
	if len(pkg.Executor.SupportedTypes) == 0 {
		return nil
	}
	out := make([]string, 0, len(pkg.Executor.SupportedTypes))
	if pkg.Executor.PreferredType != "" {
		out = append(out, pkg.Executor.PreferredType)
	}
	for _, execType := range pkg.Executor.SupportedTypes {
		if execType != pkg.Executor.PreferredType {
			out = append(out, execType)
		}
	}
	return out
}

// ensureExecutorTypeAllowed 校验 workflow 选择的类型是否被节点包允许。
// 旧节点未声明 supportedTypes 时不做限制，保持兼容。
func ensureExecutorTypeAllowed(nodeName string, pkg *model.NodePackage, execType string) error {
	if len(pkg.Executor.SupportedTypes) == 0 {
		return nil
	}
	for _, allowed := range pkg.Executor.SupportedTypes {
		if allowed == execType {
			return nil
		}
	}
	return fmt.Errorf("node %s does not support executor type %q (supportedTypes: %v)", nodeName, execType, pkg.Executor.SupportedTypes)
}

// addRegisteredExecutor 把注册实例写入 Executors；容器执行器在镜像不一致时复制配置
// 并合成节点专属条目，避免修改共享实例。
func addRegisteredExecutor(node *model.Node, image string, inst *model.Executor, executors map[string]core.ExecutorConfig) string {
	// 同名条目已存在（如续跑快照中的 local）时原样复用：快照的 Executors
	// 只允许新增、不可改删（validateExecutorsAdditive），覆盖实例配置会导致
	// UpdateConfig 校验报 executor cannot be modified
	if _, exists := executors[inst.Name]; exists {
		return inst.Name
	}
	if isContainerExecutor(inst.Type) && image != "" && configImage(inst.Config) != image {
		cfg := copyExecutorConfig(inst.Config)
		cfg["image"] = image
		if name := findCompatibleExecutor(executors, inst.Type, cfg); name != "" {
			return name
		}
		name := node.Name + "-executor"
		executors[name] = core.ExecutorConfig{Type: inst.Type, Description: inst.Description, Config: cfg}
		return name
	}
	executors[inst.Name] = core.ExecutorConfig{
		Type:        inst.Type,
		Description: inst.Description,
		Config:      inst.Config,
	}
	return inst.Name
}

// addAnonymousExecutor 合成节点专属匿名执行器条目并注入节点镜像。
func addAnonymousExecutor(node *model.Node, execType, image string, config map[string]interface{}, executors map[string]core.ExecutorConfig) string {
	name := node.Name + "-executor"
	cfg := config
	if isContainerExecutor(execType) && image != "" && configImage(cfg) != image {
		cfg = copyExecutorConfig(cfg)
		cfg["image"] = image
	}
	executors[name] = core.ExecutorConfig{Type: execType, Config: cfg}
	return name
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

// parseParamBindings 从 workflow YAML 的节点 config.params 中提取参数绑定。
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

// shellQuote 单引号包裹，内部单引号转义为 '\”
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// assetFileURL 把包内相对路径插入签名资产 URL 的查询串之前：
// <base>/<name>@<ver>/<rel>?expires=..&sig=..（路径段逐段转义）。
// 路由为 /api/v1/assets/nodes/:nodeRef/*filepath，路径必须在 ? 之前。
func assetFileURL(assetURL, rel string) string {
	escaped := make([]string, 0, 4)
	for _, seg := range strings.Split(rel, "/") {
		escaped = append(escaped, url.PathEscape(seg))
	}
	p := strings.Join(escaped, "/")
	if i := strings.IndexByte(assetURL, '?'); i >= 0 {
		return assetURL[:i] + "/" + p + assetURL[i:]
	}
	return assetURL + "/" + p
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

// validateBindings 校验 workflow 层绑定的参数名都已在节点包 parameters 中声明
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


