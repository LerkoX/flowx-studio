package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// newRateLimitProbe 造一个只含限流中间件 + 几个探针路由的测试引擎。
// 同一 IP（httptest 默认 RemoteAddr=192.0.2.1）发请求，观察不同路径是否共用令牌桶。
func newRateLimitProbe() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RateLimitMiddlewareTiered(RateLimitOptions{
		Strict:     RateLimitTier{PerMinute: 60, Burst: 2},
		Loose:      RateLimitTier{PerMinute: 600, Burst: 5},
		LooseMatch: IsHeavyReadPath,
	}))
	ok := func(c *gin.Context) { c.String(http.StatusOK, "ok") }
	// 普通接口（Strict 档）
	r.GET("/api/v1/workflows", ok)
	// 重负载只读（Loose 档）
	r.GET("/api/v1/media/file", ok)
	r.GET("/api/v1/nodes/12/ui/ui/node-widget.js", ok)
	r.GET("/api/v1/executions/9/nodes/A/service-proxy", ok)
	// 同路径但非只读方法：不吃 Loose 档
	r.POST("/api/v1/service-proxy", ok)
	r.POST("/api/v1/media/file", ok)
	return r
}

func hit(r *gin.Engine, method, path string) int {
	req := httptest.NewRequest(method, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

// TestRateLimitTiered_HeavyReadPathsHaveOwnBucket 验证重负载只读接口不占用普通接口的
// 令牌桶：普通接口被打到 429 之后，媒体文件/节点 bundle/service-proxy 仍可继续加载。
// 回归背景——同一档时限流把画布正在加载的图片打成 429，表现为「预览随机缺失」。
func TestRateLimitTiered_HeavyReadPathsHaveOwnBucket(t *testing.T) {
	r := newRateLimitProbe()

	// 先把 Strict 桶打空（burst=2：前 2 次通过，第 3 次 429）
	if got := hit(r, http.MethodGet, "/api/v1/workflows"); got != http.StatusOK {
		t.Fatalf("strict 第 1 次应通过，got %d", got)
	}
	if got := hit(r, http.MethodGet, "/api/v1/workflows"); got != http.StatusOK {
		t.Fatalf("strict 第 2 次应通过，got %d", got)
	}
	if got := hit(r, http.MethodGet, "/api/v1/workflows"); got != http.StatusTooManyRequests {
		t.Fatalf("strict 超限应 429，got %d", got)
	}

	// Strict 已耗尽：重负载只读路径必须仍然可用（独立桶）
	for _, p := range []string{
		"/api/v1/media/file",
		"/api/v1/nodes/12/ui/ui/node-widget.js",
		"/api/v1/executions/9/nodes/A/service-proxy",
	} {
		if got := hit(r, http.MethodGet, p); got != http.StatusOK {
			t.Errorf("%s 在 strict 超限后应仍可用（独立桶），got %d", p, got)
		}
	}
}

// TestRateLimitTiered_LooseBucketStillLimited 验证宽松档并非无限：突发容量耗尽同样 429。
func TestRateLimitTiered_LooseBucketStillLimited(t *testing.T) {
	r := newRateLimitProbe()
	// Loose burst=5
	for i := 0; i < 5; i++ {
		if got := hit(r, http.MethodGet, "/api/v1/media/file"); got != http.StatusOK {
			t.Fatalf("loose 第 %d 次应通过，got %d", i+1, got)
		}
	}
	if got := hit(r, http.MethodGet, "/api/v1/media/file"); got != http.StatusTooManyRequests {
		t.Fatalf("loose 超突发应 429，got %d", got)
	}
}

// TestRateLimitTiered_WritePathsStayStrict 验证同路径的写方法不吃宽松档（仍受严格限流）。
func TestRateLimitTiered_WritePathsStayStrict(t *testing.T) {
	r := newRateLimitProbe()
	// service-proxy 的 POST 走 Strict（burst=2）
	if got := hit(r, http.MethodPost, "/api/v1/service-proxy"); got != http.StatusOK {
		t.Fatalf("strict POST 第 1 次应通过，got %d", got)
	}
	if got := hit(r, http.MethodPost, "/api/v1/service-proxy"); got != http.StatusOK {
		t.Fatalf("strict POST 第 2 次应通过，got %d", got)
	}
	if got := hit(r, http.MethodPost, "/api/v1/service-proxy"); got != http.StatusTooManyRequests {
		t.Fatalf("strict POST 超限应 429，got %d", got)
	}
}

// TestRateLimitTiered_SingleTierFallback 验证未配置 Loose 档时退化为单档（旧行为）。
func TestRateLimitTiered_SingleTierFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RateLimitMiddleware(60, 1))
	r.GET("/api/v1/media/file", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	if got := hit(r, http.MethodGet, "/api/v1/media/file"); got != http.StatusOK {
		t.Fatalf("第 1 次应通过，got %d", got)
	}
	if got := hit(r, http.MethodGet, "/api/v1/media/file"); got != http.StatusTooManyRequests {
		t.Fatalf("未分档时重负载路径也应受限，got %d", got)
	}
}

// TestIsHeavyReadPath 覆盖判定边界：只读方法 + 三类重负载路径才命中。
func TestIsHeavyReadPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		method, path string
		want         bool
	}{
		{http.MethodGet, "/api/v1/media/file", true},
		{http.MethodHead, "/api/v1/media/file", true},
		{http.MethodGet, "/api/v1/nodes/12/ui/ui/node-widget.js", true},
		{http.MethodGet, "/api/v1/executions/9/nodes/A/service-proxy", true},
		{http.MethodGet, "/api/v1/service-proxy", true},
		{http.MethodPost, "/api/v1/service-proxy", false},
		{http.MethodPost, "/api/v1/media/file", false},
		{http.MethodGet, "/api/v1/workflows", false},
		{http.MethodGet, "/api/v1/nodes/12", false},
		{http.MethodGet, "/api/v1/executions/9/media", false},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = req
		if got := IsHeavyReadPath(c); got != tc.want {
			t.Errorf("IsHeavyReadPath(%s %s) = %v, want %v", tc.method, tc.path, got, tc.want)
		}
	}
}
