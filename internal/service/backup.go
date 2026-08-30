package service

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/LerkoX/flowx-studio/internal/db"
)

// BackupInfo 备份文件信息
type BackupInfo struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Size       int64     `json:"size"`
	CreatedAt  time.Time `json:"createdAt"`
	AssetsName string    `json:"assetsName,omitempty"` // 配套的资产包（<name 去 .db>.assets.tar.gz）
	AssetsSize int64     `json:"assetsSize,omitempty"`
}

// BackupService SQLite 数据 + 节点资产备份与恢复。
// 数据库备份通过 SQLite Online Backup（VACUUM INTO）实现，运行中也可安全执行；
// 资产目录（<data.dir>/assets）以 tar.gz 形式与 .db 同名配套存放。
type BackupService struct {
	db        *db.DB
	backupDir string
	dbPath    string
	assetsDir string
}

// NewBackupService 创建备份服务，备份文件存放在 <data.dir>/backups/。
func NewBackupService(database *db.DB, dataDir, dbPath string) *BackupService {
	return &BackupService{
		db:        database,
		backupDir: filepath.Join(dataDir, "backups"),
		dbPath:    dbPath,
		assetsDir: filepath.Join(dataDir, "assets"),
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
	info := &BackupInfo{Name: name, Path: dest, Size: fi.Size(), CreatedAt: fi.ModTime()}

	// 配套打包节点资产目录（外置存储后，仅有 .db 不足以完整恢复节点）
	assetsName := strings.TrimSuffix(name, ".db") + ".assets.tar.gz"
	wrote, err := assets.TarGz(s.assetsDir, filepath.Join(s.backupDir, assetsName))
	if err != nil {
		log.Printf("backup: assets archive failed (db backup kept): %v", err)
	} else if wrote {
		if afi, err := os.Stat(filepath.Join(s.backupDir, assetsName)); err == nil {
			info.AssetsName = assetsName
			info.AssetsSize = afi.Size()
		}
	}
	return info, nil
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
		info := BackupInfo{
			Name:      e.Name(),
			Path:      filepath.Join(s.backupDir, e.Name()),
			Size:      fi.Size(),
			CreatedAt: fi.ModTime(),
		}
		// 配套资产包
		assetsName := strings.TrimSuffix(e.Name(), ".db") + ".assets.tar.gz"
		if afi, err := os.Stat(filepath.Join(s.backupDir, assetsName)); err == nil {
			info.AssetsName = assetsName
			info.AssetsSize = afi.Size()
		}
		backups = append(backups, info)
	}
	sort.Slice(backups, func(i, j int) bool { return backups[i].CreatedAt.After(backups[j].CreatedAt) })
	if backups == nil {
		backups = []BackupInfo{}
	}
	return backups, nil
}

// Prune 删除最旧的备份，只保留最近 keep 个。keep<=0 时不清理。
// 返回删除的文件数。
func (s *BackupService) Prune(keep int) (int, error) {
	if keep <= 0 {
		return 0, nil
	}
	backups, err := s.List()
	if err != nil {
		return 0, err
	}
	if len(backups) <= keep {
		return 0, nil
	}
	removed := 0
	for _, b := range backups[keep:] {
		if err := os.Remove(b.Path); err == nil {
			removed++
		}
		// 配套资产包一并清理
		if b.AssetsName != "" {
			_ = os.Remove(filepath.Join(s.backupDir, b.AssetsName))
		}
	}
	return removed, nil
}

// AutoOnStartup 启动时自动备份 + 按 keep 清理旧备份。备份失败只记日志不阻断启动。
func (s *BackupService) AutoOnStartup(keep int) {
	if _, err := os.Stat(s.dbPath); err != nil {
		return // 数据库尚未创建，跳过
	}
	info, err := s.Create()
	if err != nil {
		log.Printf("auto backup failed: %v", err)
		return
	}
	log.Printf("auto backup created: %s (%d bytes)", info.Name, info.Size)
	if removed, err := s.Prune(keep); err == nil && removed > 0 {
		log.Printf("auto backup pruned %d old backups (keep %d)", removed, keep)
	}
}

// BackupPath 按文件名解析备份完整路径（防目录穿越）。
// 允许 .db（数据库备份）与 .assets.tar.gz（配套资产包）两类文件。
func (s *BackupService) BackupPath(name string) (string, error) {
	valid := name != "" && name == filepath.Base(name) &&
		(filepath.Ext(name) == ".db" || strings.HasSuffix(name, ".assets.tar.gz"))
	if !valid {
		return "", fmt.Errorf("invalid backup name")
	}
	path := filepath.Join(s.backupDir, name)
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("backup not found: %s", name)
	}
	return path, nil
}
