package server

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:web/dist
var webDist embed.FS

// Server HTTP 服务器
type Server struct {
	router     *gin.Engine
	httpServer *http.Server
	port       int
	host       string
	authToken  string
}

// New 创建服务器
func New() *Server {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	return &Server{
		router: r,
		port:   8080,
		host:   "0.0.0.0",
	}
}

// SetPort 设置端口
func (s *Server) SetPort(port int) {
	s.port = port
}

// SetHost 设置监听地址
func (s *Server) SetHost(host string) {
	s.host = host
}

// SetAuthToken 设置认证 token（空字符串表示关闭认证）
func (s *Server) SetAuthToken(token string) {
	s.authToken = token
}

// Router 获取 gin 引擎
func (s *Server) Router() *gin.Engine {
	return s.router
}

// RegisterStatic 注册静态资源
func (s *Server) RegisterStatic() {
	distFS, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		panic(fmt.Sprintf("failed to create sub fs: %v", err))
	}

	fileServer := http.FileServer(http.FS(distFS))

	s.router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		// API 请求不处理
		if strings.HasPrefix(path, "/api/") {
			c.JSON(404, gin.H{"code": 404, "message": "not found"})
			return
		}
		// 尝试打开文件
		cleanPath := strings.TrimPrefix(path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}
		_, err := distFS.Open(cleanPath)
		if err != nil {
			// 文件不存在，返回 index.html（SPA fallback）
			c.Request.URL.Path = "/index.html"
		}
		// 返回 SPA 页面时种下认证 cookie，Web UI 后续 API 请求自动携带
		if c.Request.URL.Path == "/index.html" || cleanPath == "index.html" {
			SetAuthCookie(c, s.authToken)
		}
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}

// Start 启动服务器
func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	s.httpServer = &http.Server{
		Addr:    addr,
		Handler: s.router,
	}
	return s.httpServer.ListenAndServe()
}

// Shutdown 优雅关闭
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpServer == nil {
		return nil
	}
	return s.httpServer.Shutdown(ctx)
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "" || strings.HasPrefix(origin, "http://localhost") || strings.HasPrefix(origin, "http://127.0.0.1") {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
