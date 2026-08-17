package cli

import "fmt"

// schemas 保存各写入类子命令参数的 JSON Schema（--schema 输出，契约层披露）。
var schemas = map[string]string{
	"pipeline create": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio pipeline create",
  "type": "object",
  "properties": {
    "name":        {"type": "string", "description": "流水线名称（必填）"},
    "file":        {"type": "string", "description": "FlowX YAML 文件路径，'-' 表示 stdin（必填）。YAML 要求：Name 非空；Nodes 为非空 map；Graph 以 stateDiagram-v2 开头且至少一条迁移；executor 必须在 Executors 中定义；节点可用 config.nodeRef 引用已导入节点包"},
    "description": {"type": "string", "description": "描述"},
    "intent":      {"type": "string", "description": "意图说明"},
    "status":      {"type": "string", "enum": ["draft", "active", "archived"], "default": "draft"}
  },
  "required": ["name", "file"]
}`,
	"pipeline update": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio pipeline update",
  "type": "object",
  "properties": {
    "id":          {"type": "integer", "description": "流水线 ID（必填）"},
    "name":        {"type": "string", "description": "名称；省略时保留原值"},
    "file":        {"type": "string", "description": "FlowX YAML 文件路径，'-' 表示 stdin；省略时保留原 YAML。校验规则同 pipeline create"},
    "description": {"type": "string", "description": "描述；省略时保留原值"},
    "intent":      {"type": "string", "description": "意图说明；省略时保留原值"},
    "status":      {"type": "string", "enum": ["draft", "active", "archived"], "description": "省略时保留原值"}
  },
  "required": ["id"]
}`,
	"pipeline delete": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio pipeline delete",
  "type": "object",
  "properties": {
    "id": {"type": "integer", "description": "流水线 ID（必填）"}
  },
  "required": ["id"]
}`,
	"pipeline run": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio pipeline run",
  "type": "object",
  "properties": {
    "id":     {"type": "integer", "description": "流水线 ID（必填）"},
    "follow": {"type": "boolean", "default": false, "description": "跟随 SSE 日志流直到执行结束；执行失败时以退出码 1 结束"}
  },
  "required": ["id"]
}`,
	"node create": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio node create",
  "type": "object",
  "properties": {
    "file": {"type": "string", "description": "节点定义文件（YAML/JSON），'-' 表示 stdin（必填）。字段：name（必填）、language、code/entry/files、nodeType（code|image）、image、parameters[{name,type,description,required,default}]、outputs、tags、mock{enabled,entry,code}"}
  },
  "required": ["file"]
}`,
	"node delete": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio node delete",
  "type": "object",
  "properties": {
    "id": {"type": "integer", "description": "节点 ID（必填）"}
  },
  "required": ["id"]
}`,
	"node import": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio node import",
  "type": "object",
  "properties": {
    "type": {"type": "string", "enum": ["git", "folder"], "description": "来源类型（必填）"},
    "url":  {"type": "string", "description": "Git 仓库 URL（type=git 时必填）"},
    "path": {"type": "string", "description": "本地目录路径（type=folder 时必填），目录下须包含合法的 flowx.json"}
  },
  "required": ["type"]
}`,
	"node mock": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio node mock",
  "type": "object",
  "properties": {
    "id":      {"type": "integer", "description": "节点 ID（必填）"},
    "params":  {"type": "string", "description": "JSON 对象字符串，键值均为 string，如 '{\"url\":\"https://x\"}'"},
    "timeout": {"type": "integer", "description": "超时秒数（默认 30，最大 300）"}
  },
  "required": ["id"]
}`,
	"ask": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio ask",
  "type": "object",
  "properties": {
    "key":     {"type": "string", "description": "答案输出时的键名（必填）"},
    "prompt":  {"type": "string", "description": "向用户展示的问题（必填）"},
    "options": {"type": "string", "description": "逗号分隔的候选项，提供后用户必须从中选择"},
    "default": {"type": "string", "description": "用户直接回车时的默认值"}
  },
  "required": ["key", "prompt"]
}`,
	"info": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio info",
  "type": "object",
  "properties": {
    "title":   {"type": "string", "description": "卡片标题（必填）"},
    "message": {"type": "string", "description": "卡片正文（必填）"},
    "level":   {"type": "string", "enum": ["info", "warn", "error"], "default": "info"}
  },
  "required": ["title", "message"]
}`,
}

// maybePrintSchema 在 --schema 生效时打印该命令的参数 JSON Schema 并返回 true。
func maybePrintSchema(commandPath string) bool {
	if !ShowSchema {
		return false
	}
	if s, ok := schemas[commandPath]; ok {
		fmt.Println(s)
	} else {
		fmt.Println(`{"type":"object","description":"no schema available for this command"}`)
	}
	return true
}
