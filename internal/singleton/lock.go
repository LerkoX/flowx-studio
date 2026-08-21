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

// FindRunning 读取 pidFile 并校验对应进程是否为匹配 commandName 的存活进程。
// 供 daemon 管理命令（server stop/status）复用，不改变锁状态。
func FindRunning(pidFile, commandName string) (pid int, running bool) {
	l := &Lock{pidFile: pidFile, commandName: commandName}
	return l.readExisting()
}

// Lock 进程级单例锁，通过 PID 文件实现
type Lock struct {
	pidFile     string
	commandName string
}

// New 创建单例锁
// commandName 用于匹配已有进程命令行中的子命令，避免误杀其他子命令进程
func New(pidFile, commandName string) *Lock {
	return &Lock{pidFile: pidFile, commandName: commandName}
}

// Acquire 获取锁。如果已有同子命令实例在运行，会优雅终止它。
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
	// 优先通过 /proc/<pid>/exe 与当前可执行文件比对，对二进制重命名（如测试构建）健壮
	if self, err := os.Executable(); err == nil {
		if exe, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid)); err == nil {
			if exe != self {
				return false
			}
		}
	}
	cmdline, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return false
	}
	cmd := strings.ReplaceAll(string(cmdline), "\x00", " ")
	if l.commandName != "" && !strings.Contains(cmd, l.commandName) {
		return false
	}
	return true
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
