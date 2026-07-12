package singleton

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Lock 进程级单例锁，通过 PID 文件实现
type Lock struct {
	pidFile string
}

// New 创建单例锁
func New(pidFile string) *Lock {
	return &Lock{pidFile: pidFile}
}

// Acquire 获取锁。如果已有实例在运行，会优雅终止它。
func (l *Lock) Acquire() error {
	if err := os.MkdirAll(filepath.Dir(l.pidFile), 0755); err != nil {
		return fmt.Errorf("failed to create pid dir: %w", err)
	}

	if pid, running := l.readExisting(); running {
		if err := l.kill(pid); err != nil {
			return fmt.Errorf("failed to kill existing process %d: %w", pid, err)
		}
	}

	return os.WriteFile(l.pidFile, []byte(strconv.Itoa(os.Getpid())), 0644)
}

// Release 释放锁
func (l *Lock) Release() error {
	if _, err := os.Stat(l.pidFile); err != nil {
		return nil
	}
	return os.Remove(l.pidFile)
}

func (l *Lock) readExisting() (int, bool) {
	data, err := os.ReadFile(l.pidFile)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	return pid, l.isRunning(pid)
}

func (l *Lock) isRunning(pid int) bool {
	cmdline, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return false
	}
	cmd := strings.ReplaceAll(string(cmdline), "\x00", " ")
	return strings.Contains(cmd, "flowx-studio")
}

func (l *Lock) kill(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}

	if err := p.Signal(syscall.SIGTERM); err != nil {
		return err
	}

	for i := 0; i < 50; i++ {
		if !l.isRunning(pid) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	return p.Signal(syscall.SIGKILL)
}
