package cli

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// NewAskCmd 创建 ask 命令（承接原 FAP ask_input 动作）。
// 在终端向用户提问，把回答以 `key=value` 输出到 stdout，供 Agent 捕获。
// 提示与错误信息写到 stderr，保证 stdout 只承载答案。
func NewAskCmd() *cobra.Command {
	var key, prompt, options, defVal string
	cmd := &cobra.Command{
		Use:   "ask",
		Short: "Ask the user a question in the terminal and print the answer as key=value",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("ask") {
				return nil
			}
			if key == "" || prompt == "" {
				return fmt.Errorf("--key and --prompt are required. Run `flowx-studio ask --schema` for the parameter contract")
			}

			var opts []string
			if options != "" {
				for _, o := range strings.Split(options, ",") {
					if o = strings.TrimSpace(o); o != "" {
						opts = append(opts, o)
					}
				}
			}

			reader := bufio.NewReader(os.Stdin)
			for {
				// 构造提示行（stderr）
				hint := prompt
				if len(opts) > 0 {
					hint += " [" + strings.Join(opts, "/") + "]"
				}
				if defVal != "" {
					hint += " (default: " + defVal + ")"
				}
				fmt.Fprintf(os.Stderr, "%s: ", hint)

				line, err := reader.ReadString('\n')
				if err != nil && line == "" {
					return fmt.Errorf("failed to read answer: %w", err)
				}
				answer := strings.TrimSpace(line)
				if answer == "" {
					answer = defVal
				}

				if len(opts) > 0 {
					valid := false
					for _, o := range opts {
						if answer == o {
							valid = true
							break
						}
					}
					if !valid {
						fmt.Fprintf(os.Stderr, "Invalid answer %q, please choose from: %s\n", answer, strings.Join(opts, ", "))
						continue
					}
				}

				fmt.Printf("%s=%s\n", key, answer)
				return nil
			}
		},
	}
	cmd.Flags().StringVar(&key, "key", "", "answer key name (required)")
	cmd.Flags().StringVar(&prompt, "prompt", "", "question shown to the user (required)")
	cmd.Flags().StringVar(&options, "options", "", "comma-separated candidate answers; user must pick one")
	cmd.Flags().StringVar(&defVal, "default", "", "default answer when the user just presses Enter")
	return cmd
}

// NewInfoCmd 创建 info 命令（承接原 FAP show_info 动作）。
// 在终端渲染一张信息卡片，用于向用户汇报阶段性结果。纯终端命令，不访问 server。
func NewInfoCmd() *cobra.Command {
	var title, message, level string
	cmd := &cobra.Command{
		Use:   "info",
		Short: "Render an info card in the terminal",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("info") {
				return nil
			}
			if title == "" || message == "" {
				return fmt.Errorf("--title and --message are required. Run `flowx-studio info --schema` for the parameter contract")
			}
			marker := map[string]string{"info": "ℹ", "warn": "⚠", "error": "✖"}[level]
			if marker == "" {
				return fmt.Errorf("--level must be info, warn or error")
			}

			lines := []string{fmt.Sprintf("%s [%s] %s", marker, strings.ToUpper(level), title)}
			lines = append(lines, strings.Split(message, "\n")...)

			width := 0
			for _, l := range lines {
				if n := len([]rune(l)); n > width {
					width = n
				}
			}
			border := "─"
			fmt.Println("┌" + strings.Repeat(border, width+2) + "┐")
			for _, l := range lines {
				pad := width - len([]rune(l))
				fmt.Printf("│ %s%s │\n", l, strings.Repeat(" ", pad))
			}
			fmt.Println("└" + strings.Repeat(border, width+2) + "┘")
			return nil
		},
	}
	cmd.Flags().StringVar(&title, "title", "", "card title (required)")
	cmd.Flags().StringVar(&message, "message", "", "card body (required)")
	cmd.Flags().StringVar(&level, "level", "info", "card level: info|warn|error")
	return cmd
}
