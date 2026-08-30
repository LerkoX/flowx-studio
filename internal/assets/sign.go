package assets

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// 签名 URL 方案（P3）：docker/k8s 等远程执行器通过 HTTP 拉取节点资产。
// 节点脚本里不能携带 Studio 的长期 auth token，因此资产 URL 使用
// HMAC-SHA256 签名 + 短时效（默认 30min），签名校验独立于 API 认证中间件。
//
// URL 形如：
//   <HTTPBase>/api/v1/assets/nodes/<name>@<version>?expires=<unix>&sig=<hex>
// 签名消息为 "<name>@<version>\n<expires>"，覆盖节点目录级前缀，
// 该 URL 下的任意包内文件均可拉取（文件本身已在导入校验时防穿越）。

// SignKeyFileName 签名密钥文件名（存于 data.dir，0600）
const SignKeyFileName = "asset_signing.key"

// DefaultSignTTL 签名 URL 默认有效期
const DefaultSignTTL = 30 * time.Minute

// LoadOrCreateSignKey 加载或生成资产签名密钥
func LoadOrCreateSignKey(dataDir string) ([]byte, error) {
	path := filepath.Join(dataDir, SignKeyFileName)
	if data, err := os.ReadFile(path); err == nil {
		if key, err := hex.DecodeString(strings.TrimSpace(string(data))); err == nil && len(key) == 32 {
			return key, nil
		}
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("failed to generate asset signing key: %w", err)
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)), 0600); err != nil {
		return nil, fmt.Errorf("failed to persist asset signing key: %w", err)
	}
	return key, nil
}

// signMessage 签名消息：节点目录前缀 + 过期时间
func signMessage(name, version string, expires int64) string {
	v := version
	if v == "" {
		v = "0"
	}
	return fmt.Sprintf("%s@%s\n%d", name, v, expires)
}

func computeSig(key []byte, name, version string, expires int64) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(signMessage(name, version, expires)))
	return hex.EncodeToString(mac.Sum(nil))
}

// SignedURL 生成节点资产的签名 URL 前缀（HTTPBase 或 SignKey 未配置时返回空串）。
// 拉取具体文件时追加 "/" + 包内相对路径即可。
func (s *Store) SignedURL(name, version string, ttl time.Duration) string {
	if s.HTTPBase == "" || len(s.SignKey) == 0 {
		return ""
	}
	if ttl <= 0 {
		ttl = DefaultSignTTL
	}
	expires := time.Now().Add(ttl).Unix()
	sig := computeSig(s.SignKey, name, version, expires)
	v := version
	if v == "" {
		v = "0"
	}
	return fmt.Sprintf("%s/api/v1/assets/nodes/%s@%s?expires=%d&sig=%s",
		strings.TrimRight(s.HTTPBase, "/"), url.PathEscape(name), url.PathEscape(v), expires, sig)
}

// VerifySignedRequest 校验签名请求。返回 false 表示签名无效或已过期。
func (s *Store) VerifySignedRequest(name, version string, expiresStr, sig string) bool {
	if len(s.SignKey) == 0 || expiresStr == "" || sig == "" {
		return false
	}
	expires, err := strconv.ParseInt(expiresStr, 10, 64)
	if err != nil {
		return false
	}
	if time.Now().Unix() > expires {
		return false
	}
	expected := computeSig(s.SignKey, name, version, expires)
	return hmac.Equal([]byte(expected), []byte(sig))
}
