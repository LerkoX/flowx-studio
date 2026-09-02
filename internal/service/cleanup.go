package service

import (
	"context"
	"log"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
)

// CleanupService 按保留天数定期清理历史数据（执行日志、审计日志）。
// 执行日志保留天数读取系统配置 log_retention_days（设置页可改，每轮清理前重读即时生效）；
// 审计日志保留天数来自配置文件 retention.audit_days。
type CleanupService struct {
	db        *db.DB
	cfg       *SystemConfigService
	auditDays int
}

// NewCleanupService 创建清理服务。审计保留天数为 0 表示不清理。
func NewCleanupService(database *db.DB, cfg *SystemConfigService, auditDays int) *CleanupService {
	return &CleanupService{db: database, cfg: cfg, auditDays: auditDays}
}

// logRetentionDays 每轮清理前重读系统配置，0/负值/未设置表示不清理
func (s *CleanupService) logRetentionDays() int {
	if s.cfg == nil {
		return 0
	}
	return s.cfg.GetInt("log_retention_days", 0)
}

// RunOnce 立即执行一轮清理，返回各类数据的删除条数。
func (s *CleanupService) RunOnce() (logs, audits int64) {
	if logDays := s.logRetentionDays(); logDays > 0 {
		cutoff := time.Now().AddDate(0, 0, -logDays)
		if res, err := s.db.Exec("DELETE FROM execution_logs WHERE timestamp < ?", cutoff); err == nil {
			logs, _ = res.RowsAffected()
		} else {
			log.Printf("cleanup execution_logs failed: %v", err)
		}
	}
	if s.auditDays > 0 {
		cutoff := time.Now().AddDate(0, 0, -s.auditDays)
		if res, err := s.db.Exec("DELETE FROM audit_logs WHERE created_at < ?", cutoff); err == nil {
			audits, _ = res.RowsAffected()
		} else {
			log.Printf("cleanup audit_logs failed: %v", err)
		}
	}
	return logs, audits
}

// Start 启动定时清理：立即执行一轮，之后每 24 小时执行一轮。
func (s *CleanupService) Start(ctx context.Context) {
	if s.logRetentionDays() <= 0 && s.auditDays <= 0 {
		return
	}
	if logs, audits := s.RunOnce(); logs > 0 || audits > 0 {
		log.Printf("cleanup: purged %d execution logs, %d audit logs", logs, audits)
	}
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if logs, audits := s.RunOnce(); logs > 0 || audits > 0 {
					log.Printf("cleanup: purged %d execution logs, %d audit logs", logs, audits)
				}
			}
		}
	}()
}
