package cli

import "fmt"

// schemas 保存各写入类子命令参数的 JSON Schema（--schema 输出，契约层披露）。
var schemas = map[string]string{
	"workflow create": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio workflow create",
  "type": "object",
  "properties": {
    "name":        {"type": "string", "description": "流水线名称（必填）"},
    "file":        {"type": "string", "description": "FlowX YAML 文件路径，'-' 表示 stdin（必填）。YAML 要求：Name 非空；Nodes 为非空 map；Graph 以 stateDiagram-v2 开头且至少一条迁移；内联节点 executor 必须在 Executors 中定义；节点可用 config.nodeRef 引用已导入节点包，并可用 config.executor 选择执行器类型（local/docker）或具体实例 ref"},
    "description": {"type": "string", "description": "描述"},
    "intent":      {"type": "string", "description": "意图说明"},
    "status":      {"type": "string", "enum": ["draft", "active", "archived"], "default": "draft"}
  },
  "required": ["name", "file"]
}`,
	"workflow update": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio workflow update",
  "type": "object",
  "properties": {
    "id":          {"type": "integer", "description": "流水线 ID（必填）"},
    "name":        {"type": "string", "description": "名称；省略时保留原值"},
    "file":        {"type": "string", "description": "FlowX YAML 文件路径，'-' 表示 stdin；省略时保留原 YAML。校验规则同 workflow create"},
    "description": {"type": "string", "description": "描述；省略时保留原值"},
    "intent":      {"type": "string", "description": "意图说明；省略时保留原值"},
    "status":      {"type": "string", "enum": ["draft", "active", "archived"], "description": "省略时保留原值"}
  },
  "required": ["id"]
}`,
	"workflow delete": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio workflow delete",
  "type": "object",
  "properties": {
    "id": {"type": "integer", "description": "流水线 ID（必填）"}
  },
  "required": ["id"]
}`,
	"workflow run": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio workflow run",
  "type": "object",
  "properties": {
    "id":     {"type": "integer", "description": "流水线 ID（必填）"},
    "follow": {"type": "boolean", "default": false, "description": "跟随 SSE 日志流直到执行结束；执行失败时以退出码 1 结束"}
  },
  "required": ["id"]
}`,
	"execution continue": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio execution continue",
  "type": "object",
  "properties": {
    "id":     {"type": "integer", "description": "执行实例 ID（必填）；仅 success/failed/cancelled 状态的实例可续跑"},
    "file":   {"type": "string", "description": "新的 FlowX YAML 文件路径，'-' 表示 stdin（可选）。提供时先比对差异更新执行实例的图（追加节点/修改未运行节点；Version/Name 等不可变字段必须与原配置一致），再增量续跑：已终结节点跳过，仅执行新增/未运行节点"},
    "follow": {"type": "boolean", "default": false, "description": "跟随 SSE 日志流直到续跑结束（不能与 no-run 同用）"},
    "noRun":  {"type": "boolean", "default": false, "description": "仅更新执行实例的快照图、不立即执行（必须与 file 同用）；之后可再调用本命令（不带 file）按需续跑新增节点"}
  },
  "required": ["id"]
}`,
	"execution pause": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio execution pause",
  "type": "object",
  "properties": {
    "id": {"type": "integer", "description": "执行实例 ID（必填）；仅 running 状态的实例可暂停。层边界暂停：当前并发层节点执行完后挂起，不中断运行中的节点"}
  },
  "required": ["id"]
}`,
	"execution cancel": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio execution cancel",
  "type": "object",
  "properties": {
    "id": {"type": "integer", "description": "执行实例 ID（必填）；running/paused 状态的实例可取消。真终止：运行中的节点进程被杀死，执行置为 cancelled，可用 execution continue 增量续跑"}
  },
  "required": ["id"]
}`,
	"execution resume": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio execution resume",
  "type": "object",
  "properties": {
    "id":     {"type": "integer", "description": "执行实例 ID（必填）；仅 paused 状态的实例可恢复。暂停时已导出运行时快照，server 重启后会自动从快照重建并增量续跑（已终结节点跳过，崩溃时 RUNNING 的节点重跑）"},
    "follow": {"type": "boolean", "default": false, "description": "跟随 SSE 日志流直到执行结束"}
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
	"node update": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio node update",
  "type": "object",
  "properties": {
    "id":   {"type": "integer", "description": "节点 ID（必填）；原地更新，ID 不变"},
    "file": {"type": "string", "description": "节点定义文件（YAML/JSON），'-' 表示 stdin（必填）。字段同 node create；定义为全量替换，省略的字段会被清空（例外：packageConfig/fileAssets 不可经 API 设置，省略时保留原值）"}
  },
  "required": ["id", "file"]
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
    "type":      {"type": "string", "enum": ["git", "folder"], "description": "来源类型（必填）"},
    "url":       {"type": "string", "description": "Git 仓库 URL（type=git 时必填）"},
    "path":      {"type": "string", "description": "本地目录路径（type=folder 时必填），目录下须包含合法的 flowx.json"},
    "overwrite": {"type": "boolean", "default": false, "description": "同名节点已存在时原地更新（保持节点 ID 不变），无需先 delete；为 false 时同名冲突报错"}
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
	"server start": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio server start",
  "type": "object",
  "properties": {
    "port": {"type": "integer", "default": 8080, "description": "HTTP 服务端口"},
    "host": {"type": "string", "default": "0.0.0.0", "description": "监听地址"}
  }
}`,
	"executor create": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio executor create",
  "type": "object",
  "properties": {
    "file": {"type": "string", "description": "执行器定义文件（YAML/JSON），'-' 表示 stdin（必填）。字段：name（必填，字母开头）、type（必填，local|docker；local 全局限一个、docker 可多个；k8s 暂不支持）、description、config（对象；docker 支持 host/tlsVerify/certPath/registry/network/workdir/volumes/env/tty，local 支持 shell/workdir/timeout/env/pty）"}
  },
  "required": ["file"]
}`,
	"executor update": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio executor update",
  "type": "object",
  "properties": {
    "id":   {"type": "integer", "description": "执行器 ID（必填）"},
    "file": {"type": "string", "description": "执行器定义文件（YAML/JSON），'-' 表示 stdin（必填）。仅 description/config 可更新；name 与 type 不可变更"}
  },
  "required": ["id", "file"]
}`,
	"executor delete": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio executor delete",
  "type": "object",
  "properties": {
    "id": {"type": "integer", "description": "执行器 ID（必填）；默认执行器禁止删除，请先 executor set-default 切换"}
  },
  "required": ["id"]
}`,
	"executor set-default": `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "flowx-studio executor set-default",
  "type": "object",
  "properties": {
    "id": {"type": "integer", "description": "执行器 ID（必填）；设为全局默认后，未声明 executor 的 nodeRef 节点将使用它"}
  },
  "required": ["id"]
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
