package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Result 执行结果
type Result struct {
	Status     string                 `json:"status"`      // success | failed | timeout
	DurationMs int64                  `json:"duration_ms"`
	Output     map[string]interface{} `json:"output,omitempty"`
	Stdout     string                 `json:"stdout,omitempty"`
	Stderr     string                 `json:"stderr,omitempty"`
	Logs       string                 `json:"logs"`
	Error      string                 `json:"error,omitempty"`
	ExitCode   int                    `json:"exit_code,omitempty"`
}

// Executor 沙箱执行器
type Executor struct {
	// 超时时间（默认 30s）
	Timeout time.Duration
	// 最大输出长度（默认 1MB）
	MaxOutputSize int64
	// 工作目录（默认系统临时目录）
	WorkDir string
}

// NewExecutor 创建执行器
func NewExecutor() *Executor {
	return &Executor{
		Timeout:       30 * time.Second,
		MaxOutputSize: 1024 * 1024, // 1MB
		WorkDir:       os.TempDir(),
	}
}

// ExecuteOptions 执行选项
type ExecuteOptions struct {
	// 节点代码
	Code string
	// 编程语言
	Language string
	// 入口文件（可选，如 main.py）
	Entry string
	// 环境变量参数
	EnvVars map[string]string
	// 额外环境变量
	ExtraEnv map[string]string
}

// Execute 执行节点代码
func (e *Executor) Execute(opts ExecuteOptions) *Result {
	start := time.Now()
	result := &Result{
		Status: "failed",
		Logs:   "",
	}

	// 1. 安全检查
	if err := e.validate(opts); err != nil {
		result.Error = err.Error()
		result.Logs = fmt.Sprintf("[Security Check Failed] %s", err.Error())
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}

	// 2. 创建临时工作目录
	workDir, err := os.MkdirTemp(e.WorkDir, "flowx_mock_*")
	if err != nil {
		result.Error = fmt.Sprintf("failed to create work dir: %v", err)
		result.Logs = result.Error
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}
	defer os.RemoveAll(workDir)

	// 3. 写入代码文件
	codeFile, err := e.writeCodeFile(workDir, opts)
	if err != nil {
		result.Error = err.Error()
		result.Logs = result.Error
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}

	// 4. 构建执行命令
	cmdArgs, err := e.buildCommand(opts.Language, codeFile, opts.Entry)
	if err != nil {
		result.Error = err.Error()
		result.Logs = result.Error
		result.DurationMs = time.Since(start).Milliseconds()
		return result
	}

	// 5. 执行子进程
	ctx, cancel := context.WithTimeout(context.Background(), e.Timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, cmdArgs[0], cmdArgs[1:]...)
	cmd.Dir = workDir

	// 设置环境变量
	env := os.Environ()
	for k, v := range opts.EnvVars {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	for k, v := range opts.ExtraEnv {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env

	// 捕获输出
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	result.Logs += fmt.Sprintf("> Executing: %s\n", strings.Join(cmdArgs, " "))
	result.Logs += fmt.Sprintf("> Working directory: %s\n", workDir)
	result.Logs += fmt.Sprintf("> Timeout: %v\n\n", e.Timeout)

	runErr := cmd.Run()

	// 6. 处理结果
	stdout := stdoutBuf.String()
	stderr := stderrBuf.String()

	// 截断过长的输出
	if int64(len(stdout)) > e.MaxOutputSize {
		stdout = stdout[:e.MaxOutputSize] + "\n... (output truncated)"
	}
	if int64(len(stderr)) > e.MaxOutputSize {
		stderr = stderr[:e.MaxOutputSize] + "\n... (stderr truncated)"
	}

	result.Stdout = stdout
	result.Stderr = stderr
	result.DurationMs = time.Since(start).Milliseconds()

	// 检查是否超时
	if ctx.Err() == context.DeadlineExceeded {
		result.Status = "timeout"
		result.Error = fmt.Sprintf("execution timed out after %v", e.Timeout)
		result.Logs += fmt.Sprintf("[TIMEOUT] Execution exceeded %v\n", e.Timeout)
		result.ExitCode = -1
		return result
	}

	// 检查执行错误
	if runErr != nil {
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.ExitCode = -1
		}
		result.Error = runErr.Error()
		result.Logs += fmt.Sprintf("[ERROR] Exit code: %d\n", result.ExitCode)
		result.Logs += fmt.Sprintf("[STDERR] %s\n", stderr)
		return result
	}

	// 成功
	result.Status = "success"
	result.ExitCode = 0
	result.Logs += fmt.Sprintf("[SUCCESS] Execution completed in %dms\n", result.DurationMs)
	result.Logs += fmt.Sprintf("[STDOUT] %s\n", stdout)
	if stderr != "" {
		result.Logs += fmt.Sprintf("[STDERR] %s\n", stderr)
	}

	// 尝试解析 stdout 为 JSON 输出
	if stdout != "" {
		var output map[string]interface{}
		// 尝试从 stdout 解析 JSON
		if err := parseJSONOutput(stdout, &output); err == nil {
			result.Output = output
		} else {
			// 如果不是 JSON，将整个 stdout 作为输出
			result.Output = map[string]interface{}{
				"raw": stdout,
			}
		}
	}

	return result
}

// validate 安全校验
func (e *Executor) validate(opts ExecuteOptions) error {
	// 检查代码是否为空
	if strings.TrimSpace(opts.Code) == "" {
		return fmt.Errorf("code is empty")
	}

	// 检查语言是否支持
	supportedLangs := []string{"python", "go", "bash", "sh", "javascript", "js", "typescript", "ts", "ruby", "php"}
	found := false
	for _, lang := range supportedLangs {
		if strings.ToLower(opts.Language) == lang {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("unsupported language: %s (supported: %v)", opts.Language, supportedLangs)
	}

	// 检查代码中是否包含危险操作
	if err := validateCodeSecurity(opts.Code, opts.Language); err != nil {
		return err
	}

	return nil
}

// writeCodeFile 将代码写入临时文件
func (e *Executor) writeCodeFile(workDir string, opts ExecuteOptions) (string, error) {
	var filename string
	lang := strings.ToLower(opts.Language)

	switch lang {
	case "python":
		filename = "main.py"
	case "go":
		filename = "main.go"
	case "bash", "sh":
		filename = "main.sh"
	case "javascript", "js":
		filename = "main.js"
	case "typescript", "ts":
		filename = "main.ts"
	case "ruby":
		filename = "main.rb"
	case "php":
		filename = "main.php"
	default:
		filename = "main.txt"
	}

	// 如果指定了 entry，使用 entry 的文件名
	if opts.Entry != "" {
		filename = opts.Entry
	}

	filepath := filepath.Join(workDir, filename)
	if err := os.WriteFile(filepath, []byte(opts.Code), 0644); err != nil {
		return "", fmt.Errorf("failed to write code file: %w", err)
	}

	// 对于脚本语言，添加执行权限
	if lang == "bash" || lang == "sh" {
		os.Chmod(filepath, 0755)
	}

	return filepath, nil
}

// buildCommand 构建执行命令
func (e *Executor) buildCommand(language, codeFile, entry string) ([]string, error) {
	lang := strings.ToLower(language)

	switch lang {
	case "python":
		// 优先使用 python3，回退到 python
		if _, err := exec.LookPath("python3"); err == nil {
			return []string{"python3", codeFile}, nil
		}
		if _, err := exec.LookPath("python"); err == nil {
			return []string{"python", codeFile}, nil
		}
		return nil, fmt.Errorf("python interpreter not found")

	case "go":
		if _, err := exec.LookPath("go"); err != nil {
			return nil, fmt.Errorf("go compiler not found")
		}
		// go run 直接运行
		return []string{"go", "run", codeFile}, nil

	case "bash", "sh":
		if _, err := exec.LookPath("bash"); err == nil {
			return []string{"bash", codeFile}, nil
		}
		if _, err := exec.LookPath("sh"); err == nil {
			return []string{"sh", codeFile}, nil
		}
		return nil, fmt.Errorf("shell interpreter not found")

	case "javascript", "js":
		if _, err := exec.LookPath("node"); err != nil {
			return nil, fmt.Errorf("node.js not found")
		}
		return []string{"node", codeFile}, nil

	case "typescript", "ts":
		// 优先使用 ts-node，回退到 npx ts-node
		if _, err := exec.LookPath("ts-node"); err == nil {
			return []string{"ts-node", codeFile}, nil
		}
		if _, err := exec.LookPath("npx"); err == nil {
			return []string{"npx", "ts-node", codeFile}, nil
		}
		return nil, fmt.Errorf("ts-node not found, please install: npm install -g ts-node")

	case "ruby":
		if _, err := exec.LookPath("ruby"); err != nil {
			return nil, fmt.Errorf("ruby interpreter not found")
		}
		return []string{"ruby", codeFile}, nil

	case "php":
		if _, err := exec.LookPath("php"); err != nil {
			return nil, fmt.Errorf("php interpreter not found")
		}
		return []string{"php", codeFile}, nil

	default:
		return nil, fmt.Errorf("unsupported language: %s", language)
	}
}

// validateCodeSecurity 代码安全校验
func validateCodeSecurity(code, language string) error {
	lang := strings.ToLower(language)

	// 通用危险模式（所有语言）
	dangerousPatterns := []string{
		"os.system", "subprocess.call", "subprocess.run", "subprocess.Popen",
		"eval(", "exec(", "__import__(", "importlib",
		"open('/", "open(\"/_", "open('/etc", "open('/root",
		"socket.socket", "urllib.request", "http.client",
		"ftplib", "smtplib", "telnetlib",
	}

	// Bash 特有的危险命令
	bashDangerous := []string{
		"rm -rf", "rm -fr", "rm -r /", "> /dev", "mkfs", "fdisk",
		"dd if", ":(){ :|:& };:", "wget | sh", "curl | sh",
		"bash -i", "sh -i", "/bin/bash -i", "/bin/sh -i",
		"nc -e", "ncat -e", "nc -l", "python -c 'import socket'",
	}

	// 根据语言选择检查模式
	patterns := dangerousPatterns
	if lang == "bash" || lang == "sh" {
		patterns = append(patterns, bashDangerous...)
	}

	// 检查代码中是否包含危险模式
	codeLower := strings.ToLower(code)
	for _, pattern := range patterns {
		if strings.Contains(codeLower, strings.ToLower(pattern)) {
			return fmt.Errorf("security violation: dangerous pattern detected '%s'", pattern)
		}
	}

	// 检查是否尝试访问敏感路径
	sensitivePaths := []string{
		"/etc/passwd", "/etc/shadow", "/etc/hosts",
		"/root", "/home", "/proc", "/sys",
		"/.ssh", "/.aws", "/.kube",
	}
	for _, path := range sensitivePaths {
		if strings.Contains(codeLower, path) {
			return fmt.Errorf("security violation: access to sensitive path '%s'", path)
		}
	}

	return nil
}

// parseJSONOutput 尝试从输出中解析 JSON
func parseJSONOutput(output string, result *map[string]interface{}) error {
	// 尝试直接解析
	if err := jsonUnmarshal([]byte(output), result); err == nil {
		return nil
	}

	// 尝试提取最后一行 JSON（有些脚本会打印日志后输出 JSON）
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if err := jsonUnmarshal([]byte(line), result); err == nil {
			return nil
		}
	}

	return fmt.Errorf("no JSON output found")
}

// jsonUnmarshal 包装 json.Unmarshal
func jsonUnmarshal(data []byte, v *map[string]interface{}) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return fmt.Errorf("empty data")
	}
	if data[0] != '{' && data[0] != '[' {
		return fmt.Errorf("not JSON")
	}
	return json.Unmarshal(data, v)
}

// IsLanguageSupported 检查语言是否支持
func IsLanguageSupported(language string) bool {
	supported := []string{"python", "go", "bash", "sh", "javascript", "js", "typescript", "ts", "ruby", "php"}
	for _, lang := range supported {
		if strings.ToLower(language) == lang {
			return true
		}
	}
	return false
}

// GetSupportedLanguages 获取支持的语言列表
func GetSupportedLanguages() []string {
	return []string{"python", "go", "bash", "sh", "javascript", "typescript", "ruby", "php"}
}
