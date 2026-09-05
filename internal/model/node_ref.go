package model

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// nodeVersionPattern 版本号字符集：与资产目录（assets store）的校验规则一致
var nodeVersionPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

// NormalizeNodeVersion 归一化版本号：空版本统一为 "0"（与资产目录命名规则一致）
func NormalizeNodeVersion(version string) string {
	v := strings.TrimSpace(version)
	if v == "" {
		return "0"
	}
	return v
}

// ParseNodeRef 解析节点引用 "name" 或 "name@version"。
// 裸名称时 version 返回空串，表示「解析到该名称的最新版本」（由 GetByRef 处理）。
func ParseNodeRef(ref string) (name, version string, err error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", "", fmt.Errorf("nodeRef is empty")
	}
	name, version, _ = strings.Cut(ref, "@")
	name = strings.TrimSpace(name)
	version = strings.TrimSpace(version)
	if name == "" {
		return "", "", fmt.Errorf("invalid nodeRef %q: name is empty", ref)
	}
	if strings.Contains(version, "@") {
		return "", "", fmt.Errorf("invalid nodeRef %q: too many '@'", ref)
	}
	if version != "" && !nodeVersionPattern.MatchString(version) {
		return "", "", fmt.Errorf("invalid nodeRef %q: illegal version %q", ref, version)
	}
	return name, version, nil
}

// FormatNodeRef 生成规范化引用 "name@version"（版本归一化，空版本为 "0"）。
// 物化快照中始终记录完整引用，保证回放/续跑能精确还原节点版本。
func FormatNodeRef(name, version string) string {
	return name + "@" + NormalizeNodeVersion(version)
}

// CompareNodeVersions 比较两个版本号：a<b 返回 -1，a==b 返回 0，a>b 返回 1。
// semver 风格规则：
//   - 首个 '-' 后为预发布段；基版本按 '.' 分段逐段比较，两段均纯数字时按数值
//     比较（1.10.0 > 1.9.0），否则按字符串比较；前缀相同时段数多者大（1.0.1 > 1.0）
//   - 基版本相等时：带预发布段的更小（1.0.0-beta < 1.0.0）；均带预发布段时按同规则递归比较
//
// 比较前做空版本归一化（空 = "0"）。
func CompareNodeVersions(a, b string) int {
	a = NormalizeNodeVersion(a)
	b = NormalizeNodeVersion(b)
	if a == b {
		return 0
	}
	aBase, aPre := splitPrerelease(a)
	bBase, bPre := splitPrerelease(b)
	if c := compareSegments(strings.Split(aBase, "."), strings.Split(bBase, ".")); c != 0 {
		return c
	}
	// 基版本相等：无预发布段者为正式版，更大
	if (aPre == "") != (bPre == "") {
		if aPre == "" {
			return 1
		}
		return -1
	}
	if aPre == "" {
		return 0
	}
	return compareSegments(strings.Split(aPre, "."), strings.Split(bPre, "."))
}

// splitPrerelease 按首个 '-' 拆分基版本与预发布段
func splitPrerelease(v string) (base, pre string) {
	if i := strings.Index(v, "-"); i >= 0 {
		return v[:i], v[i+1:]
	}
	return v, ""
}

// compareSegments 逐段比较：均纯数字按数值（数值相等继续下一段），否则按字符串；
// 前缀相同时段数多者更大
func compareSegments(as, bs []string) int {
	for i := 0; i < len(as) && i < len(bs); i++ {
		if as[i] == bs[i] {
			continue
		}
		an, aErr := strconv.Atoi(as[i])
		bn, bErr := strconv.Atoi(bs[i])
		if aErr == nil && bErr == nil {
			if an == bn {
				continue
			}
			if an < bn {
				return -1
			}
			return 1
		}
		if as[i] < bs[i] {
			return -1
		}
		return 1
	}
	if len(as) < len(bs) {
		return -1
	}
	if len(as) > len(bs) {
		return 1
	}
	return 0
}
