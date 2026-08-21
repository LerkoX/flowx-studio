package handler

import (
	"net/http"
	"os"
	goruntime "runtime"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/gin-gonic/gin"
)

// HealthHandler 健康检查与系统指标处理器。
// 不挂在认证路由组下，供监控探针与 daemon 探测使用（不泄露敏感数据）。
type HealthHandler struct {
	db        *db.DB
	dbPath    string
	version   string
	startedAt time.Time
}

// NewHealthHandler 创建健康检查处理器
func NewHealthHandler(database *db.DB, dbPath, version string) *HealthHandler {
	return &HealthHandler{db: database, dbPath: dbPath, version: version, startedAt: time.Now()}
}

// RegisterRoutes 注册路由（无认证）
func (h *HealthHandler) RegisterRoutes(r *gin.Engine) {
	r.GET("/api/v1/health", h.Health)
}

// Health 返回服务健康状态与关键指标
func (h *HealthHandler) Health(c *gin.Context) {
	var nodes, workflows, executions, auditLogs int64
	dbOK := true
	if err := h.db.Get(&nodes, "SELECT COUNT(*) FROM nodes"); err != nil {
		dbOK = false
	}
	if err := h.db.Get(&workflows, "SELECT COUNT(*) FROM workflows"); err != nil {
		dbOK = false
	}
	if err := h.db.Get(&executions, "SELECT COUNT(*) FROM executions"); err != nil {
		dbOK = false
	}
	if err := h.db.Get(&auditLogs, "SELECT COUNT(*) FROM audit_logs"); err != nil {
		dbOK = false
	}

	var dbSize int64
	if fi, err := os.Stat(h.dbPath); err == nil {
		dbSize = fi.Size()
	}

	var mem goruntime.MemStats
	goruntime.ReadMemStats(&mem)

	status := "ok"
	if !dbOK {
		status = "degraded"
	}

	c.JSON(http.StatusOK, gin.H{
		"status":     status,
		"version":    h.version,
		"uptime_sec": int64(time.Since(h.startedAt).Seconds()),
		"db": gin.H{
			"ok":         dbOK,
			"size_bytes": dbSize,
			"nodes":      nodes,
			"workflows":  workflows,
			"executions": executions,
			"audit_logs": auditLogs,
		},
		"runtime": gin.H{
			"goroutines":    goruntime.NumGoroutine(),
			"heap_alloc_mb": float64(mem.HeapAlloc) / 1024 / 1024,
		},
	})
}
