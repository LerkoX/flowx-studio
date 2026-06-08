package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// DB 包装 sqlx.DB
type DB struct {
	*sqlx.DB
}

// New 创建数据库连接并执行迁移
func New(dbPath string) (*DB, error) {
	// 确保目录存在
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory: %w", err)
	}

	// 打开数据库
	db, err := sqlx.Open("sqlite", dbPath+"?_fk=1")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// 启用外键
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	// 执行迁移
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return &DB{db}, nil
}

func runMigrations(db *sqlx.DB) error {
	// 创建迁移记录表
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version     INTEGER PRIMARY KEY,
			applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return err
	}

	// 读取迁移文件
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		// 解析版本号，格式: 001_init.sql
		versionStr := strings.Split(entry.Name(), "_")[0]
		version, err := strconv.Atoi(versionStr)
		if err != nil {
			continue
		}

		// 检查是否已应用
		var applied int
		err = db.Get(&applied, "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", version)
		if err != nil {
			return err
		}
		if applied > 0 {
			continue
		}

		// 读取并执行迁移
		f, err := migrationsFS.Open("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		content, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			return err
		}

		// 在事务中执行
		tx, err := db.Beginx()
		if err != nil {
			return err
		}

		if _, err := tx.Exec(string(content)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s failed: %w", entry.Name(), err)
		}

		if _, err := tx.Exec("INSERT INTO schema_migrations (version) VALUES (?)", version); err != nil {
			tx.Rollback()
			return err
		}

		if err := tx.Commit(); err != nil {
			return err
		}
	}

	return nil
}

// Close 关闭数据库连接
func (db *DB) Close() error {
	return db.DB.Close()
}

// Beginx 开始事务
func (db *DB) Beginx() (*sqlx.Tx, error) {
	return db.DB.Beginx()
}

// QueryRowx 查询单行
func (db *DB) QueryRowx(query string, args ...interface{}) *sqlx.Row {
	return db.DB.QueryRowx(query, args...)
}

// Queryx 查询多行
func (db *DB) Queryx(query string, args ...interface{}) (*sqlx.Rows, error) {
	return db.DB.Queryx(query, args...)
}

// Exec 执行 SQL
func (db *DB) Exec(query string, args ...interface{}) (sql.Result, error) {
	return db.DB.Exec(query, args...)
}

// Get 查询单行到结构体
func (db *DB) Get(dest interface{}, query string, args ...interface{}) error {
	return db.DB.Get(dest, query, args...)
}

// Select 查询多行到切片
func (db *DB) Select(dest interface{}, query string, args ...interface{}) error {
	return db.DB.Select(dest, query, args...)
}
