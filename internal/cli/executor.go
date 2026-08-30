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
