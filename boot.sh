#!/usr/bin/env bash
#
# FlowX Studio 一键启动脚本
# 支持：开发模式、生产模式、后台守护进程模式
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认配置
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="flowx-studio"
BINARY_NAME="flowx-studio"
PID_FILE="/tmp/flowx-studio.pid"
LOG_FILE="/tmp/flowx-studio.log"
DATA_DIR="${HOME}/.flowx-studio"
PORT=8080
HOST="0.0.0.0"

# 打印带颜色的信息
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_deps() {
    info "Checking dependencies..."
    
    # 检查 Go
    if ! command -v go &> /dev/null; then
        error "Go is not installed. Please install Go 1.21+ first."
        exit 1
    fi
    
    local go_version=$(go version | awk '{print $3}' | sed 's/go//')
    info "Go version: $go_version"
    
    # 检查 Node.js (如果需要构建前端)
    if [ "$BUILD_WEB" = "true" ]; then
        if ! command -v node &> /dev/null; then
            error "Node.js is not installed. Please install Node.js 18+ first."
            exit 1
        fi
        local node_version=$(node --version)
        info "Node.js version: $node_version"
        
        if ! command -v npm &> /dev/null; then
            error "npm is not installed."
            exit 1
        fi
    fi
    
    success "Dependencies check passed"
}

# 检查前端是否已构建
check_web_dist() {
    if [ ! -d "${SCRIPT_DIR}/web/dist" ] && [ ! -d "${SCRIPT_DIR}/internal/server/web/dist" ]; then
        warn "Frontend build not found. Will build automatically."
        BUILD_WEB="true"
    fi
}

# 构建前端
build_web() {
    if [ "$BUILD_WEB" != "true" ]; then
        return 0
    fi
    
    info "Building frontend..."
    cd "${SCRIPT_DIR}/web"
    
    if [ ! -d "node_modules" ]; then
        info "Installing npm dependencies..."
        npm install
    fi
    
    npm run build
    success "Frontend build complete"
    
    # 复制到 embed 目录
    info "Copying frontend to embed directory..."
    rm -rf "${SCRIPT_DIR}/internal/server/web/dist"
    mkdir -p "${SCRIPT_DIR}/internal/server/web/dist"
    cp -r "${SCRIPT_DIR}/web/dist/"* "${SCRIPT_DIR}/internal/server/web/dist/"
    success "Frontend copied to embed directory"
    
    cd "${SCRIPT_DIR}"
}

# 构建后端
build_backend() {
    info "Building backend..."
    cd "${SCRIPT_DIR}"
    
    # 下载 Go 依赖
    if [ ! -d "vendor" ] && [ ! -f "go.sum" ]; then
        info "Downloading Go dependencies..."
        go mod tidy
    fi
    
    # 构建二进制
    local ldflags=""
    if [ "$MODE" = "prod" ]; then
        # 生产模式：压缩二进制
        ldflags="-s -w"
    fi
    
    go build -ldflags "$ldflags" -o "${BINARY_NAME}" "${SCRIPT_DIR}/cmd/flowx-studio/main.go"
    success "Backend build complete: ${BINARY_NAME}"
}

# 检查是否已在运行
check_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            warn "FlowX Studio is already running (PID: $pid)"
            info "Visit http://localhost:${PORT}"
            return 0
        else
            rm -f "$PID_FILE"
        fi
    fi
    return 1
}

# 启动服务（前台）
start_foreground() {
    info "Starting FlowX Studio in foreground mode..."
    info "Data directory: ${DATA_DIR}"
    info "Server: http://${HOST}:${PORT}"
    info "Press Ctrl+C to stop"
    echo ""
    
    "${SCRIPT_DIR}/${BINARY_NAME}" server \
        --port "${PORT}" \
        --host "${HOST}" \
        --data-dir "${DATA_DIR}"
}

# 启动服务（后台）
start_daemon() {
    info "Starting FlowX Studio in daemon mode..."
    info "Data directory: ${DATA_DIR}"
    info "Server: http://${HOST}:${PORT}"
    info "Log file: ${LOG_FILE}"
    
    nohup "${SCRIPT_DIR}/${BINARY_NAME}" server \
        --port "${PORT}" \
        --host "${HOST}" \
        --data-dir "${DATA_DIR}" \
        > "${LOG_FILE}" 2>&1 &
    
    local pid=$!
    echo $pid > "$PID_FILE"
    
    # 等待服务启动
    sleep 2
    if ps -p "$pid" > /dev/null 2>&1; then
        success "FlowX Studio started (PID: $pid)"
        info "Visit http://localhost:${PORT}"
        info "View logs: tail -f ${LOG_FILE}"
        info "Stop: ${0} stop"
    else
        error "Failed to start FlowX Studio"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# 停止服务
stop_daemon() {
    if [ ! -f "$PID_FILE" ]; then
        warn "FlowX Studio is not running (no PID file found)"
        return 0
    fi
    
    local pid=$(cat "$PID_FILE")
    if ps -p "$pid" > /dev/null 2>&1; then
        info "Stopping FlowX Studio (PID: $pid)..."
        kill "$pid"
        
        # 等待进程退出
        local count=0
        while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 10 ]; do
            sleep 1
            count=$((count + 1))
        done
        
        if ps -p "$pid" > /dev/null 2>&1; then
            warn "Force killing..."
            kill -9 "$pid"
        fi
        
        success "FlowX Studio stopped"
    else
        warn "Process not found (PID: $pid)"
    fi
    
    rm -f "$PID_FILE"
}

# 查看状态
status() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            success "FlowX Studio is running (PID: $pid)"
            info "Server: http://localhost:${PORT}"
            info "Log file: ${LOG_FILE}"
            info "Data directory: ${DATA_DIR}"
        else
            warn "FlowX Studio is not running (stale PID file)"
            rm -f "$PID_FILE"
        fi
    else
        warn "FlowX Studio is not running"
    fi
}

# 查看日志
tail_logs() {
    if [ ! -f "$LOG_FILE" ]; then
        warn "Log file not found: ${LOG_FILE}"
        return 0
    fi
    
    info "Tailing logs (Ctrl+C to exit)..."
    tail -f "$LOG_FILE"
}

# 清理构建产物
clean() {
    info "Cleaning build artifacts..."
    rm -f "${SCRIPT_DIR}/${BINARY_NAME}"
    rm -rf "${SCRIPT_DIR}/web/dist"
    rm -rf "${SCRIPT_DIR}/internal/server/web/dist"
    rm -f "$PID_FILE"
    rm -f "$LOG_FILE"
    success "Clean complete"
}

# 快速启动（不构建，直接运行现有二进制）
quick_start() {
    if [ ! -f "${SCRIPT_DIR}/${BINARY_NAME}" ]; then
        error "Binary not found. Please run with --build first, or use 'start' command."
        exit 1
    fi
    
    if check_running; then
        exit 0
    fi
    
    start_foreground
}

# 显示帮助信息
show_help() {
    cat << EOF
FlowX Studio 一键启动脚本

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    start           构建并启动服务（前台模式，默认）
    daemon          构建并启动服务（后台守护进程模式）
    stop            停止后台服务
    restart         重启后台服务
    status          查看服务状态
    logs            查看日志（实时）
    build           仅构建，不启动
    clean           清理构建产物
    quick           快速启动（不构建，使用现有二进制）
    help            显示此帮助信息

Options:
    -p, --port PORT         指定端口（默认: 8080）
    -H, --host HOST         指定监听地址（默认: 0.0.0.0）
    -d, --data-dir DIR      指定数据目录（默认: ~/.flowx-studio）
    -b, --build-web         强制重新构建前端
    --no-build              不构建前端（使用现有构建）
    -h, --help              显示帮助

Examples:
    $0                      # 构建并前台启动
    $0 start -p 3000        # 使用端口 3000 启动
    $0 daemon               # 后台启动
    $0 stop                 # 停止后台服务
    $0 status               # 查看状态
    $0 logs                 # 查看日志
    $0 build                # 仅构建
    $0 quick                # 快速启动（跳过构建）
    $0 clean                # 清理构建产物

EOF
}

# 解析命令
COMMAND="${1:-start}"
shift || true

# 解析选项
BUILD_WEB=""
MODE="dev"

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -H|--host)
            HOST="$2"
            shift 2
            ;;
        -d|--data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        -b|--build-web)
            BUILD_WEB="true"
            shift
            ;;
        --no-build)
            BUILD_WEB="false"
            shift
            ;;
        --prod)
            MODE="prod"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            warn "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# 确保数据目录存在
mkdir -p "${DATA_DIR}"

# 执行命令
case "$COMMAND" in
    start)
        check_deps
        check_web_dist
        build_web
        build_backend
        if check_running; then
            exit 0
        fi
        start_foreground
        ;;
    daemon)
        check_deps
        check_web_dist
        build_web
        build_backend
        if check_running; then
            exit 0
        fi
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        stop_daemon
        sleep 1
        start_daemon
        ;;
    status)
        status
        ;;
    logs)
        tail_logs
        ;;
    build)
        check_deps
        check_web_dist
        build_web
        build_backend
        success "Build complete!"
        info "Run '${0} quick' to start without rebuilding"
        ;;
    clean)
        stop_daemon 2>/dev/null || true
        clean
        ;;
    quick)
        quick_start
        ;;
    help|-h|--help)
        show_help
        ;;
    *)
        error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac
