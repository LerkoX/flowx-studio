package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/LerkoX/flowx-studio/internal/config"
	"github.com/LerkoX/flowx-studio/internal/singleton"
	"github.com/spf13/cobra"
)

// NewBackupCmd 创建 backup 命令组（create/list/download/restore）。
// create/list/download 走 HTTP API（需要 server 运行）；
// restore 直接操作数据库文件，要求 server 已停止。
func NewBackupCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "backup",
		Short: "Backup and restore the FlowX Studio database",
	}
	cmd.AddCommand(
		newBackupCreateCmd(),
		newBackupListCmd(),
		newBackupDownloadCmd(),
		newBackupRestoreCmd(),
	)
	return cmd
}

type backupInfoJSON struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

func newBackupCreateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "create",
		Short: "Create a database backup on the server",
		RunE: func(cmd *cobra.Command, args []string) error {
			data, err := do(cmd.Context(), http.MethodPost, "/backups", nil, map[string]interface{}{})
			if err != nil {
				return fail("create backup", err, false)
			}
			var info backupInfoJSON
			_ = json.Unmarshal(data, &info)
			printData(data, func() {
				fmt.Printf("Created backup %s (%d bytes)\n", info.Path, info.Size)
			})
			return nil
		},
	}
}

func newBackupListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List database backups",
		RunE: func(cmd *cobra.Command, args []string) error {
			data, err := do(cmd.Context(), http.MethodGet, "/backups", nil, nil)
			if err != nil {
				return fail("list backups", err, false)
			}
			var items []backupInfoJSON
			_ = json.Unmarshal(data, &items)
			printData(data, func() {
				rows := make([][]string, 0, len(items))
				for _, b := range items {
					rows = append(rows, []string{
						b.Name, fmt.Sprintf("%d", b.Size), b.CreatedAt.Format("2006-01-02 15:04:05"),
					})
				}
				printTable([]string{"NAME", "SIZE", "CREATED"}, rows)
			})
			return nil
		},
	}
}

func newBackupDownloadCmd() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "download",
		Short: "Download a backup file from the server",
		RunE: func(cmd *cobra.Command, args []string) error {
			name, _ := cmd.Flags().GetString("name")
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			if output == "" {
				output = name
			}

			req, err := http.NewRequestWithContext(cmd.Context(), http.MethodGet,
				baseURL()+"/api/v1/backups/"+name+"/download", nil)
			if err != nil {
				return err
			}
			if token := authToken(); token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			resp, err := httpClient.Do(req)
			if err != nil {
				return fmt.Errorf("cannot connect to server at %s: %w. Is `flowx-studio server` running?", baseURL(), err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("failed to download backup: HTTP %d", resp.StatusCode)
			}

			f, err := os.Create(output)
			if err != nil {
				return fmt.Errorf("failed to create output file: %w", err)
			}
			defer f.Close()
			n, err := io.Copy(f, resp.Body)
			if err != nil {
				return fmt.Errorf("failed to write backup file: %w", err)
			}
			fmt.Printf("Downloaded backup to %s (%d bytes)\n", output, n)
			return nil
		},
	}
	cmd.Flags().String("name", "", "backup file name (required)")
	cmd.Flags().StringVarP(&output, "output", "o", "", "output file path (default: backup name)")
	return cmd
}

func newBackupRestoreCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:   "restore",
		Short: "Restore the database from a backup file (server must be stopped)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if file == "" {
				return fmt.Errorf("--file is required")
			}
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("failed to load config: %w", err)
			}

			// 安全约束：server 运行中禁止恢复
			pidFile := filepath.Join(cfg.Data.Dir, "flowx-studio.pid")
			if pid, running := singleton.FindRunning(pidFile, "server"); running {
				return fmt.Errorf("server is running (pid %d). Run `flowx-studio server stop` first, then retry", pid)
			}

			src, err := os.Open(file)
			if err != nil {
				return fmt.Errorf("failed to open backup file: %w", err)
			}
			defer src.Close()

			// 恢复前自动为当前数据库留一份回滚副本
			rollback := cfg.Data.DBPath + ".pre-restore"
			if _, err := os.Stat(cfg.Data.DBPath); err == nil {
				if err := copyFile(cfg.Data.DBPath, rollback); err != nil {
					return fmt.Errorf("failed to save pre-restore copy: %w", err)
				}
				fmt.Printf("Current database saved to %s\n", rollback)
			}

			dst, err := os.Create(cfg.Data.DBPath)
			if err != nil {
				return fmt.Errorf("failed to open database file: %w", err)
			}
			if _, err := io.Copy(dst, src); err != nil {
				dst.Close()
				return fmt.Errorf("failed to restore: %w", err)
			}
			if err := dst.Close(); err != nil {
				return err
			}
			// 清理可能残留的 WAL/SHM，避免旧日志重放到新库
			_ = os.Remove(cfg.Data.DBPath + "-wal")
			_ = os.Remove(cfg.Data.DBPath + "-shm")

			fmt.Printf("Restored database from %s\n", file)
			return nil
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "backup file path (required)")
	return cmd
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
