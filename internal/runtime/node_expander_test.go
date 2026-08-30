package runtime

import (
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/model"
)

func newTestNode(pkg *model.NodePackage) *model.Node {
	return &model.Node{
		Name:          pkg.Name,
		DisplayName:   pkg.DisplayName,
		Language:      pkg.Language,
		Entry:         pkg.Entry,
		Code:          "print('hi')\n",
		Parameters:    pkg.Parameters,
		Outputs:       pkg.Outputs,
		PackageConfig: pkg,
	}
}

func TestExpandNodeToConfig_ParamBindings(t *testing.T) {
	pkg := &model.NodePackage{
		Name:     "send-feishu",
		Language: "python",
		Entry:    "main.py",
		Parameters: []model.NodeParameter{
			{Name: "feishuAppId", Type: "string", Required: true},
			{Name: "weatherCity", Type: "string", Required: true,
				Source: &model.ParamSource{NodeRef: "get-weather", Output: "city"}},
			{Name: "weatherForecasts", Type: "array",
				Source: &model.ParamSource{NodeRef: "get-weather", Output: "forecasts"}},
			{Name: "title", Type: "string"},
		},
		Env: map[string]string{
			"FEISHU_APP_ID":     "{{ Param.feishuAppId }}",
			"WEATHER_CITY":      "{{ Param.weatherCity }}",
			"WEATHER_FORECASTS": "{{ Param.weatherForecasts | toYaml }}",
		},
		Run: "python3 main.py --title '{{ Param.title }}'",
	}

	bindings := map[string]string{
		"weatherCity":      "{{ GetWeather.city }}",
		"weatherForecasts": "{{ GetWeather.forecasts }}",
		"title":            "每日播报",
	}

	cfg, err := ExpandNodeToConfig(newTestNode(pkg), bindings)
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	run := cfg.Steps[0].Run

	// 上游节点绑定被内联，且保留过滤器
	if !strings.Contains(run, `export WEATHER_CITY="{{ GetWeather.city }}"`) {
		t.Errorf("expected inlined GetWeather.city binding, run:\n%s", run)
	}
	if !strings.Contains(run, `export WEATHER_FORECASTS="{{ GetWeather.forecasts | toYaml }}"`) {
		t.Errorf("expected filter preserved after binding, run:\n%s", run)
	}
	// 常量绑定转为字符串字面量
	if !strings.Contains(run, `--title '{{ "每日播报" }}'`) {
		t.Errorf("expected constant binding as string literal, run:\n%s", run)
	}
	// 未绑定的参数保留 Param 引用，运行时由 pipeline 级 Param 解析
	if !strings.Contains(run, `export FEISHU_APP_ID="{{ Param.feishuAppId }}"`) {
		t.Errorf("expected unbound param kept as Param reference, run:\n%s", run)
	}
}

func TestExpandNodeToConfig_UndeclaredBinding(t *testing.T) {
	pkg := &model.NodePackage{
		Name:     "send-feishu",
		Language: "python",
		Entry:    "main.py",
		Parameters: []model.NodeParameter{
			{Name: "city", Type: "string"},
		},
	}

	_, err := ExpandNodeToConfig(newTestNode(pkg), map[string]string{"unknown": "x"})
	if err == nil {
		t.Fatal("expected error for undeclared parameter binding")
	}
	if !strings.Contains(err.Error(), "undeclared parameter") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestExpandNodeToConfig_NoBindingsKeepsParamRef(t *testing.T) {
	pkg := &model.NodePackage{
		Name:     "get-weather",
		Language: "python",
		Entry:    "main.py",
		Parameters: []model.NodeParameter{
			{Name: "city", Type: "string", Default: "深圳"},
		},
		Env: map[string]string{"WEATHER_CITY": "{{ Param.city }}"},
	}

	cfg, err := ExpandNodeToConfig(newTestNode(pkg))
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	if !strings.Contains(cfg.Steps[0].Run, `export WEATHER_CITY="{{ Param.city }}"`) {
		t.Errorf("expected Param reference kept, run:\n%s", cfg.Steps[0].Run)
	}
}

func TestExpandNodeToConfig_InlineNodeHeredocEntryOnly(t *testing.T) {
	// 纯内联节点（无资产库）：只有入口 heredoc，不含任何文件遍历产物
	pkg := &model.NodePackage{
		Name:     "inline-node",
		Language: "bash",
		Entry:    "main.sh",
	}
	node := newTestNode(pkg)
	node.Code = "echo inline\n"
	cfg, err := ExpandNodeToConfig(node)
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	run := cfg.Steps[0].Run
	if !strings.Contains(run, "cat > main.sh << 'FLOWX_FILE_EOF'") || !strings.Contains(run, "echo inline") {
		t.Errorf("expected entry heredoc, run:\n%s", run)
	}
	if !strings.Contains(run, "mktemp -d") || strings.Contains(run, "FLOWX_ASSETS_DIR") || strings.Contains(run, "FLOWX_ASSETS_URL") {
		t.Errorf("inline node should use temp workdir without asset bootstrap, run:\n%s", run)
	}
}

func TestExpandNodeToConfig_AssetBackedBootstrap(t *testing.T) {
	pkg := &model.NodePackage{
		Name:     "asset-node",
		Language: "bash",
		Entry:    "main.sh",
	}
	node := newTestNode(pkg)
	node.AssetDir = "/data/assets/nodes/asset-node@1.0.0"
	node.FileAssets = map[string]model.NodeFileAsset{
		"main.sh":           {SHA256: "a", Size: 10, Kind: "runtime"},
		"lib/helper.sh":     {SHA256: "b", Size: 10, Kind: "runtime"},
		"ui/node-widget.js": {SHA256: "c", Size: 999999, Kind: "ui"},
	}

	cfg, err := ExpandNodeToConfig(node)
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	run := cfg.Steps[0].Run

	// 独立工作目录 + 自动清理
	if !strings.Contains(run, "mktemp -d") || !strings.Contains(run, "trap 'rm -rf") {
		t.Errorf("expected isolated temp workdir with cleanup trap, run:\n%s", run)
	}
	// cp 引导而非 heredoc
	if !strings.Contains(run, `FLOWX_ASSETS_DIR='/data/assets/nodes/asset-node@1.0.0'`) {
		t.Errorf("expected assets dir export, run:\n%s", run)
	}
	if !strings.Contains(run, `cp "$FLOWX_ASSETS_DIR/main.sh" 'main.sh'`) {
		t.Errorf("expected entry cp, run:\n%s", run)
	}
	if !strings.Contains(run, `mkdir -p 'lib'`) || !strings.Contains(run, `cp "$FLOWX_ASSETS_DIR/lib/helper.sh" 'lib/helper.sh'`) {
		t.Errorf("expected helper cp with mkdir, run:\n%s", run)
	}
	// 文件内容与 ui 资产不得内联
	if strings.Contains(run, "FLOWX_FILE_EOF") || strings.Contains(run, "node-widget.js") {
		t.Errorf("asset contents / ui files must not be inlined, run:\n%s", run)
	}
}

func TestExpandNodeToConfig_DockerFallsBackToHeredoc(t *testing.T) {
	pkg := &model.NodePackage{
		Name:     "docker-node",
		Language: "bash",
		Entry:    "main.sh",
		Image:    "bash:5",
		Executor: model.NodeExecutorConfig{Type: "docker"},
	}
	node := newTestNode(pkg)
	node.Code = "echo docker\n"
	node.AssetDir = "/data/assets/nodes/docker-node@1"
	node.FileAssets = map[string]model.NodeFileAsset{
		"main.sh": {SHA256: "a", Size: 10, Kind: "runtime"},
	}

	cfg, err := ExpandNodeToConfig(node)
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	run := cfg.Steps[0].Run
	// docker 容器内看不到宿主机资产目录，回退 heredoc
	if !strings.Contains(run, "cat > main.sh << 'FLOWX_FILE_EOF'") || !strings.Contains(run, "echo docker") {
		t.Errorf("expected heredoc fallback for docker executor, run:\n%s", run)
	}
	if strings.Contains(run, "FLOWX_ASSETS_DIR") {
		t.Errorf("docker executor must not reference host asset dir, run:\n%s", run)
	}
}

func TestExpandNodeToConfig_DockerHTTPBootstrap(t *testing.T) {
	pkg := &model.NodePackage{
		Name:     "docker-node",
		Language: "bash",
		Entry:    "main.sh",
		Image:    "bash:5",
		Executor: model.NodeExecutorConfig{Type: "docker"},
	}
	node := newTestNode(pkg)
	node.AssetDir = "/data/assets/nodes/docker-node@1" // 容器内不可用，不得引用
	node.AssetURL = "http://192.168.1.10:8080/api/v1/assets/nodes/docker-node@1?expires=999&sig=abc"
	node.FileAssets = map[string]model.NodeFileAsset{
		"main.sh":           {SHA256: "a", Size: 10, Kind: "runtime"},
		"lib/helper.sh":     {SHA256: "b", Size: 10, Kind: "runtime"},
		"ui/node-widget.js": {SHA256: "c", Size: 10, Kind: "ui"},
	}

	cfg, err := ExpandNodeToConfig(node)
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	run := cfg.Steps[0].Run

	if !strings.Contains(run, "FLOWX_ASSETS_URL='http://192.168.1.10:8080/api/v1/assets/nodes/docker-node@1?expires=999&sig=abc'") {
		t.Errorf("expected signed assets url, run:\n%s", run)
	}
	if !strings.Contains(run, "flowx_fetch 'main.sh'") || !strings.Contains(run, "flowx_fetch 'lib/helper.sh'") {
		t.Errorf("expected curl/wget fetch for entry and runtime deps, run:\n%s", run)
	}
	if strings.Contains(run, "FLOWX_ASSETS_DIR") || strings.Contains(run, "FLOWX_FILE_EOF") || strings.Contains(run, "node-widget.js") {
		t.Errorf("http bootstrap must not reference host dir / inline contents / ui files, run:\n%s", run)
	}
}

func TestExpandNodeToConfig_DockerRuntimeDepsRequireSignedURL(t *testing.T) {
	// docker/k8s + runtime 依赖 + 无签名 URL → 展开报错（而不是静默缺文件）
	pkg := &model.NodePackage{
		Name:     "docker-node",
		Language: "bash",
		Entry:    "main.sh",
		Image:    "bash:5",
		Executor: model.NodeExecutorConfig{Type: "docker"},
	}
	node := newTestNode(pkg)
	node.Code = "echo docker\n"
	node.FileAssets = map[string]model.NodeFileAsset{
		"main.sh":       {SHA256: "a", Size: 10, Kind: "runtime"},
		"lib/helper.sh": {SHA256: "b", Size: 10, Kind: "runtime"},
	}

	_, err := ExpandNodeToConfig(node)
	if err == nil || !strings.Contains(err.Error(), "assets.http_base") {
		t.Errorf("expected signed-url error, got %v", err)
	}
}

func TestExpandNodeToConfig_DockerEntryOnlyNoURL(t *testing.T) {
	// docker + 仅入口资产（无额外 runtime 依赖）→ heredoc 入口即可运行
	pkg := &model.NodePackage{
		Name:     "docker-node",
		Language: "bash",
		Entry:    "main.sh",
		Image:    "bash:5",
		Executor: model.NodeExecutorConfig{Type: "docker"},
	}
	node := newTestNode(pkg)
	node.Code = "echo docker\n"
	node.FileAssets = map[string]model.NodeFileAsset{
		"main.sh": {SHA256: "a", Size: 10, Kind: "runtime"},
	}

	cfg, err := ExpandNodeToConfig(node)
	if err != nil {
		t.Fatalf("expand failed: %v", err)
	}
	run := cfg.Steps[0].Run
	if !strings.Contains(run, "cat > main.sh << 'FLOWX_FILE_EOF'") || !strings.Contains(run, "echo docker") {
		t.Errorf("expected entry heredoc, run:\n%s", run)
	}
}
