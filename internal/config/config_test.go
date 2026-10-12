package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

// setupHome 把 HOME 指到临时目录，并在其中写 config.yaml（写空串 = 不写文件）。
func setupHome(t *testing.T, yaml string) string {
	t.Helper()
	viper.Reset()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("FLOWX_STUDIO_MEDIA_ROOTS", "")
	t.Setenv("FLOWX_STUDIO_MEDIA_UPLOAD_DIR", "")
	if yaml != "" {
		dir := filepath.Join(home, ".flowx-studio")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(yaml), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

// 未配置 media.upload_dir 时留空 —— 由 handler 自动选 flowx-input/uploads。
func TestLoadUploadDirUnset(t *testing.T) {
	home := setupHome(t, "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Media.UploadDir != "" {
		t.Fatalf("expect empty upload dir (auto), got %q", cfg.Media.UploadDir)
	}
	// 未配置 media.roots 时的默认白名单不变
	if len(cfg.Media.Roots) != 2 ||
		cfg.Media.Roots[0] != filepath.Join(home, "flowx-output") ||
		cfg.Media.Roots[1] != filepath.Join(home, "flowx-input") {
		t.Fatalf("default roots wrong: %v", cfg.Media.Roots)
	}
}

func TestLoadUploadDirFromConfigFile(t *testing.T) {
	home := setupHome(t, `media:
  roots:
    - ~/flowx-input
  upload_dir: ~/flowx-receive
`)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Media.UploadDir != filepath.Join(home, "flowx-receive") {
		t.Fatalf("upload_dir ~ not expanded: %q", cfg.Media.UploadDir)
	}
}

func TestLoadUploadDirEnvOverride(t *testing.T) {
	home := setupHome(t, `media:
  upload_dir: ~/from-file
`)
	custom := filepath.Join(home, "from-env")
	t.Setenv("FLOWX_STUDIO_MEDIA_UPLOAD_DIR", custom)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Media.UploadDir != custom {
		t.Fatalf("env override not honored: %q", cfg.Media.UploadDir)
	}
	// 空白值视为未配置 → 配置文件里的值生效
	t.Setenv("FLOWX_STUDIO_MEDIA_UPLOAD_DIR", "   ")
	viper.Reset()
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Media.UploadDir != filepath.Join(home, "from-file") {
		t.Fatalf("blank env must not clobber config file: %q", cfg.Media.UploadDir)
	}
}
