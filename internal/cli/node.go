package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// NewNodeCmd 创建 node 命令组（list/create/update/delete/import/mock）。
func NewNodeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "node",
		Short: "Manage nodes via the flowx-studio server",
	}
	cmd.AddCommand(
		newNodeListCmd(),
		newNodeCreateCmd(),
		newNodeUpdateCmd(),
		newNodeDeleteCmd(),
		newNodeImportCmd(),
		newNodeMockCmd(),
	)
	return cmd
}

// nodeJSON 与 model.Node 的 JSON 字段对应（仅 CLI 展示所需字段）。
type nodeJSON struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	DisplayName string   `json:"displayName,omitempty"`
	Version     string   `json:"version,omitempty"`
	Language    string   `json:"language,omitempty"`
	NodeType    string   `json:"nodeType,omitempty"`
	Image       string   `json:"image,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

func newNodeListCmd() *cobra.Command {
	var language, tag, search, nodeType string
	var page, pageSize int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List nodes (check available nodeRef names before writing YAML)",
		RunE: func(cmd *cobra.Command, args []string) error {
			q := url.Values{}
			if language != "" {
				q.Set("language", language)
			}
			if tag != "" {
				q.Set("tag", tag)
			}
			if search != "" {
				q.Set("search", search)
			}
			if nodeType != "" {
				q.Set("node_type", nodeType)
			}
			q.Set("page", strconv.Itoa(page))
			q.Set("page_size", strconv.Itoa(pageSize))

			data, err := do(cmd.Context(), http.MethodGet, "/nodes", q, nil)
			if err != nil {
				return fail("list nodes", err, false)
			}

			var p paginatedJSON
			var items []nodeJSON
			if json.Unmarshal(data, &p) == nil {
				_ = json.Unmarshal(p.Items, &items)
			}

			printData(data, func() {
				rows := make([][]string, 0, len(items))
				for _, n := range items {
					kind := n.Language
					if n.NodeType == "image" {
						kind = "image:" + n.Image
					}
					rows = append(rows, []string{
						strconv.FormatInt(n.ID, 10), n.Name, n.NodeType, kind, n.Version,
					})
				}
				printTable([]string{"ID", "NAME", "TYPE", "LANG/IMAGE", "VERSION"}, rows)
				fmt.Printf("\nTotal: %d (page %d, page_size %d)\n", p.Total, p.Page, p.PageSize)
			})
			return nil
		},
	}
	cmd.Flags().StringVar(&language, "language", "", "filter by language")
	cmd.Flags().StringVar(&tag, "tag", "", "filter by tag")
	cmd.Flags().StringVar(&search, "search", "", "search keyword")
	cmd.Flags().StringVar(&nodeType, "node-type", "", "filter by node type (code|image)")
	cmd.Flags().IntVar(&page, "page", 1, "page number")
	cmd.Flags().IntVar(&pageSize, "page-size", 20, "page size")
	return cmd
}

func newNodeCreateCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a code node from a YAML/JSON definition file",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("node create") {
				return nil
			}
			if file == "" {
				return fmt.Errorf("--file is required. Run `flowx-studio node create --schema` for the parameter contract")
			}
			raw, err := readFileOrStdin(file)
			if err != nil {
				return fmt.Errorf("failed to read node definition: %w", err)
			}

			// YAML 是 JSON 超集，统一用 YAML 解析后转 JSON 提交。
			var def map[string]interface{}
			if err := yaml.Unmarshal(raw, &def); err != nil {
				return fmt.Errorf("invalid node definition: %w. Please fix the file and retry.", err)
			}

			data, err := do(cmd.Context(), http.MethodPost, "/nodes", nil, def)
			if err != nil {
				return fail("create node", err, false)
			}

			var n nodeJSON
			_ = json.Unmarshal(data, &n)
			printData(data, func() {
				fmt.Printf("Created node id=%d name=%s\n", n.ID, n.Name)
			})
			return nil
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "node definition file (YAML/JSON), '-' for stdin (required)")
	return cmd
}

func newNodeUpdateCmd() *cobra.Command {
	var id int64
	var file string
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update a node in place from a YAML/JSON definition file (keeps node ID)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("node update") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio node update --schema` for the parameter contract")
			}
			if file == "" {
				return fmt.Errorf("--file is required. Run `flowx-studio node update --schema` for the parameter contract")
			}
			raw, err := readFileOrStdin(file)
			if err != nil {
				return fmt.Errorf("failed to read node definition: %w", err)
			}

			// YAML 是 JSON 超集，统一用 YAML 解析后转 JSON 提交。
			var def map[string]interface{}
			if err := yaml.Unmarshal(raw, &def); err != nil {
				return fmt.Errorf("invalid node definition: %w. Please fix the file and retry.", err)
			}

			data, err := do(cmd.Context(), http.MethodPut, "/nodes/"+strconv.FormatInt(id, 10), nil, def)
			if err != nil {
				return fail("update node", err, false)
			}

			var n struct {
				ID   int64  `json:"id"`
				Name string `json:"name"`
			}
			_ = json.Unmarshal(data, &n)
			printData(data, func() {
				fmt.Printf("Updated node id=%d name=%s\n", n.ID, n.Name)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "node ID (required)")
	cmd.Flags().StringVar(&file, "file", "", "node definition file (YAML/JSON), '-' for stdin (required)")
	return cmd
}

func newNodeDeleteCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "delete",
		Short: "Delete a node",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("node delete") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}
			data, err := do(cmd.Context(), http.MethodDelete, "/nodes/"+strconv.FormatInt(id, 10), nil, nil)
			if err != nil {
				return fail("delete node", err, false)
			}
			printData(data, func() {
				fmt.Printf("Deleted node id=%d\n", id)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "node ID (required)")
	return cmd
}

func newNodeImportCmd() *cobra.Command {
	var sourceType, sourceURL, sourcePath string
	var overwrite bool
	cmd := &cobra.Command{
		Use:   "import",
		Short: "Import a node package (flowx.json) from a git repo or local folder",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("node import") {
				return nil
			}
			body := map[string]interface{}{"source_type": sourceType, "overwrite": overwrite}
			switch sourceType {
			case "git":
				if sourceURL == "" {
					return fmt.Errorf("--url is required when --type=git")
				}
				body["source_url"] = sourceURL
			case "folder":
				if sourcePath == "" {
					return fmt.Errorf("--path is required when --type=folder")
				}
				body["source_path"] = sourcePath
			default:
				return fmt.Errorf("--type must be git or folder. Run `flowx-studio node import --schema` for the parameter contract")
			}

			data, err := do(cmd.Context(), http.MethodPost, "/nodes/import", nil, body)
			if err != nil {
				return fail("import node", err, false)
			}

			var n nodeJSON
			_ = json.Unmarshal(data, &n)
			printData(data, func() {
				verb := "Imported"
				if overwrite {
					verb = "Imported (overwrite)"
				}
				fmt.Printf("%s node id=%d name=%s version=%s language=%s\n", verb, n.ID, n.Name, n.Version, n.Language)
			})
			return nil
		},
	}
	cmd.Flags().StringVar(&sourceType, "type", "", "source type: git|folder (required)")
	cmd.Flags().StringVar(&sourceURL, "url", "", "git repository URL (required when --type=git)")
	cmd.Flags().StringVar(&sourcePath, "path", "", "local folder path (required when --type=folder)")
	cmd.Flags().BoolVar(&overwrite, "overwrite", false, "update in place when a node with the same name exists (keeps node ID; no need to delete first)")
	return cmd
}

func newNodeMockCmd() *cobra.Command {
	var id int64
	var params string
	var timeout int
	cmd := &cobra.Command{
		Use:   "mock",
		Short: "Run a mock test for a node",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("node mock") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}

			body := map[string]interface{}{"timeout": timeout}
			if params != "" {
				var m map[string]string
				if err := json.Unmarshal([]byte(params), &m); err != nil {
					return fmt.Errorf("--params must be a JSON object with string values: %w", err)
				}
				body["parameters"] = m
			}

			data, err := do(cmd.Context(), http.MethodPost,
				"/nodes/"+strconv.FormatInt(id, 10)+"/mock", nil, body)
			if err != nil {
				return fail("mock test node", err, false)
			}

			var result struct {
				Status     string                 `json:"status"`
				DurationMs int64                  `json:"duration_ms"`
				Output     map[string]interface{} `json:"output"`
				Stdout     string                 `json:"stdout"`
				Stderr     string                 `json:"stderr"`
				Error      string                 `json:"error"`
			}
			_ = json.Unmarshal(data, &result)

			printData(data, func() {
				fmt.Printf("Mock test status=%s duration=%dms\n", result.Status, result.DurationMs)
				if len(result.Output) > 0 {
					out, _ := json.MarshalIndent(result.Output, "", "  ")
					fmt.Printf("--- output ---\n%s\n", out)
				}
				if result.Stdout != "" {
					fmt.Printf("--- stdout ---\n%s\n", result.Stdout)
				}
				if result.Stderr != "" {
					fmt.Printf("--- stderr ---\n%s\n", result.Stderr)
				}
				if result.Error != "" {
					fmt.Printf("--- error ---\n%s\n", result.Error)
				}
			})
			if result.Status != "success" {
				return fmt.Errorf("mock test failed with status: %s", result.Status)
			}
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "node ID (required)")
	cmd.Flags().StringVar(&params, "params", "", "JSON object string of parameters, e.g. '{\"key\":\"value\"}'")
	cmd.Flags().IntVar(&timeout, "timeout", 0, "timeout in seconds (server default 30, max 300)")
	return cmd
}
