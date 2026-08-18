package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// TokenFileName 本地认证 token 文件名（存放于数据目录，权限 0600）。
const TokenFileName = "auth.token"

// TokenCookieName 浏览器端认证 cookie 名（服务端在返回 index.html 时自动种下）。
const TokenCookieName = "flowx_token"

// LoadOrCreateToken 读取数据目录下的认证 token；不存在则生成随机 token 并写入。
// envToken 非空时优先使用（FLOWX_STUDIO_SERVER_AUTH_TOKEN）。
func LoadOrCreateToken(dataDir, envToken string) (string, error) {
	if envToken != "" {
		return envToken, nil
	}

	path := filepath.Join(dataDir, TokenFileName)
	if raw, err := os.ReadFile(path); err == nil {
		if tok := strings.TrimSpace(string(raw)); tok != "" {
			return tok, nil
		}
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate auth token: %w", err)
	}
	token := hex.EncodeToString(buf)

	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(token+"\n"), 0600); err != nil {
		return "", fmt.Errorf("failed to write auth token: %w", err)
	}
	return token, nil
}

// AuthMiddleware 校验 /api 请求的认证信息。
// 接受两种方式：Authorization: Bearer <token> 头，或 flowx_token cookie。
func AuthMiddleware(token string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if token == "" {
			c.Next()
			return
		}

		if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
			if subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(h, "Bearer ")), []byte(token)) == 1 {
				c.Next()
				return
			}
		}

		if cookie, err := c.Cookie(TokenCookieName); err == nil {
			if subtle.ConstantTimeCompare([]byte(cookie), []byte(token)) == 1 {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "unauthorized: provide 'Authorization: Bearer <token>' (token file: <data-dir>/" + TokenFileName + ")",
		})
	}
}

// SetAuthCookie 在响应上种下认证 cookie（SameSite=Strict，仅本站点携带）。
func SetAuthCookie(c *gin.Context, token string) {
	if token == "" {
		return
	}
	// maxAge 30 天；HttpOnly=false 以便前端 JS 在需要时可读取（同源请求浏览器会自动携带）
	c.SetCookie(TokenCookieName, token, 30*24*3600, "/", "", false, false)
}

// RateLimitMiddleware 基于 x/time/rate 的每 IP 令牌桶限流。
// perMinute 为每分钟允许的请求数，burst 为突发容量；超限返回 429。
func RateLimitMiddleware(perMinute int, burst int) gin.HandlerFunc {
	type visitor struct {
		limiter  *rate.Limiter
		lastSeen time.Time
	}

	var mu sync.Mutex
	visitors := make(map[string]*visitor)

	// 定期清理空闲 visitor，避免 map 无限增长
	go func() {
		for range time.Tick(5 * time.Minute) {
			mu.Lock()
			for ip, v := range visitors {
				if time.Since(v.lastSeen) > 10*time.Minute {
					delete(visitors, ip)
				}
			}
			mu.Unlock()
		}
	}()

	getLimiter := func(ip string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()
		v, ok := visitors[ip]
		if !ok {
			v = &visitor{limiter: rate.NewLimiter(rate.Limit(float64(perMinute)/60.0), burst)}
			visitors[ip] = v
		}
		v.lastSeen = time.Now()
		return v.limiter
	}

	return func(c *gin.Context) {
		if !getLimiter(c.ClientIP()).Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"code":    429,
				"message": fmt.Sprintf("rate limit exceeded: %d requests/min per IP", perMinute),
			})
			return
		}
		c.Next()
	}
}
