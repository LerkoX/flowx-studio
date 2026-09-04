package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/spf13/cobra"
)

// executionJSON 执行记录（对应 model.Execution）
type executionJSON struct {
	ID           int64                  `json:"id"`
	WorkflowID   int64                  `json:"workflowId"`
	Status       string                 `json:"status"`
	Trigger      string                 `json:"trigger"`
	StartedAt    string                 `json:"startedAt,omitempty"`
	CompletedAt  string                 `json:"completedAt,omitempty"`
	DurationMs   int                    `json:"durationMs,omitempty"`
	ErrorMessage string                 `json:"errorMessage,omitempty"`
	ErrorNodeID  string                 `json:"errorNodeId,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// executionNodeJSON 执行节点（对应 model.ExecutionNode）
type executionNodeJSON struct {
	NodeID     string `json:"nodeId"`
	NodeName   string `json:"nodeName,omitempty"`
	Status     string `json:"status"`
	DurationMs *int   `json:"durationMs,omitempty"`
	Output     string `json:"output,omitempty"`
	Error      string `json:"error,omitempty"`
}

// executionLogJSON 执行日志（对应 model.ExecutionLog）
type executionLogJSON struct {
	NodeID   string `json:"nodeId,omitempty"`
	NodeName string `json:"nodeName,omitempty"`
	StepName string `json:"stepName,omitempty"`
	Level    string `json:"level"`
	Message  string `json:"message"`
	Output   string `json:"output,omitempty"`
	Time     string `json:"timestamp"`
}

// NewExecutionCmd 执行实例查询与续跑命令组
func NewExecutionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "execution",
		Short: "Query pipeline executions (logs, node outputs, metadata) and continue finished executions",
	}
	cmd.AddCommand(
		newExecutionListCmd(),
		newExecutionGetCmd(),
		newExecutionYAMLCmd(),
		newExecutionNodesCmd(),
		newExecutionLogsCmd(),
		newExecutionContinueCmd(),
		newExecutionPauseCmd(),
		newExecutionResumeCmd(),
	)
	return cmd
}

// newExecutionYAMLCmd 输出执行实例的运行时快照 YAML（剥离 runtime 状态段）。
// 快照是该执行的独立图定义（与流水线模板解耦），可导出后修改、
// 再通过 execution continue --file 提交以追加/修改未运行节点
func newExecutionYAMLCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "yaml",
		Short: "Print the execution's runtime snapshot YAML (edit it and pass to execution continue --file)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}
			data, err := do(cmd.Context(), http.MethodGet,
				"/executions/"+strconv.FormatInt(id, 10)+"/yaml", nil, nil)
			if err != nil {
				return fail("get execution yaml", err, false)
			}
			var resp struct {
				YAML        string `json:"yaml"`
				HasSnapshot bool   `json:"hasSnapshot"`
			}
			if err := json.Unmarshal(data, &resp); err != nil {
				return fail("parse response", err, false)
			}
			if !resp.HasSnapshot {
				return fail("get execution yaml", fmt.Errorf("execution %d has no runtime snapshot (创建于快照功能上线前)", id), false)
			}
			// 原样输出到 stdout，便于重定向：execution yaml --id 97 > snap.yaml
			fmt.Print(resp.YAML)
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "execution ID (required)")
	return cmd
}

func newExecutionListCmd() *cobra.Command {
	var pipelineID int64
	var status string
	var page, pageSize int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List executions, optionally filtered by pipeline ID",
		RunE: func(cmd *cobra.Command, args []string) error {
			q := url.Values{}
			if pipelineID > 0 {
				q.Set("workflow_id", strconv.FormatInt(pipelineID, 10))
			}
			if status != "" {
				q.Set("status", status)
			}
			q.Set("page", strconv.Itoa(page))
			q.Set("page_size", strconv.Itoa(pageSize))

			data, err := do(cmd.Context(), http.MethodGet, "/executions", q, nil)
			if err != nil {
				return fail("list executions", err, false)
			}
			printData(data, func() {
				var resp struct {
					Items []executionJSON `json:"items"`
					Total int             `json:"total"`
				}
				_ = json.Unmarshal(data, &resp)
				for _, e := range resp.Items {
					fmt.Printf("id=%d pipeline=%d status=%s started=%s duration=%dms\n",
						e.ID, e.WorkflowID, e.Status, e.StartedAt, e.DurationMs)
				}
				fmt.Printf("total=%d\n", resp.Total)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&pipelineID, "pipeline", 0, "filter by pipeline (workflow) ID")
	cmd.Flags().StringVar(&status, "status", "", "filter by status (running|paused|success|failed|cancelled)")
	cmd.Flags().IntVar(&page, "page", 1, "page number")
	cmd.Flags().IntVar(&pageSize, "page-size", 20, "page size")
	return cmd
}

func newExecutionGetCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "get",
		Short: "Get execution detail including metadata (params and node-extracted data)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}
			data, err := do(cmd.Context(), http.MethodGet,
				"/executions/"+strconv.FormatInt(id, 10), nil, nil)
			if err != nil {
				return fail("get execution", err, false)
			}
			printData(data, func() {
				var e executionJSON
				_ = json.Unmarshal(data, &e)
				fmt.Printf("id=%d pipeline=%d status=%s trigger=%s\n", e.ID, e.WorkflowID, e.Status, e.Trigger)
				fmt.Printf("started=%s completed=%s duration=%dms\n", e.StartedAt, e.CompletedAt, e.DurationMs)
				if e.ErrorMessage != "" {
					fmt.Printf("error=%s (node=%s)\n", e.ErrorMessage, e.ErrorNodeID)
				}
				if len(e.Metadata) > 0 {
					buf, _ := json.MarshalIndent(e.Metadata, "", "  ")
					fmt.Printf("metadata=%s\n", buf)
				}
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "execution ID (required)")
	return cmd
}

func newExecutionNodesCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "nodes",
		Short: "List node statuses and outputs (return data) of an execution",
		RunE: func(cmd *cobra.Command, args []string) error {
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}
			data, err := do(cmd.Context(), http.MethodGet,
				"/executions/"+strconv.FormatInt(id, 10)+"/nodes", nil, nil)
			if err != nil {
				return fail("list execution nodes", err, false)
			}
			printData(data, func() {
				var nodes []executionNodeJSON
				_ = json.Unmarshal(data, &nodes)
				for _, n := range nodes {
					dur := ""
					if n.DurationMs != nil {
						dur = fmt.Sprintf(" %dms", *n.DurationMs)
					}
					fmt.Printf("%s (%s): %s%s\n", n.NodeID, n.NodeName, n.Status, dur)
					if n.Output != "" {
						fmt.Printf("  output: %s\n", n.Output)
					}
					if n.Error != "" {
						fmt.Printf("  error: %s\n", n.Error)
					}
				}
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "execution ID (required)")
	return cmd
}

func newExecutionLogsCmd() *cobra.Command {
	var id int64
	var nodeID, level string
	var limit, offset int
	cmd := &cobra.Command{
		Use:   "logs",
		Short: "Query execution logs, optionally filtered by node and level",
		RunE: func(cmd *cobra.Command, args []string) error {
			if id <= 0 {
				return fmt.Errorf("--id is required")
			}
			q := url.Values{}
			if nodeID != "" {
				q.Set("node_id", nodeID)
			}
			if level != "" {
				q.Set("level", level)
			}
			q.Set("limit", strconv.Itoa(limit))
			q.Set("offset", strconv.Itoa(offset))

			data, err := do(cmd.Context(), http.MethodGet,
				"/executions/"+strconv.FormatInt(id, 10)+"/logs", q, nil)
			if err != nil {
				return fail("get execution logs", err, false)
			}
			printData(data, func() {
				// 服务端返回 {items: [...], total: N}
				var resp struct {
					Logs  []executionLogJSON `json:"items"`
					Total int                `json:"total"`
				}
				if json.Unmarshal(data, &resp) != nil || resp.Logs == nil {
					var logs []executionLogJSON
					_ = json.Unmarshal(data, &logs)
					resp.Logs = logs
				}
				for _, l := range resp.Logs {
					where := l.NodeName
					if where == "" {
						where = l.NodeID
					}
					if l.StepName != "" {
						where += "/" + l.StepName
					}
					fmt.Printf("[%s] %-5s %s %s\n", l.Time, l.Level, where, l.Message)
				}
				if resp.Total > 0 {
					fmt.Printf("total=%d (use --limit/--offset to page)\n", resp.Total)
				}
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "execution ID (required)")
	cmd.Flags().StringVar(&nodeID, "node", "", "filter by node ID")
	cmd.Flags().StringVar(&level, "level", "", "filter by level (debug|info|warn|error|fatal)")
	cmd.Flags().IntVar(&limit, "limit", 200, "max logs to return")
	cmd.Flags().IntVar(&offset, "offset", 0, "offset for paging")
	return cmd
}

func newExecutionContinueCmd() *cobra.Command {
	var id int64
	var file string
	var follow bool
	cmd := &cobra.Command{
		Use:   "continue",
		Short: "Continue a finished execution, optionally adding/modifying nodes via a new pipeline YAML",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("execution continue") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio execution continue --schema` for the parameter contract")
			}

			body := map[string]interface{}{}
			if file != "" {
				raw, err := readFileOrStdin(file)
				if err != nil {
					return fmt.Errorf("failed to read pipeline YAML: %w", err)
				}
				body["yaml"] = string(raw)
			}

			data, err := do(cmd.Context(), http.MethodPost,
				"/executions/"+strconv.FormatInt(id, 10)+"/continue", nil, body)
			if err != nil {
				return fail("continue execution", err, false)
			}
			printData(data, func() {
				fmt.Printf("Continued execution id=%d\n", id)
			})

			if follow {
				return followExecution(cmd.Context(), id)
			}
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "execution ID (required)")
	cmd.Flags().StringVar(&file, "file", "", "new pipeline YAML ('-' for stdin) to update the graph before continuing; finished nodes are skipped, only new/unrun nodes execute")
	cmd.Flags().BoolVar(&follow, "follow", false, "follow the SSE log stream until the execution finishes")
	return cmd
}

// newExecutionPauseCmd 暂停运行中的执行实例（层边界暂停：当前并发层节点执行完后挂起）
func newExecutionPauseCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "pause",
		Short: "Pause a running execution (takes effect at the next layer boundary; running nodes are not interrupted)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("execution pause") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio execution pause --schema` for the parameter contract")
			}

			data, err := do(cmd.Context(), http.MethodPost,
				"/executions/"+strconv.FormatInt(id, 10)+"/pause", nil, nil)
			if err != nil {
				return fail("pause execution", err, false)
			}
			printData(data, func() {
				fmt.Printf("Paused execution id=%d\n", id)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "execution ID (required)")
	return cmd
}

// newExecutionResumeCmd 恢复已暂停的执行实例（仅 server 内存中仍存活的实例可恢复）
func newExecutionResumeCmd() *cobra.Command {
	var id int64
	var follow bool
	cmd := &cobra.Command{
		Use:   "resume",
		Short: "Resume a paused execution",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("execution resume") {
				return nil
			}
			if id <= 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio execution resume --schema` for the parameter contract")
			}

			data, err := do(cmd.Context(), http.MethodPost,
				"/executions/"+strconv.FormatInt(id, 10)+"/resume", nil, nil)
			if err != nil {
				return fail("resume execution", err, false)
			}
			printData(data, func() {
				fmt.Printf("Resumed execution id=%d\n", id)
			})

			if follow {
				return followExecution(cmd.Context(), id)
			}
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "execution ID (required)")
	cmd.Flags().BoolVar(&follow, "follow", false, "follow the SSE log stream until the execution finishes")
	return cmd
}
