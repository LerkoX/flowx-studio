package cli

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// yaml 命令组：流水线模板 / 执行快照 YAML 的本地结构化读写。
// 纯文件操作，不访问 server；面向长 YAML 的局部编辑场景——
// 查询只输出相关片段，修改按结构操作（节点/边），避免全量 YAML 进出上下文。
// 注意：写操作整体重新编码（map 键按字母序、注释丢失），语义无影响。

// NewYAMLCmd YAML 结构化读写命令组
func NewYAMLCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "yaml",
		Short: "Structurally read/edit a workflow or execution snapshot YAML file (local, no server)",
	}
	cmd.AddCommand(
		newYAMLGraphCmd(),
		newYAMLNodesCmd(),
		newYAMLGetCmd(),
		newYAMLAddNodeCmd(),
		newYAMLAddEdgeCmd(),
		newYAMLRemoveEdgeCmd(),
	)
	return cmd
}

// ---------- 文件读写与结构访问 ----------

func loadYAMLFile(path string) (map[string]interface{}, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", path, err)
	}
	var doc map[string]interface{}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}
	if doc == nil {
		return nil, fmt.Errorf("%s is empty", path)
	}
	return doc, nil
}

func saveYAMLFile(path string, doc map[string]interface{}) error {
	out, err := yaml.Marshal(doc)
	if err != nil {
		return fmt.Errorf("failed to encode YAML: %w", err)
	}
	if err := os.WriteFile(path, out, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", path, err)
	}
	return nil
}

func nodesSection(doc map[string]interface{}) (map[string]interface{}, error) {
	nodes, _ := doc["Nodes"].(map[string]interface{})
	if len(nodes) == 0 {
		return nil, fmt.Errorf("YAML has no (or empty) Nodes section")
	}
	return nodes, nil
}

func graphText(doc map[string]interface{}) (string, error) {
	g, _ := doc["Graph"].(string)
	if strings.TrimSpace(g) == "" {
		return "", fmt.Errorf("YAML has no (or empty) Graph section")
	}
	return g, nil
}

// ---------- Graph（mermaid）行级编辑 ----------

// graphEdge 解析一行 mermaid 迁移：source/target/label（: 后缀原样保留，含前导空格与条件）
type graphEdge struct {
	source string
	target string
	suffix string // ": label" 部分（含冒号），无则为空
}

// parseEdgeLine 解析缩进的 mermaid 行；非迁移行（如 stateDiagram-v2 头）返回 false
func parseEdgeLine(line string) (graphEdge, bool) {
	trimmed := strings.TrimSpace(line)
	idx := strings.Index(trimmed, "-->")
	if idx < 0 {
		return graphEdge{}, false
	}
	source := strings.TrimSpace(trimmed[:idx])
	rest := strings.TrimSpace(trimmed[idx+3:])
	target := rest
	suffix := ""
	// 目标节点 ID 到冒号（label）或行尾为止
	if ci := strings.Index(rest, ":"); ci >= 0 {
		target = strings.TrimSpace(rest[:ci])
		suffix = rest[ci:]
	}
	if source == "" || target == "" {
		return graphEdge{}, false
	}
	return graphEdge{source: source, target: target, suffix: suffix}, true
}

// graphIndent 取首条迁移行的前导缩进，新增边保持同风格
func graphIndent(lines []string) string {
	for _, l := range lines {
		if _, ok := parseEdgeLine(l); ok {
			return l[:len(l)-len(strings.TrimLeft(l, " \t"))]
		}
	}
	return "  "
}

// ---------- 子命令 ----------

// newYAMLGraphCmd 仅打印 Graph 段（mermaid 接线），不输出节点定义
func newYAMLGraphCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "graph <file>",
		Short: "Print only the Graph (mermaid wiring) section of a YAML file",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			doc, err := loadYAMLFile(args[0])
			if err != nil {
				return err
			}
			g, err := graphText(doc)
			if err != nil {
				return err
			}
			fmt.Print(strings.TrimRight(g, "\n") + "\n")
			return nil
		},
	}
}

// newYAMLNodesCmd 节点概要列表（id / 显示名 / nodeRef），不输出 steps 等大字段
func newYAMLNodesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "nodes <file>",
		Short: "List node summary (id, display name, nodeRef) without bulky step bodies",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			doc, err := loadYAMLFile(args[0])
			if err != nil {
				return err
			}
			nodes, err := nodesSection(doc)
			if err != nil {
				return err
			}
			ids := make([]string, 0, len(nodes))
			for id := range nodes {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			for _, id := range ids {
				n, _ := nodes[id].(map[string]interface{})
				name, _ := n["name"].(string)
				ref := ""
				if cfg, ok := n["config"].(map[string]interface{}); ok {
					ref, _ = cfg["nodeRef"].(string)
				}
				fmt.Printf("%s\t%s\t%s\n", id, name, ref)
			}
			return nil
		},
	}
}

// newYAMLGetCmd 打印单个节点的完整 YAML 子树
func newYAMLGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <file> <nodeId>",
		Short: "Print one node's full YAML subtree",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			doc, err := loadYAMLFile(args[0])
			if err != nil {
				return err
			}
			nodes, err := nodesSection(doc)
			if err != nil {
				return err
			}
			n, ok := nodes[args[1]]
			if !ok {
				return fmt.Errorf("node %q not found in Nodes", args[1])
			}
			out, err := yaml.Marshal(map[string]interface{}{args[1]: n})
			if err != nil {
				return err
			}
			fmt.Print(string(out))
			return nil
		},
	}
}

// newYAMLAddNodeCmd 追加编写态节点（config.nodeRef + params），--after 自动接线：
// 将锚点的每条出边 A --> X 改写为 A --> N 与 N --> X（label 保留在 N --> X 上），
// 锚点无出边时追加 A --> N；不带 --after 时仅加节点（Graph 无边，提示用 add-edge）
func newYAMLAddNodeCmd() *cobra.Command {
	var id, ref, name, after string
	var params []string
	cmd := &cobra.Command{
		Use:   "add-node <file>",
		Short: "Append a nodeRef node; --after rewires the anchor's outgoing edges through the new node",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if id == "" {
				return fmt.Errorf("--id is required")
			}
			if ref == "" {
				return fmt.Errorf("--ref is required (e.g. echo or echo@1.1.0)")
			}
			doc, err := loadYAMLFile(args[0])
			if err != nil {
				return err
			}
			nodes, err := nodesSection(doc)
			if err != nil {
				return err
			}
			if _, exists := nodes[id]; exists {
				return fmt.Errorf("node %q already exists in Nodes", id)
			}

			node := map[string]interface{}{}
			if name != "" {
				node["name"] = name
			}
			cfg := map[string]interface{}{"nodeRef": ref}
			if len(params) > 0 {
				pm := map[string]interface{}{}
				for _, kv := range params {
					k, v, found := strings.Cut(kv, "=")
					if !found || k == "" {
						return fmt.Errorf("invalid --param %q, expect key=value", kv)
					}
					pm[k] = v
				}
				cfg["params"] = pm
			}
			node["config"] = cfg
			nodes[id] = node

			if after != "" {
				if _, exists := nodes[after]; !exists {
					return fmt.Errorf("--after anchor %q not found in Nodes", after)
				}
				g, err := graphText(doc)
				if err != nil {
					return err
				}
				lines := strings.Split(strings.TrimRight(g, "\n"), "\n")
				indent := graphIndent(lines)
				var out []string
				targets := []graphEdge{}
				for _, l := range lines {
					e, ok := parseEdgeLine(l)
					if ok && e.source == after {
						targets = append(targets, e)
						continue // 原出边移除，改由新节点承接
					}
					out = append(out, l)
				}
				out = append(out, indent+after+" --> "+id)
				if len(targets) == 0 {
					fmt.Fprintf(os.Stderr, "warning: %s has no outgoing edge; appended %q --> %q only\n", after, after, id)
				}
				for _, t := range targets {
					out = append(out, indent+id+" --> "+t.target+t.suffix)
				}
				doc["Graph"] = strings.Join(out, "\n") + "\n"
			} else {
				fmt.Fprintf(os.Stderr, "note: node added without edges; wire it via `yaml add-edge` or re-run with --after\n")
			}

			if err := saveYAMLFile(args[0], doc); err != nil {
				return err
			}
			fmt.Printf("added node %s (nodeRef=%s)\n", id, ref)
			return nil
		},
	}
	cmd.Flags().StringVar(&id, "id", "", "new node ID, ASCII only (required)")
	cmd.Flags().StringVar(&ref, "ref", "", "nodeRef to reference, e.g. echo or echo@1.1.0 (required)")
	cmd.Flags().StringVar(&name, "name", "", "display name (may be non-ASCII)")
	cmd.Flags().StringArrayVar(&params, "param", nil, "node param binding, key=value, repeatable; values may be constants or {{ NodeId.field }} / {{ Param.key }} templates")
	cmd.Flags().StringVar(&after, "after", "", "anchor node ID: rewire its outgoing edges through the new node (A --> X becomes A --> N --> X)")
	return cmd
}

// newYAMLAddEdgeCmd Graph 加边（幂等：同对的边含带 label 的已存在则跳过）
func newYAMLAddEdgeCmd() *cobra.Command {
	var from, to string
	cmd := &cobra.Command{
		Use:   "add-edge <file>",
		Short: "Add an edge to Graph (idempotent)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if from == "" || to == "" {
				return fmt.Errorf("--from and --to are required")
			}
			doc, err := loadYAMLFile(args[0])
			if err != nil {
				return err
			}
			g, err := graphText(doc)
			if err != nil {
				return err
			}
			lines := strings.Split(strings.TrimRight(g, "\n"), "\n")
			for _, l := range lines {
				if e, ok := parseEdgeLine(l); ok && e.source == from && e.target == to {
					fmt.Printf("edge %s --> %s already exists\n", from, to)
					return nil
				}
			}
			lines = append(lines, graphIndent(lines)+from+" --> "+to)
			doc["Graph"] = strings.Join(lines, "\n") + "\n"
			if err := saveYAMLFile(args[0], doc); err != nil {
				return err
			}
			fmt.Printf("added edge %s --> %s\n", from, to)
			return nil
		},
	}
	cmd.Flags().StringVar(&from, "from", "", "source node ID ([*] allowed)")
	cmd.Flags().StringVar(&to, "to", "", "target node ID ([*] allowed)")
	return cmd
}

// newYAMLRemoveEdgeCmd Graph 删边（按 source/target 对匹配，label 不影响匹配）
func newYAMLRemoveEdgeCmd() *cobra.Command {
	var from, to string
	cmd := &cobra.Command{
		Use:   "remove-edge <file>",
		Short: "Remove edges from Graph by source/target pair",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if from == "" || to == "" {
				return fmt.Errorf("--from and --to are required")
			}
			doc, err := loadYAMLFile(args[0])
			if err != nil {
				return err
			}
			g, err := graphText(doc)
			if err != nil {
				return err
			}
			var out []string
			removed := 0
			for _, l := range strings.Split(strings.TrimRight(g, "\n"), "\n") {
				if e, ok := parseEdgeLine(l); ok && e.source == from && e.target == to {
					removed++
					continue
				}
				out = append(out, l)
			}
			if removed == 0 {
				return fmt.Errorf("edge %s --> %s not found in Graph", from, to)
			}
			doc["Graph"] = strings.Join(out, "\n") + "\n"
			if err := saveYAMLFile(args[0], doc); err != nil {
				return err
			}
			fmt.Printf("removed %d edge(s) %s --> %s\n", removed, from, to)
			return nil
		},
	}
	cmd.Flags().StringVar(&from, "from", "", "source node ID ([*] allowed)")
	cmd.Flags().StringVar(&to, "to", "", "target node ID ([*] allowed)")
	return cmd
}
