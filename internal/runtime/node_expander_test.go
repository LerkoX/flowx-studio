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
