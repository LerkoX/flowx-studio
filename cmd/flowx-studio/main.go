package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/LerkoX/flowx-studio/internal/cli"
	"github.com/LerkoX/flowx-studio/internal/config"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/handler"
	"github.com/LerkoX/flowx-studio/internal/runtime"
	"github.com/LerkoX/flowx-studio/internal/server"
	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/LerkoX/flowx-studio/internal/singleton"
	"github.com/spf13/cobra"
)

type appServices struct {
	database      *db.DB
	bus           *event.Bus
	rt            *runtime.Adapter
	nodeSvc       *service.NodeService
	nodeImportSvc *service.NodeImportService
	workflowSvc   *service.WorkflowService
}

func main() {
	rootCmd := &cobra.Command{
		Use:   "flowx-studio",
		Short: "FlowX Studio - FlowX runtime viewer with CLI client",
		// 业务错误不刷 usage、不重复打印，由 main 统一输出到 stderr
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	// 用法错误（flag 解析失败）退出码 2，并打印该命令的用法
	rootCmd.SetFlagErrorFunc(func(cmd *cobra.Command, err error) error {
		fmt.Fprintf(os.Stderr, "Error: %v\n\n%s\n", err, cmd.UsageString())
		return &usageError{err: err}
	})
	// 全局 flag：客户端子命令通过 --server / FLOWX_STUDIO_SERVER_URL 定位 server；
	// --json 输出机器可读结果；--schema 输出命令参数 JSON Schema 后退出。
	rootCmd.PersistentFlags().StringVar(&cli.ServerURL, "server", "", "HTTP server address (env: FLOWX_STUDIO_SERVER_URL, default http://127.0.0.1:8080)")
	rootCmd.PersistentFlags().BoolVar(&cli.JSONOutput, "json", false, "output result as JSON")
	rootCmd.PersistentFlags().BoolVar(&cli.ShowSchema, "schema", false, "print JSON Schema of this command's parameters and exit")

	serverCmd := &cobra.Command{
		Use:   "server",
		Short: "Start the HTTP server",
		RunE:  runServer,
	}
	serverCmd.Flags().Int("port", 8080, "HTTP server port")
	serverCmd.Flags().String("host", "0.0.0.0", "HTTP server host")
	rootCmd.AddCommand(serverCmd)

	// 客户端子命令（HTTP client，实现见 internal/cli）
	rootCmd.AddCommand(cli.NewPipelineCmd()) // pipeline list/create/update/delete/run
	rootCmd.AddCommand(cli.NewNodeCmd())     // node list/create/delete/import/mock
	rootCmd.AddCommand(cli.NewAskCmd())      // ask（原 FAP ask_input）
	rootCmd.AddCommand(cli.NewInfoCmd())     // info（原 FAP show_info）

	if err := rootCmd.Execute(); err != nil {
		var uerr *usageError
		if errors.As(err, &uerr) {
			os.Exit(2)
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

// usageError 包装 flag 解析错误，用于区分退出码 2。
type usageError struct{ err error }

func (e *usageError) Error() string { return e.err.Error() }
func (e *usageError) Unwrap() error { return e.err }

func newAppServices(cfg *config.Config) (*appServices, func(), error) {
	database, err := db.New(cfg.Data.DBPath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to open database: %w", err)
	}

	bus := event.NewBus()
	rt := runtime.NewAdapter()
	nodeSvc := service.NewNodeService(database, bus)
	nodeImportSvc := service.NewNodeImportService(nodeSvc)
	workflowSvc := service.NewWorkflowService(database, rt, bus, nodeSvc)

	cleanup := func() {
		rt.Stop()
		database.Close()
	}

	return &appServices{
		database:      database,
		bus:           bus,
		rt:            rt,
		nodeSvc:       nodeSvc,
		nodeImportSvc: nodeImportSvc,
		workflowSvc:   workflowSvc,
	}, cleanup, nil
}

func runServer(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	if cmd.Flags().Changed("port") {
		cfg.Server.Port, _ = cmd.Flags().GetInt("port")
	}
	if cmd.Flags().Changed("host") {
		cfg.Server.Host, _ = cmd.Flags().GetString("host")
	}

	if err := os.MkdirAll(cfg.Data.Dir, 0755); err != nil {
		return fmt.Errorf("failed to create data directory: %w", err)
	}

	// 单例锁：保证同一时刻只有一个 HTTP server 进程
	lock := singleton.New(filepath.Join(cfg.Data.Dir, "flowx-studio.pid"), "server")
	if err := lock.Acquire(); err != nil {
		return fmt.Errorf("failed to acquire singleton lock: %w", err)
	}
	defer lock.Release()

	svcs, cleanup, err := newAppServices(cfg)
	if err != nil {
		return err
	}
	defer cleanup()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	svcs.workflowSvc.StartEventBridge(ctx)

	srv := server.New()
	srv.SetPort(cfg.Server.Port)
	srv.SetHost(cfg.Server.Host)

	api := srv.Router().Group("/api/v1")
	handler.NewConfigHandler(svcs.database).RegisterRoutes(api)
	handler.NewWorkflowHandler(svcs.workflowSvc).RegisterRoutes(api)
	handler.NewNodeHandler(svcs.nodeSvc).RegisterRoutes(api)
	handler.NewEventHandler(svcs.bus).RegisterRoutes(api)

	srv.RegisterStatic()

	go func() {
		addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
		log.Printf("HTTP server listening on http://%s", addr)
		if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("HTTP server error: %v", err)
		}
		stop()
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}
	return nil
}

