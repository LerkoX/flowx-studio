package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/LerkoX/flowx-studio/internal/db"
)

// BackupInfo 备份文件信息
type BackupInfo struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

// BackupService SQLite 数据备份与恢复。
// 备份通过 SQLite Online Backup（VACUUM INTO）实现，运行中也可安全执行。
type BackupService struct {
	db        *db.DB
	backupDir string
	dbPath    string
}

// NewBackupService 创建备份服务，备份文件存放在 <data.dir>/backups/。
func NewBackupService(database *db.DB, dataDir, dbPath string) *BackupService {
	return &BackupService{
		db:        database,
		backupDir: filepath.Join(dataDir, "backups"),
		dbPath:    dbPath,
	}
}

// BackupDir 返回备份目录
func (s *BackupService) BackupDir() string { return s.backupDir }

// Create 创建一次备份，返回备份文件信息。
func (s *BackupService) Create() (*BackupInfo, error) {
	if err := os.MkdirAll(s.backupDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create backup dir: %w", err)
	}

	name := "studio-" + time.Now().Format("20060102-150405") + ".db"
	dest := filepath.Join(s.backupDir, name)

	// VACUUM INTO 生成一致性的紧凑副本（SQLite 3.27+，WAL 模式下安全）
	if _, err := s.db.Exec(fmt.Sprintf("VACUUM INTO '%s'", dest)); err != nil {
		return nil, fmt.Errorf("failed to create backup: %w", err)
	}

	fi, err := os.Stat(dest)
	if err != nil {
		return nil, err
	}
	return &BackupInfo{Name: name, Path: dest, Size: fi.Size(), CreatedAt: fi.ModTime()}, nil
}

// List 列出所有备份文件（按时间倒序）。
func (s *BackupService) List() ([]BackupInfo, error) {
	entries, err := os.ReadDir(s.backupDir)
	if os.IsNotExist(err) {
		return []BackupInfo{}, nil
	}
	if err != nil {
		return nil, err
	}

	var backups []BackupInfo
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".db" {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		backups = append(backups, BackupInfo{
			Name:      e.Name(),
			Path:      filepath.Join(s.backupDir, e.Name()),
			Size:      fi.Size(),
			CreatedAt: fi.ModTime(),
		})
	}
	sort.Slice(backups, func(i, j int) bool { return backups[i].CreatedAt.After(backups[j].CreatedAt) })
	if backups == nil {
		backups = []BackupInfo{}
	}
	return backups, nil
}

// BackupPath 按文件名解析备份完整路径（防目录穿越）。
func (s *BackupService) BackupPath(name string) (string, error) {
	if name == "" || name != filepath.Base(name) || filepath.Ext(name) != ".db" {
		return "", fmt.Errorf("invalid backup name")
	}
	path := filepath.Join(s.backupDir, name)
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("backup not found: %s", name)
	}
	return path, nil
}
