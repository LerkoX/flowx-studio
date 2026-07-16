package config

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

// Config 应用配置
type Config struct {
	Server ServerConfig `mapstructure:"server"`
	Data   DataConfig   `mapstructure:"data"`
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
	viper.SetDefault("data.db_path", filepath.Join(home, ".flowx-studio", "studio.db"))

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

	return &cfg, nil
}

func expandPath(path, home string) string {
	if len(path) > 0 && path[0] == '~' {
		return filepath.Join(home, path[1:])
	}
	return path
}
