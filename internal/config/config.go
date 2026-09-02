package config

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

// Config 应用配置
type Config struct {
	Server    ServerConfig    `mapstructure:"server"`
	Data      DataConfig      `mapstructure:"data"`
	Retention RetentionConfig `mapstructure:"retention"`
	Backup    BackupConfig    `mapstructure:"backup"`
	Assets    AssetsConfig    `mapstructure:"assets"`
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port            int    `mapstructure:"port"`
	Host            string `mapstructure:"host"`
	NoOpen          bool   `mapstructure:"no_open"`
	AutoOpenBrowser bool   `mapstructure:"auto_open_browser"`
}

// DataConfig 数据配置
type DataConfig struct {
	Dir    string `mapstructure:"dir"`
	DBPath string `mapstructure:"db_path"`
}

// RetentionConfig 数据保留配置
type RetentionConfig struct {
	// 已废弃：execution_logs 保留天数迁移到系统配置 log_retention_days（设置页可编辑），
	// 此字段仅保留用于兼容旧配置文件，不再生效
	LogDays   int `mapstructure:"log_days"`
	AuditDays int `mapstructure:"audit_days"` // audit_logs 保留天数，0 表示不清理
}

// BackupConfig 自动备份配置
type BackupConfig struct {
	OnStartup bool `mapstructure:"on_startup"` // server 启动时自动备份
	Keep      int  `mapstructure:"keep"`       // 保留最近 N 个备份，0 表示不清理
}

// AssetsConfig 节点资产存储配置
type AssetsConfig struct {
	// 远程执行器（docker/k8s）拉取资产用的 HTTP base，需执行器网络可达。
	// 留空时按 server.host:port 推导（0.0.0.0 视为 127.0.0.1）。
	// 跨主机/容器场景应显式配置，如 http://192.168.1.10:8080
	HTTPBase string `mapstructure:"http_base"`
}

// Load 加载配置
func Load() (*Config, error) {
	viper.SetEnvPrefix("FLOWX_STUDIO")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	// 替换环境变量中的 ~
	home, _ := os.UserHomeDir()

	// 默认值
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.no_open", false)
	viper.SetDefault("server.auto_open_browser", true)
	viper.SetDefault("data.dir", filepath.Join(home, ".flowx-studio"))
	viper.SetDefault("retention.log_days", 30)
	viper.SetDefault("retention.audit_days", 90)
	viper.SetDefault("backup.on_startup", true)
	viper.SetDefault("backup.keep", 3)
	// db_path 不设默认值：未显式配置时由 data.dir 推导（见下方）

	// 配置文件
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(filepath.Join(home, ".flowx-studio"))
	viper.AddConfigPath(".")

	_ = viper.ReadInConfig() // 配置文件可选

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	// 展开 ~
	cfg.Data.Dir = expandPath(cfg.Data.Dir, home)
	cfg.Data.DBPath = expandPath(cfg.Data.DBPath, home)

	// 未显式配置 db_path 时，放在数据目录下
	if cfg.Data.DBPath == "" {
		cfg.Data.DBPath = filepath.Join(cfg.Data.Dir, "studio.db")
	}

	return &cfg, nil
}

func expandPath(path, home string) string {
	if len(path) > 0 && path[0] == '~' {
		return filepath.Join(home, path[1:])
	}
	return path
}
