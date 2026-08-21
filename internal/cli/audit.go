package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/spf13/cobra"
)

// NewAuditCmd 创建 audit 命令组（list）。
func NewAuditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "audit",
		Short: "Query audit logs via the flowx-studio server",
	}
	cmd.AddCommand(newAuditListCmd())
	return cmd
}

type auditLogJSON struct {
	ID           int64     `json:"id"`
	Action       string    `json:"action"`
	ResourceType string    `json:"resourceType"`
	ResourceID   string    `json:"resourceId,omitempty"`
	Detail       string    `json:"detail,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

func newAuditListCmd() *cobra.Command {
	var action, resourceType string
	var page, pageSize int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List audit logs",
		RunE: func(cmd *cobra.Command, args []string) error {
			q := url.Values{}
			if action != "" {
				q.Set("action", action)
			}
			if resourceType != "" {
				q.Set("resource_type", resourceType)
			}
			q.Set("page", strconv.Itoa(page))
			q.Set("page_size", strconv.Itoa(pageSize))

			data, err := do(cmd.Context(), http.MethodGet, "/audit-logs", q, nil)
			if err != nil {
				return fail("list audit logs", err, false)
			}

			var p paginatedJSON
			var items []auditLogJSON
			if json.Unmarshal(data, &p) == nil {
				_ = json.Unmarshal(p.Items, &items)
			}

			printData(data, func() {
				rows := make([][]string, 0, len(items))
				for _, a := range items {
					rows = append(rows, []string{
						a.CreatedAt.Format("2006-01-02 15:04:05"),
						a.Action, a.ResourceType, a.ResourceID, a.Detail,
					})
				}
				printTable([]string{"TIME", "ACTION", "RESOURCE", "ID", "DETAIL"}, rows)
				fmt.Printf("\nTotal: %d (page %d, page_size %d)\n", p.Total, p.Page, p.PageSize)
			})
			return nil
		},
	}
	cmd.Flags().StringVar(&action, "action", "", "filter by action (e.g. create_node, run_workflow)")
	cmd.Flags().StringVar(&resourceType, "resource-type", "", "filter by resource type (node|workflow|config)")
	cmd.Flags().IntVar(&page, "page", 1, "page number")
	cmd.Flags().IntVar(&pageSize, "page-size", 20, "page size")
	return cmd
}
