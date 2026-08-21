package handler

import (
	"net/http"
	"os"

	"github.com/LerkoX/flowx-studio/internal/service"
	"github.com/gin-gonic/gin"
)

// BackupHandler 数据备份处理器
type BackupHandler struct {
	service *service.BackupService
}

// NewBackupHandler 创建备份处理器
func NewBackupHandler(svc *service.BackupService) *BackupHandler {
	return &BackupHandler{service: svc}
}

// RegisterRoutes 注册路由
func (h *BackupHandler) RegisterRoutes(r *gin.RouterGroup) {
	backups := r.Group("/backups")
	{
		backups.GET("", h.List)
		backups.POST("", h.Create)
		backups.GET("/:name/download", h.Download)
	}
}

// Create 创建备份
func (h *BackupHandler) Create(c *gin.Context) {
	info, err := h.service.Create()
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, info)
}

// List 列出备份
func (h *BackupHandler) List(c *gin.Context) {
	backups, err := h.service.List()
	if err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, backups)
}

// Download 下载备份文件
func (h *BackupHandler) Download(c *gin.Context) {
	path, err := h.service.BackupPath(c.Param("name"))
	if err != nil {
		Error(c, http.StatusNotFound, err.Error())
		return
	}
	fi, err := os.Stat(path)
	if err != nil {
		Error(c, http.StatusNotFound, "backup not found")
		return
	}
	c.Header("Content-Disposition", "attachment; filename="+fi.Name())
	c.File(path)
}
