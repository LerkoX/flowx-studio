package cli

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// executorJSON 执行器实例的 API 投影
type executorJSON struct {
	ID          int64                  `json:"id"`
	Name        string                 `json:"name"`
	Type        string                 `json:"type"`
	Description string                 `json:"description,omitempty"`
	Config      map[string]interface{} `json:"config"`
	IsDefault   bool                   `json:"isDefault"`
	Disabled    bool                   `json:"disabled"`
}

// NewExecutorCmd 执行器实例管理命令组（local 单例、docker 多实例、全局默认）
func NewExecutorCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "executor",
		Short: "Manage executor instances via the flowx-studio server",
	}
	cmd.AddCommand(
		newExecutorListCmd(),
		newExecutorCreateCmd(),
		newExecutorUpdateCmd(),
		newExecutorDeleteCmd(),
		newExecutorSetDefaultCmd(),
		newExecutorSetDisabledCmd("disable", true),
		newExecutorSetDisabledCmd("enable", false),
		newExecutorTestCmd(),
	)
	return cmd
}

func newExecutorListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List executor instances",
		RunE: func(cmd *cobra.Command, args []string) error {
			data, err := do(cmd.Context(), http.MethodGet, "/executors", nil, nil)
			if err != nil {
				return fail("list executors", err, false)
			}
			printData(data, func() {
				var items []executorJSON
				_ = json.Unmarshal(data, &items)
				for _, e := range items {
					def := ""
					if e.IsDefault {
						def = " (default)"
					}
					if e.Disabled {
						def += " (disabled)"
					}
					fmt.Printf("id=%d name=%s type=%s%s\n", e.ID, e.Name, e.Type, def)
				}
			})
			return nil
		},
	}
}

func newExecutorCreateCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create an executor instance from a YAML/JSON definition file",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("executor create") {
				return nil
			}
			if file == "" {
				return fmt.Errorf("--file is required. Run `flowx-studio executor create --schema` for the parameter contract")
			}
			raw, err := readFileOrStdin(file)
			if err != nil {
				return fmt.Errorf("failed to read executor definition: %w", err)
			}

			var def executorJSON
			if err := yaml.Unmarshal(raw, &def); err != nil {
				return fmt.Errorf("invalid executor definition: %w. Please fix the file and retry.", err)
			}

			data, err := do(cmd.Context(), http.MethodPost, "/executors", nil, def)
			if err != nil {
				return fail("create executor", err, false)
			}
			var created executorJSON
			_ = json.Unmarshal(data, &created)
			printData(data, func() {
				fmt.Printf("Created executor id=%d name=%s type=%s\n", created.ID, created.Name, created.Type)
			})
			return nil
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "executor definition file (YAML/JSON), '-' for stdin (required)")
	return cmd
}

func newExecutorUpdateCmd() *cobra.Command {
	var id int64
	var file string
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update an executor's description/config (name and type are immutable)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("executor update") {
				return nil
			}
			if id == 0 || file == "" {
				return fmt.Errorf("--id and --file are required. Run `flowx-studio executor update --schema` for the parameter contract")
			}
			raw, err := readFileOrStdin(file)
			if err != nil {
				return fmt.Errorf("failed to read executor definition: %w", err)
			}
			var def map[string]interface{}
			if err := yaml.Unmarshal(raw, &def); err != nil {
				return fmt.Errorf("invalid executor definition: %w. Please fix the file and retry.", err)
			}

			data, err := do(cmd.Context(), http.MethodPut, fmt.Sprintf("/executors/%d", id), nil, def)
			if err != nil {
				return fail("update executor", err, false)
			}
			printData(data, func() {
				fmt.Printf("Updated executor id=%d\n", id)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "executor ID (required)")
	cmd.Flags().StringVar(&file, "file", "", "executor definition file (YAML/JSON), '-' for stdin (required)")
	return cmd
}

func newExecutorDeleteCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "delete",
		Short: "Delete an executor instance (the default executor cannot be deleted)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("executor delete") {
				return nil
			}
			if id == 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio executor delete --schema` for the parameter contract")
			}
			data, err := do(cmd.Context(), http.MethodDelete, fmt.Sprintf("/executors/%d", id), nil, nil)
			if err != nil {
				return fail("delete executor", err, false)
			}
			printData(data, func() {
				fmt.Printf("Deleted executor id=%d\n", id)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "executor ID (required)")
	return cmd
}

// newExecutorSetDisabledCmd 生成 disable/enable 子命令（同一端点，仅取值不同）
func newExecutorSetDisabledCmd(use string, disabled bool) *cobra.Command {
	var id int64
	verb := "Disable"
	if !disabled {
		verb = "Enable"
	}
	cmd := &cobra.Command{
		Use:   use,
		Short: verb + " an executor instance (disabled executors are skipped by type resolution; referencing them by name fails)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("executor " + use) {
				return nil
			}
			if id == 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio executor %s --schema` for the parameter contract", use)
			}
			data, err := do(cmd.Context(), http.MethodPut, fmt.Sprintf("/executors/%d/disabled", id), nil, map[string]bool{"disabled": disabled})
			if err != nil {
				return fail(use+" executor", err, false)
			}
			var e executorJSON
			_ = json.Unmarshal(data, &e)
			printData(data, func() {
				state := "disabled"
				if !e.Disabled {
					state = "enabled"
				}
				fmt.Printf("Executor id=%d name=%s is now %s\n", e.ID, e.Name, state)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "executor ID (required)")
	return cmd
}

// executorTestJSON 连接测试结果的 API 投影
type executorTestJSON struct {
	OK            bool   `json:"ok"`
	Message       string `json:"message,omitempty"`
	ServerVersion string `json:"serverVersion,omitempty"`
	APIVersion    string `json:"apiVersion,omitempty"`
	OS            string `json:"os,omitempty"`
	Arch          string `json:"arch,omitempty"`
	DockerName    string `json:"dockerName,omitempty"`
	LatencyMs     int64  `json:"latencyMs"`
}

func newExecutorTestCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "test",
		Short: "Test a docker executor's connection to its daemon (no image pull, no container created)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("executor test") {
				return nil
			}
			if id == 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio executor test --schema` for the parameter contract")
			}
			data, err := do(cmd.Context(), http.MethodPost, fmt.Sprintf("/executors/%d/test", id), nil, nil)
			if err != nil {
				return fail("test executor connection", err, false)
			}
			var r executorTestJSON
			_ = json.Unmarshal(data, &r)
			printData(data, func() {
				if r.OK {
					fmt.Printf("Connection OK: docker %s (api=%s %s/%s name=%s) latency=%dms\n",
						r.ServerVersion, r.APIVersion, r.OS, r.Arch, r.DockerName, r.LatencyMs)
				} else {
					fmt.Printf("Connection FAILED: %s\n", r.Message)
				}
			})
			if !r.OK {
				// 连接失败按业务失败处理：退出码 1，stderr 给出修复指引
				return fail("test executor connection", fmt.Errorf("%s. Check the executor's host/tlsVerify/certPath config and that the daemon is reachable, then retry", r.Message), false)
			}
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "executor ID (required)")
	return cmd
}

func newExecutorSetDefaultCmd() *cobra.Command {
	var id int64
	cmd := &cobra.Command{
		Use:   "set-default",
		Short: "Mark an executor as the global default",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("executor set-default") {
				return nil
			}
			if id == 0 {
				return fmt.Errorf("--id is required. Run `flowx-studio executor set-default --schema` for the parameter contract")
			}
			data, err := do(cmd.Context(), http.MethodPut, fmt.Sprintf("/executors/%d/default", id), nil, nil)
			if err != nil {
				return fail("set default executor", err, false)
			}
			var e executorJSON
			_ = json.Unmarshal(data, &e)
			printData(data, func() {
				fmt.Printf("Default executor is now name=%s type=%s\n", e.Name, e.Type)
			})
			return nil
		},
	}
	cmd.Flags().Int64Var(&id, "id", 0, "executor ID (required)")
	return cmd
}
