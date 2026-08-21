package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/LerkoX/flowx-studio/internal/config"
	"github.com/LerkoX/flowx-studio/internal/singleton"
	"github.com/spf13/cobra"
)

// NewServerStartCmd 创建 `server start` 子命令：后台守护启动并阻塞等待就绪。
func NewServerStartCmd() *cobra.Command {
	var port int
	var host string
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start the HTTP server in the background and wait until ready",
		RunE: func(cmd *cobra.Command, args []string) error {
			if maybePrintSchema("server start") {
				return nil
			}
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("failed to load config: %w", err)
			}
			if cmd.Flags().Changed("port") {
				cfg.Server.Port = port
			}
			if cmd.Flags().Changed("host") {
				cfg.Server.Host = host
			}
			url := serverURL(cfg)

			// 幂等：已在运行则直接报告，避免触发单例锁的杀旧接管逻辑
			if probeServer(url) {
				fmt.Printf("Server already running url=%s\n", url)
				return nil
			}

			if err := os.MkdirAll(cfg.Data.Dir, 0755); err != nil {
				return fmt.Errorf("failed to create data directory: %w", err)
			}
			logPath := filepath.Join(cfg.Data.Dir, "server.log")
			logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
			if err != nil {
				return fmt.Errorf("failed to open server log: %w", err)
			}
			defer logFile.Close()

			exe, err := os.Executable()
			if err != nil {
				return fmt.Errorf("failed to locate executable: %w", err)
			}

			child := exec.Command(exe, "server", "--daemon-child",
				"--port", fmt.Sprintf("%d", cfg.Server.Port),
				"--host", cfg.Server.Host)
			child.Stdout = logFile
			child.Stderr = logFile
			child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
			if err := child.Start(); err != nil {
				return fmt.Errorf("failed to start server process: %w", err)
			}

			// 就绪探测：每 200ms 轮询，超时 10s
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				if probeServer(url) {
					fmt.Printf("Server started pid=%d url=%s\n", child.Process.Pid, url)
					return nil
				}
				time.Sleep(200 * time.Millisecond)
			}
			return fmt.Errorf("server did not become ready within 10s. Check the log: %s", logPath)
		},
	}
	cmd.Flags().IntVar(&port, "port", 8080, "HTTP server port")
	cmd.Flags().StringVar(&host, "host", "0.0.0.0", "HTTP server host")
	return cmd
}

// serverState 是 runServer 写入数据目录的 server.json，记录实际监听地址。
type serverState struct {
	PID  int    `json:"pid"`
	Host string `json:"host"`
	Port int    `json:"port"`
}

// loadServerState 读取 server.json；不存在时回退到配置中的 host/port。
func loadServerState(cfg *config.Config) serverState {
	st := serverState{Host: cfg.Server.Host, Port: cfg.Server.Port}
	raw, err := os.ReadFile(filepath.Join(cfg.Data.Dir, "server.json"))
	if err == nil {
		_ = json.Unmarshal(raw, &st)
	}
	return st
}

func stateURL(st serverState) string {
	host := st.Host
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s:%d", host, st.Port)
}

// NewServerStopCmd 创建 `server stop` 子命令：SIGTERM 优雅停止。
func NewServerStopCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "stop",
		Short: "Stop the background HTTP server",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("failed to load config: %w", err)
			}
			pidFile := filepath.Join(cfg.Data.Dir, "flowx-studio.pid")

			pid, running := singleton.FindRunning(pidFile, "server")
			if !running {
				_ = os.Remove(pidFile) // 清理可能存在的陈旧 pid 文件
				fmt.Println("Server not running")
				return nil
			}

			if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
				return fmt.Errorf("failed to stop server (pid %d): %w", pid, err)
			}
			for i := 0; i < 50; i++ {
				if _, still := singleton.FindRunning(pidFile, "server"); !still {
					fmt.Printf("Server stopped pid=%d\n", pid)
					return nil
				}
				time.Sleep(100 * time.Millisecond)
			}
			return fmt.Errorf("server (pid %d) did not exit within 5s after SIGTERM", pid)
		},
	}
}

// NewServerStatusCmd 创建 `server status` 子命令：输出 running/stopped，退出码恒为 0。
func NewServerStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show whether the HTTP server is running",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("failed to load config: %w", err)
			}
			pidFile := filepath.Join(cfg.Data.Dir, "flowx-studio.pid")
			url := stateURL(loadServerState(cfg))

			pid, procAlive := singleton.FindRunning(pidFile, "server")
			running := procAlive && probeServer(url)

			if JSONOutput {
				fmt.Printf("{\"status\":%q,\"pid\":%d,\"url\":%q}\n",
					statusString(running), pidIf(running, pid), url)
				return nil
			}
			if running {
				fmt.Printf("running (pid=%d, url=%s)\n", pid, url)
			} else {
				fmt.Println("stopped")
			}
			return nil
		},
	}
}

// serverURL 构造用于探测的本机 URL（0.0.0.0 等通配地址映射为 127.0.0.1）。
func serverURL(cfg *config.Config) string {
	host := cfg.Server.Host
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s:%d", host, cfg.Server.Port)
}

// probeServer
// 只要求拿到任意 HTTP 响应即视为存活（认证开启时端点会返回 401，同样说明进程已就绪）。
func probeServer(url string) bool {
	client := &http.Client{Timeout: time.Second}
	resp, err := client.Get(url + "/api/v1/config/system")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return true
}

func statusString(running bool) string {
	if running {
		return "running"
	}
	return "stopped"
}

func pidIf(running bool, pid int) int {
	if running {
		return pid
	}
	return 0
}
