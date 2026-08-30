package assets

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	return &Store{Root: filepath.Join(t.TempDir(), "assets", "nodes")}
}

func TestStorePutAndRead(t *testing.T) {
	s := newTestStore(t)
	files := map[string]FileData{
		"main.sh":           {Content: []byte("echo hi\n"), Kind: KindRuntime},
		"ui/node-widget.js": {Content: []byte("export default {}\n"), Kind: KindUI},
		// 二进制内容（含 NUL 与非法 UTF-8）必须原样保留
		"ui/pic.png": {Content: []byte{0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xFE}, Kind: KindUI},
	}
	index, err := s.Put("test-node", "1.0.0", files)
	if err != nil {
		t.Fatalf("Put failed: %v", err)
	}
	if len(index) != 3 {
		t.Fatalf("expected 3 index entries, got %d", len(index))
	}
	if index["ui/pic.png"].Kind != KindUI || index["main.sh"].Kind != KindRuntime {
		t.Errorf("unexpected kinds: %+v", index)
	}
	if index["ui/pic.png"].ContentType != "image/png" {
		t.Errorf("unexpected content type: %s", index["ui/pic.png"].ContentType)
	}
	if index["ui/pic.png"].Size != 7 {
		t.Errorf("unexpected size: %d", index["ui/pic.png"].Size)
	}

	for rel, fd := range files {
		got, err := s.Read("test-node", "1.0.0", rel)
		if err != nil {
			t.Fatalf("Read %s failed: %v", rel, err)
		}
		if string(got) != string(fd.Content) {
			t.Errorf("content mismatch for %s", rel)
		}
	}
}

func TestStorePutOverwriteAtomic(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Put("n", "1", map[string]FileData{"a.txt": {Content: []byte("v1")}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("n", "1", map[string]FileData{"b.txt": {Content: []byte("v2")}}); err != nil {
		t.Fatal(err)
	}
	// 覆盖后旧文件应消失
	if _, err := s.Read("n", "1", "a.txt"); err == nil {
		t.Error("expected a.txt to be removed after overwrite")
	}
	got, err := s.Read("n", "1", "b.txt")
	if err != nil || string(got) != "v2" {
		t.Errorf("unexpected b.txt: %v %q", err, got)
	}
	// 不应残留临时目录
	entries, _ := os.ReadDir(s.Root)
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp") {
			t.Errorf("temp dir leaked: %s", e.Name())
		}
	}
}

func TestStorePathTraversalRejected(t *testing.T) {
	s := newTestStore(t)
	bad := []string{"../evil.txt", "/etc/passwd", "a/../../evil.txt", ".."}
	for _, rel := range bad {
		if _, err := s.Put("n", "1", map[string]FileData{rel: {Content: []byte("x")}}); err == nil {
			t.Errorf("Put accepted traversal path %q", rel)
		}
		if _, err := s.Read("n", "1", rel); err == nil {
			t.Errorf("Read accepted traversal path %q", rel)
		}
	}
	if _, err := s.NodeDir("bad name", "1"); err == nil {
		t.Error("NodeDir accepted invalid name")
	}
}

func TestStoreRemove(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Put("n", "1", map[string]FileData{"a": {Content: []byte("x")}}); err != nil {
		t.Fatal(err)
	}
	if s.Empty() {
		t.Fatal("store should not be empty after Put")
	}
	if err := s.Remove("n", "1"); err != nil {
		t.Fatal(err)
	}
	if !s.Empty() {
		t.Error("store should be empty after Remove")
	}
	// 重复删除不报错
	if err := s.Remove("n", "1"); err != nil {
		t.Error(err)
	}
}

func TestTarGzRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	srcDir := filepath.Join(tmp, "assets")
	os.MkdirAll(filepath.Join(srcDir, "nodes", "n@1", "ui"), 0755)
	bin := []byte{0x00, 0x01, 0xFF, 0xFE, 0x89}
	os.WriteFile(filepath.Join(srcDir, "nodes", "n@1", "ui", "x.bin"), bin, 0644)
	os.WriteFile(filepath.Join(srcDir, "nodes", "n@1", "main.sh"), []byte("echo hi\n"), 0644)

	tarPath := filepath.Join(tmp, "b.assets.tar.gz")
	wrote, err := TarGz(srcDir, tarPath)
	if err != nil || !wrote {
		t.Fatalf("TarGz: wrote=%v err=%v", wrote, err)
	}

	dstDir := filepath.Join(tmp, "restore")
	n, err := UntarGz(tarPath, dstDir)
	if err != nil {
		t.Fatalf("UntarGz: %v", err)
	}
	if n != 2 {
		t.Errorf("expected 2 files, got %d", n)
	}
	got, err := os.ReadFile(filepath.Join(dstDir, "assets", "nodes", "n@1", "ui", "x.bin"))
	if err != nil || string(got) != string(bin) {
		t.Errorf("binary content mismatch: %v", err)
	}
}

func TestTarGzMissingDir(t *testing.T) {
	tmp := t.TempDir()
	wrote, err := TarGz(filepath.Join(tmp, "nonexistent"), filepath.Join(tmp, "x.tar.gz"))
	if err != nil || wrote {
		t.Errorf("expected wrote=false err=nil, got wrote=%v err=%v", wrote, err)
	}
}
