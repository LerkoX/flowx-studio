package service

import (
	"fmt"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/model"
)

// AuditService 审计日志服务：记录与查询写操作。
type AuditService struct {
	db *db.DB
}

// NewAuditService 创建审计服务
func NewAuditService(database *db.DB) *AuditService {
	return &AuditService{db: database}
}

// Record 写入一条审计日志。审计失败不影响主流程，仅返回 error 供调用方记录。
func (s *AuditService) Record(action, resourceType, resourceID, detail string) error {
	_, err := s.db.Exec(`
		INSERT INTO audit_logs (action, resource_type, resource_id, detail)
		VALUES (?, ?, ?, ?)
	`, action, resourceType, resourceID, detail)
	return err
}

// List 分页查询审计日志，可按 action / resource_type 过滤。
func (s *AuditService) List(action, resourceType string, page, pageSize int) (*model.PaginatedResponse, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 20
	}

	where := " WHERE 1=1"
	args := []interface{}{}
	if action != "" {
		where += " AND action = ?"
		args = append(args, action)
	}
	if resourceType != "" {
		where += " AND resource_type = ?"
		args = append(args, resourceType)
	}

	var total int
	if err := s.db.Get(&total, "SELECT COUNT(*) FROM audit_logs"+where, args...); err != nil {
		return nil, fmt.Errorf("failed to count audit logs: %w", err)
	}

	var items []model.AuditLog
	query := "SELECT * FROM audit_logs" + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, (page-1)*pageSize)
	if err := s.db.Select(&items, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list audit logs: %w", err)
	}
	if items == nil {
		items = []model.AuditLog{}
	}

	return &model.PaginatedResponse{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

// PurgeBefore 删除 cutoff 之前的审计日志，返回删除条数。
func (s *AuditService) PurgeBefore(cutoff string) (int64, error) {
	res, err := s.db.Exec("DELETE FROM audit_logs WHERE created_at < ?", cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
