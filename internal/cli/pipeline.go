package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

// NewPipelineCmd 创建 pipeline 命令组（list/create/update/delete/run）。
func NewPipelineCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "pipeline",
		Aliases: []string{"workflow"},
		Short:   "Manage pipelines (workflows) via the flowx-studio server",
	}
	cmd.AddCommand(
		newPipelineListCmd(),
		newPipelineCreateCmd(),
		newPipelineUpdateCmd(),
		newPipelineDeleteCmd(),
		newPipelineRunCmd(),
	)
	return cmd
}

// workflowJSON 与 model.Workflow 的 JSON 字段对应。
type workflowJSON struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Intent      string `json:"intent,omitempty"`
	YAMLConfig  string `json:"yamlConfig"`
	Status      string `json:"status"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

type paginatedJSON struct {
	Items    json.RawMessage `json:"items"`
	Total    int             `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"pageSize"`
}

func newPipelineListCmd() *cobra.Command {
	var status, search string
	var page, pageSize int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List pipelines",
		RunE: func(cmd *cobra.Command, args []string) error {
			q := url.Values{}
			if status != "" {
				q.Set("status", status)
			}
			if search != "" {
				q.Set("search", search)
			}
			q.Set("page", strconv.Itoa(page))
			q.Set("page_size", strconv.Itoa(pageSize))

			data, err := do(cmd.Context(), http.MethodGet, "/workflows", q, nil)
			if err != nil {
				return fail("list pipelines", err, false)
			}

			var p paginatedJSON
			var items []workflowJSON
			if json.Unmarshal(data, &p) == nil {
				_ = json.Unmarshal(p.Items, &items)
			}

			printData(data, func() {
				rows := make([][]string, 0, len(items))
				for _, w := range items {
					rows = append(rows, []string{
						strconv.FormatInt(w.ID, 10), w.Name, w.Status, w.UpdatedAt,
					})
				}
				printTable([]string{"ID", "NAME", "STATUS", "UPDATED"}, rows)
				fmt.Printf("\nTotal: %d (page %d, page_size %d)\n", p.Total, p.Page, p.PageSize)
			})
			return nil
		},
	}
	cmd.Flags().StringVar(&status, "status", "", "filter by status (draft|active|archived)")
	cmd.Flags().StringVar(&search, "search", "", "search keyword")
	cmd.Flags().IntVar(&page, "page", 1, "page number")
	cmd.Flags().IntVar(&pageSize, "page-size", 20, "page size")
	return cmd
}

func newPipelineCreateCmd() *cobra.Command {
	var name, file, description, intent, status string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a pipeline from a FlowX YAML file",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("pipeline create") {
				return nil
			}
			if name == "" || file == "" {
				return fmt.Errorf("--name and --file are required. Run `flowx-studio pipeline create --schema` for the parameter contract")
			}
			yamlBytes, err := readFileOrStdin(file)
			if err != nil {
				return fmt.Errorf("failed to read YAML file: %w", err)
			}

			body := map[string]interface{}{
				"name":        name,
				"yamlConfig":  string(yamlBytes),
				"description": description,
				"intent":      intent,
				"status":      status,
			}
			data, err := do(cmd.Context(), http.MethodPost, "/workflows", nil, body)
			if err != nil {
				return fail("create pipeline", err, true)
			}

			var wf workflowJSON
			_ = json.Unmarshal(data, &wf)
			printData(data, func() {
				fmt.Printf("Created pipeline id=%d name=%s\n", wf.ID, wf.Name)
			})
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "pipeline name (required)")
	cmd.Flags().StringVar(&file, "file", "", "FlowX YAML file path, '-' for stdin (required)")
	cmd.Flags().StringVar(&description, "description", "", "description")
	cmd.Flags().StringVar(&intent, "intent", "", "intent description")
	cmd.Flags().StringVar(&status, "status", "draft", "status: draft|active|archived")
	return cmd
}

func newPipelineUpdateCmd() *cobra.Command {
	var id int64
	var name, file, description, intent, status string
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update a pipeline (server-side YAML validation applies)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("pipeline update") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio pipeline update --schema` for the parameter contract")
			}

			// 服务端 Update 为全量覆盖且校验 YAML：先读取现有记录合并未指定的字段。
			existing, err := do(cmd.Context(), http.MethodGet, "/workflows/"+strconv.FormatInt(id, 10), nil, nil)
			if err != nil {
				return fail("get pipeline", err, false)
			}
			var wf workflowJSON
			if err := json.Unmarshal(existing, &wf); err != nil {
				return fmt.Errorf("failed to parse existing pipeline: %w", err)
			}

			if cmd.Flags().Changed("name") {
				wf.Name = name
			}
			if cmd.Flags().Changed("description") {
				wf.Description = description
			}
			if cmd.Flags().Changed("intent") {
				wf.Intent = intent
			}
			if cmd.Flags().Changed("status") {
				wf.Status = status
			}
			if file != "" {
				yamlBytes, err := readFileOrStdin(file)
				if err != nil {
					return fmt.Errorf("failed to read YAML file: %w", err)
				}
				wf.YAMLConfig = string(yamlBytes)
			}

			data, err := do(cmd.Context(), http.MethodPut, "/workflows/"+strconv.FormatInt(id, 10), nil, wf)
			if err != nil {
				return fail("update pipeline", err, true)
			}
			printData(data, func() {
				fmt.Printf("Updated pipeline id=%d\n", id)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "pipeline ID (required)")
	cmd.Flags().StringVar(&name, "name", "", "pipeline name (keep existing if omitted)")
	cmd.Flags().StringVar(&file, "file", "", "FlowX YAML file path, '-' for stdin (keep existing if omitted)")
	cmd.Flags().StringVar(&description, "description", "", "description (keep existing if omitted)")
	cmd.Flags().StringVar(&intent, "intent", "", "intent description (keep existing if omitted)")
	cmd.Flags().StringVar(&status, "status", "", "status: draft|active|archived (keep existing if omitted)")
	return cmd
}

func newPipelineDeleteCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "delete",
		Short: "Delete a pipeline",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("pipeline delete") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}
			data, err := do(cmd.Context(), http.MethodDelete, "/workflows/"+strconv.FormatInt(id, 10), nil, nil)
			if err != nil {
				return fail("delete pipeline", err, false)
			}
			printData(data, func() {
				fmt.Printf("Deleted pipeline id=%d\n", id)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "pipeline ID (required)")
	return cmd
}

func newPipelineRunCmd() *cobra.Command {
	var id int64
	var follow bool
	cmd := &cobra.Command{
		Use:   "run",
		Short: "Trigger a pipeline execution",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("pipeline run") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}
			data, err := do(cmd.Context(), http.MethodPost,
				"/workflows/"+strconv.FormatInt(id, 10)+"/run", nil, map[string]interface{}{})
			if err != nil {
				return fail("run pipeline", err, false)
			}

			var result struct {
				ExecutionID int64  `json:"executionId"`
				StreamURL   string `json:"streamUrl"`
			}
			_ = json.Unmarshal(data, &result)

			printData(data, func() {
				fmt.Printf("Started execution id=%d streamUrl=%s\n", result.ExecutionID, result.StreamURL)
			})

			if follow {
				return followExecution(cmd.Context(), result.ExecutionID)
			}
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "pipeline ID (required)")
	cmd.Flags().BoolVar(&follow, "follow", false, "follow the SSE log stream until the execution finishes")
	return cmd
}

// followExecution 订阅执行的 SSE 日志流并打印到终端，直到执行结束。
// followExecution 订阅执行的 SSE 日志流并打印到终端，直到执行结束。
// 执行成功返回 nil，失败返回错误（退出码 1）。
func followExecution(ctx context.Context, execID int64) error {
	u := fmt.Sprintf("%s/api/v1/executions/%d/stream", baseURL(), execID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	if tok := authToken(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("cannot connect to server at %s: %w. Is `flowx-studio server` running?", baseURL(), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to open stream: HTTP %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var eventType string
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			eventType = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			payload := strings.TrimPrefix(line, "data: ")
			done, err := handleStreamEvent(eventType, payload)
			if err != nil || done {
				return err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("stream read error: %w", err)
	}
	return fmt.Errorf("stream closed before execution completed")
}

// handleStreamEvent 处理一条 SSE 事件。done 为 true 表示执行已结束。
func handleStreamEvent(eventType, payload string) (done bool, err error) {
	var data map[string]interface{}
	if json.Unmarshal([]byte(payload), &data) != nil {
		return false, nil
	}

	switch eventType {
	case "execution.log":
		level, _ := data["level"].(string)
		node, _ := data["node_name"].(string)
		msg, _ := data["message"].(string)
		if node != "" {
			fmt.Printf("[%s] [%s] %s\n", level, node, msg)
		} else {
			fmt.Printf("[%s] %s\n", level, msg)
		}
	case "node_start":
		fmt.Printf("→ node %s started\n", eventNodeName(data))
	case "node_complete":
		status, _ := data["status"].(string)
		fmt.Printf("✓ node %s %s\n", eventNodeName(data), status)
	case "execution_complete", "execution.completed":
		status, _ := data["status"].(string)
		fmt.Printf("Execution finished: %s\n", status)
		if !strings.EqualFold(status, "success") {
			return true, fmt.Errorf("execution failed with status: %s", status)
		}
		return true, nil
	}
	return false, nil
}

// eventNodeName 从事件数据中取节点显示名，优先 node_name，回退 node_id。
func eventNodeName(data map[string]interface{}) string {
	if n, _ := data["node_name"].(string); n != "" {
		return n
	}
	n, _ := data["node_id"].(string)
	return n
}
