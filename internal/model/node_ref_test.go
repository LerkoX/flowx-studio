package model

import "testing"

func TestParseNodeRef(t *testing.T) {
	cases := []struct {
		ref         string
		wantName    string
		wantVersion string
		wantErr     bool
	}{
		{"get-weather", "get-weather", "", false},
		{"get-weather@1.0.0", "get-weather", "1.0.0", false},
		{"  get-weather@2.0  ", "get-weather", "2.0", false},
		{"a@b@c", "", "", true},
		{"@1.0.0", "", "", true},
		{"", "", "", true},
		{"name@", "name", "", false}, // 尾缀空版本视为裸名称
		{"name@中文", "", "", true},
	}
	for _, c := range cases {
		name, version, err := ParseNodeRef(c.ref)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseNodeRef(%q) expected error, got %q@%q", c.ref, name, version)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseNodeRef(%q) unexpected error: %v", c.ref, err)
			continue
		}
		if name != c.wantName || version != c.wantVersion {
			t.Errorf("ParseNodeRef(%q) = (%q, %q), want (%q, %q)", c.ref, name, version, c.wantName, c.wantVersion)
		}
	}
}

func TestFormatNodeRef(t *testing.T) {
	if got := FormatNodeRef("n", ""); got != "n@0" {
		t.Errorf("FormatNodeRef empty version = %q, want n@0", got)
	}
	if got := FormatNodeRef("n", "1.2.3"); got != "n@1.2.3" {
		t.Errorf("FormatNodeRef = %q, want n@1.2.3", got)
	}
}

func TestCompareNodeVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.9.0", "1.10.0", -1}, // 数值比较，非字符串
		{"1.10.0", "1.9.0", 1},
		{"1.0.0", "1.0.0", 0},
		{"", "0", 0},   // 空版本归一为 0
		{"", "0.1", -1}, // 空版本最小
		{"2.0", "10.0", -1},
		{"1.0", "1.0.1", -1}, // 前缀相同段数多者大
		{"1.0.1", "1.0", 1},
		{"1.0.0", "1.0", 1}, // 段数多者大（1.0.0 > 1.0）
		{"v2", "v10", 1},     // 非数字段字符串比较
		{"1.0-beta", "1.0.0", -1},
	}
	for _, c := range cases {
		if got := CompareNodeVersions(c.a, c.b); got != c.want {
			t.Errorf("CompareNodeVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}
