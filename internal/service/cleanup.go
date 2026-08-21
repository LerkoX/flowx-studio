package service

import (
	"context"
	"log"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
)

// CleanupService 按保留天数定期清理历史数据（执行日志、审计日志）。
type CleanupService struct {
	db        *db.DB
	logDays   int
	auditDays int
}

// NewCleanupService 创建清理服务。days 为 0 表示该类数据不清理。
func NewCleanupService(database *db.DB, logDays, auditDays int) *CleanupService {
	return &CleanupService{db: database, logDays: logDays, auditDays: auditDays}
}

// RunOnce 立即执行一轮清理，返回各类数据的删除条数。
func (s *CleanupService) RunOnce() (logs, audits int64) {
	if s.logDays > 0 {
		cutoff := time.Now().AddDate(0, 0, -s.logDays)
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
	if s.logDays <= 0 && s.auditDays <= 0 {
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
