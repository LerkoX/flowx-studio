package server

import (
	"os"
	"os/exec"
	"runtime"
)

// OpenBrowser 在默认浏览器中打开指定 URL。
// 仅在桌面环境（macOS / Windows / 有 DISPLAY 的 Linux）下尝试，失败时不阻塞启动。
func OpenBrowser(url string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	default: // linux 及其他
		// 无桌面环境（SSH/容器/服务器）时跳过
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return nil
		}
		cmd = "xdg-open"
		args = []string{url}
	}

	return exec.Command(cmd, args...).Start()
}
