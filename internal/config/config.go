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
	Media     MediaConfig     `mapstructure:"media"`
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

// MediaConfig 本地多媒体文件服务配置
type MediaConfig struct {
	// 允许通过 /api/v1/media/file 读取的本地目录白名单（支持 ~），
	// 默认 [~/flowx-output, ~/flowx-input]（节点默认输出/输入目录）。
	// 也可通过 FLOWX_STUDIO_MEDIA_ROOTS 环境变量配置（逗号分隔），显式设置时覆盖配置文件。
	Roots []string `mapstructure:"roots"`
}

// AssetsConfig 节点资产存储配置
type AssetsConfig struct {
	// 远程执行器（docker/k8s）拉取资产用的 HTTP base，需执行器网络可达。
	// 留空时按 server.host:port 推导（0.0.0.0 等通配地址自动探测局域网 IP）。
	// 跨主机/容器场景可显式配置覆盖，如 http://192.168.1.10:8080
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

	// AutomaticEnv 的值不会反映在未注册键（无默认值/配置文件项）的 Unmarshal
	// 结果中，assets.http_base 需显式回读，否则 FLOWX_STUDIO_ASSETS_HTTP_BASE
	// 环境变量形同虚设。
	if cfg.Assets.HTTPBase == "" {
		cfg.Assets.HTTPBase = viper.GetString("assets.http_base")
	}

	// media.roots 环境变量覆盖（逗号分隔）；未配置时默认 ~/flowx-output
	if env := os.Getenv("FLOWX_STUDIO_MEDIA_ROOTS"); env != "" {
		var roots []string
		for _, r := range strings.Split(env, ",") {
			if r = strings.TrimSpace(r); r != "" {
				roots = append(roots, r)
			}
		}
		cfg.Media.Roots = roots
	}
	if len(cfg.Media.Roots) == 0 {
		cfg.Media.Roots = []string{
			filepath.Join(home, "flowx-output"), // save-image/save-video 等节点的默认输出目录
			filepath.Join(home, "flowx-input"),  // load-image 等节点的默认输入目录
		}
	}
	for i, r := range cfg.Media.Roots {
		cfg.Media.Roots[i] = expandPath(r, home)
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
