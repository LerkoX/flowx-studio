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

// RateLimitTier 令牌桶单档参数（perMinute 为每分钟允许请求数，burst 为突发容量）。
type RateLimitTier struct {
	PerMinute int
	Burst     int
}

// RateLimitOptions 分档限流配置。
//
// 为什么要分档：默认档（100/分钟）是按「人操作接口的频率」定的，但画布里的
// **重负载只读请求**完全不是这个量级——实测单次画布加载 = 41 个 /api/v1 请求
// （其中 17 个是节点 widget bundle、8 个是媒体文件）。也就是说打开 2~3 个画布页
// 或连续刷新几次就必然超限，而被 429 的恰好是正在加载的图片与 bundle，画布表现
// 为「预览图随机缺失」「组件加载失败」。故这些路径单独走 Loose 档（仍有限速，防滥用），
// 其余接口（含所有写操作）维持 Strict 档。
type RateLimitOptions struct {
	Strict RateLimitTier
	Loose  RateLimitTier
	// LooseMatch 判定某请求是否走 Loose 档；nil 表示不分档（一律 Strict）
	LooseMatch func(*gin.Context) bool
}

// IsHeavyReadPath 判定「重负载只读」路径（见 RateLimitOptions 注释）：
//   - GET /api/v1/media/file：画布媒体出口（预览帧/结果图，一次画布几十张）
//   - GET /api/v1/nodes/:id/ui/*：节点 widget bundle（每个节点一个请求）
//   - GET */service-proxy：节点级对第三方服务的只读中转（取资源/探活）
//
// 只匹配 GET/HEAD：同路径的写操作（上传、代理动作）不吃宽松档。
func IsHeavyReadPath(c *gin.Context) bool {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		return false
	}
	p := c.Request.URL.Path
	switch {
	case p == "/api/v1/media/file":
		return true
	case strings.HasSuffix(p, "/service-proxy"):
		return true
	case strings.HasPrefix(p, "/api/v1/nodes/") && strings.Contains(p, "/ui/"):
		return true
	}
	return false
}

// RateLimitMiddleware 基于 x/time/rate 的每 IP 令牌桶限流。
// perMinute 为每分钟允许的请求数，burst 为突发容量；超限返回 429。
// 不分档版本（重负载只读路径与普通接口同档），新代码请用 RateLimitMiddlewareTiered。
func RateLimitMiddleware(perMinute int, burst int) gin.HandlerFunc {
	return RateLimitMiddlewareTiered(RateLimitOptions{
		Strict: RateLimitTier{PerMinute: perMinute, Burst: burst},
	})
}

// RateLimitMiddlewareTiered 分档限流：每个 IP 维护两个令牌桶，按 opts.LooseMatch
// 选择档位（Loose 未配置时退化为单档）。同一 IP 的两档计数互不影响——普通接口
// 被打满不会连带把图片请求一起限掉。
func RateLimitMiddlewareTiered(opts RateLimitOptions) gin.HandlerFunc {
	strict := opts.Strict
	if strict.PerMinute <= 0 {
		strict = RateLimitTier{PerMinute: 100, Burst: 50}
	}
	loose := opts.Loose
	useLoose := opts.LooseMatch != nil && loose.PerMinute > 0

	type visitor struct {
		strict   *rate.Limiter
		loose    *rate.Limiter
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

	newLimiter := func(t RateLimitTier) *rate.Limiter {
		return rate.NewLimiter(rate.Limit(float64(t.PerMinute)/60.0), t.Burst)
	}

	getVisitor := func(ip string) *visitor {
		mu.Lock()
		defer mu.Unlock()
		v, ok := visitors[ip]
		if !ok {
			v = &visitor{strict: newLimiter(strict)}
			if useLoose {
				v.loose = newLimiter(loose)
			}
			visitors[ip] = v
		}
		v.lastSeen = time.Now()
		return v
	}

	return func(c *gin.Context) {
		v := getVisitor(c.ClientIP())
		limiter, tier := v.strict, "strict"
		if useLoose && v.loose != nil && opts.LooseMatch(c) {
			limiter, tier = v.loose, "loose"
		}
		if !limiter.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"code":    429,
				"message": fmt.Sprintf("rate limit exceeded (%s tier): %d requests/min per IP", tier, perMinuteOf(tier, strict, loose)),
			})
			return
		}
		c.Next()
	}
}

func perMinuteOf(tier string, strict, loose RateLimitTier) int {
	if tier == "loose" {
		return loose.PerMinute
	}
	return strict.PerMinute
}
