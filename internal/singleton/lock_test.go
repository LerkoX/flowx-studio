package singleton

import "testing"

func TestExePathMatches(t *testing.T) {
	self := "/data/app/flowx-studio"
	cases := []struct {
		name string
		exe  string
		want bool
	}{
		{"same path", "/data/app/flowx-studio", true},
		// 热升级：运行中二进制被 mv 覆盖，readlink 带 deleted 后缀，仍应视为同一进程
		{"deleted suffix after upgrade", "/data/app/flowx-studio (deleted)", true},
		{"different binary", "/data/app/flowx-studio.test", false},
		{"different dir", "/tmp/other/flowx-studio", false},
		// 仅后缀相同但基础路径不同，不能误判
		{"deleted suffix different path", "/tmp/other/flowx-studio (deleted)", false},
	}
	for _, c := range cases {
		if got := exePathMatches(self, c.exe); got != c.want {
			t.Errorf("%s: exePathMatches(%q, %q) = %v, want %v", c.name, self, c.exe, got, c.want)
		}
	}
}
