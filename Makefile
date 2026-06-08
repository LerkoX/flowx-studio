.PHONY: build clean run test

# 变量
BINARY_NAME=flowx-studio
BUILD_DIR=.
WEB_DIR=web
GO_FILES=$(shell find . -name '*.go' -not -path './$(WEB_DIR)/*')

# 默认目标
all: build

# 构建前端
build-web:
	cd $(WEB_DIR) && npm install && npm run build

# 复制前端到 embed 目录
copy-web: build-web
	rm -rf internal/server/web/dist
	cp -r $(WEB_DIR)/dist internal/server/web/dist

# 构建后端（开发模式，不嵌入前端）
build-dev:
	go build -o $(BINARY_NAME) cmd/flowx-studio/main.go

# 构建完整二进制（嵌入前端）
build: copy-web
	go build -ldflags "-s -w" -o $(BINARY_NAME) cmd/flowx-studio/main.go
	@echo "Build complete: $(BINARY_NAME)"

# 运行开发服务器
run: build-dev
	./$(BINARY_NAME) server --port 8080

# 运行生产服务器
run-prod: build
	./$(BINARY_NAME) server --port 8080

# 清理构建产物
clean:
	rm -f $(BINARY_NAME)
	rm -rf $(WEB_DIR)/dist
	rm -rf internal/server/web/dist

# 测试
test:
	go test ./...

# 格式化代码
fmt:
	go fmt ./...
	cd $(WEB_DIR) && npx prettier --write "src/**/*.{ts,tsx}"

# 安装依赖
deps:
	go mod tidy
	cd $(WEB_DIR) && npm install

# 查看版本
version: build-dev
	./$(BINARY_NAME) version
