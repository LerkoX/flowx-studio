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

	"github.com/LerkoX/flowx-studio/internal/config"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/handler"
	"github.com/LerkoX/flowx-studio/internal/mcpserver"
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
		Short: "FlowX Studio - FlowX runtime viewer with MCP support",
	}

	serverCmd := &cobra.Command{
		Use:   "server",
		Short: "Start the HTTP server",
		RunE:  runServer,
	}
	serverCmd.Flags().Int("port", 8080, "HTTP server port")
	serverCmd.Flags().String("host", "0.0.0.0", "HTTP server host")
	rootCmd.AddCommand(serverCmd)

	mcpCmd := &cobra.Command{
		Use:   "mcp",
		Short: "Start the stdio MCP server",
		RunE:  runMCP,
	}
	rootCmd.AddCommand(mcpCmd)

	if err := rootCmd.Execute(); err != nil {
		log.Fatal(err)
	}
}

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

func runMCP(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// MCP 服务不持有单例锁，也不启动 HTTP server，允许每个会话独立启动
	svcs, cleanup, err := newAppServices(cfg)
	if err != nil {
		return err
	}
	defer cleanup()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	svcs.workflowSvc.StartEventBridge(ctx)

	log.Println("MCP server listening on stdio")
	mcp := mcpserver.New(svcs.workflowSvc, svcs.nodeSvc, svcs.nodeImportSvc)
	return mcp.Run(ctx)
}
