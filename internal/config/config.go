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
	// 上传落点根目录（支持 ~）。留空 = 自动选白名单里名为 flowx-input 的根下的
	// uploads/（默认 ~/flowx-input/uploads；没有 flowx-input 则退第一个可写根）。
	// 显式配置的目录会自动纳入可读白名单（否则上传物没法经 /media/file 预览）。
	// 也可用 FLOWX_STUDIO_MEDIA_UPLOAD_DIR 覆盖。
	UploadDir string `mapstructure:"upload_dir"`
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

	// media.upload_dir：显式环境变量（非空白）优先，其次配置文件，都是空 = 自动落点。
	// 不能直接用 cfg.Media.UploadDir：viper 的 AutomaticEnv 会把「设置成空串的环境变量」
	// 当成显式设置，从而把配置文件里的值盖成空（systemd/docker-compose 注入空值是常见写法）。
	switch env := strings.TrimSpace(os.Getenv(uploadDirEnvKey)); {
	case env != "":
		cfg.Media.UploadDir = env
	default:
		cfg.Media.UploadDir = configFileString("media.upload_dir")
	}
	cfg.Media.UploadDir = expandPath(cfg.Media.UploadDir, home)

	// 展开 ~
	cfg.Data.Dir = expandPath(cfg.Data.Dir, home)
	cfg.Data.DBPath = expandPath(cfg.Data.DBPath, home)

	// 未显式配置 db_path 时，放在数据目录下
	if cfg.Data.DBPath == "" {
		cfg.Data.DBPath = filepath.Join(cfg.Data.Dir, "studio.db")
	}

	return &cfg, nil
}

// uploadDirEnvKey 上传落点目录的环境变量（与 viper AutomaticEnv 推导出的名字一致）
const uploadDirEnvKey = "FLOWX_STUDIO_MEDIA_UPLOAD_DIR"

// configFileString 只读配置文件里的字符串值，绕开 viper 的 AutomaticEnv：
// 直接 viper.Get(key) 会被同名环境变量覆盖（含空串这种脏配置），
// 而取父级 map 不受该叶子键的环境变量影响。
func configFileString(key string) string {
	idx := strings.LastIndex(key, ".")
	if idx <= 0 || !viper.InConfig(key) {
		return ""
	}
	parent, leaf := key[:idx], key[idx+1:]
	m := viper.GetStringMap(parent)
	if v, ok := m[leaf]; ok {
		if str, ok := v.(string); ok {
			return str
		}
	}
	return ""
}

func expandPath(path, home string) string {
	if len(path) > 0 && path[0] == '~' {
		return filepath.Join(home, path[1:])
	}
	return path
}
