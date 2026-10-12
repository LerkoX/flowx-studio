package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupMediaRouter(t *testing.T, roots ...string) (*gin.Engine, string) {
	t.Helper()
	return setupMediaRouterWithUploadDir(t, "", roots...)
}

// setupMediaRouterWithUploadDir 可指定上传落点（空串 = 自动选 flowx-input/uploads）。
func setupMediaRouterWithUploadDir(t *testing.T, uploadDir string, roots ...string) (*gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewMediaHandler(roots, uploadDir).RegisterRoutes(r.Group("/api/v1"))
	return r, ""
}

func mediaURL(path string) string {
	return "/api/v1/media/file?path=" + url.QueryEscape(path)
}

func TestMediaHandlerServeOK(t *testing.T) {
	root := t.TempDir()
	content := []byte("fake-mp4-bytes")
	fp := filepath.Join(root, "demo.mp4")
	if err := os.WriteFile(fp, content, 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(fp), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expect 200, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != string(content) {
		t.Fatalf("unexpected body: %q", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Fatalf("unexpected content-type: %q", ct)
	}
}

func TestMediaHandlerRange(t *testing.T) {
	root := t.TempDir()
	fp := filepath.Join(root, "demo.mp4")
	if err := os.WriteFile(fp, []byte("0123456789"), 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(fp), nil)
	req.Header.Set("Range", "bytes=2-5")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusPartialContent {
		t.Fatalf("expect 206, got %d", w.Code)
	}
	if w.Body.String() != "2345" {
		t.Fatalf("unexpected range body: %q", w.Body.String())
	}
}

func TestMediaHandlerTraversal(t *testing.T) {
	root := t.TempDir()
	secret := filepath.Join(filepath.Dir(root), "secret.txt")
	if err := os.WriteFile(secret, []byte("nope"), 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(filepath.Join(root, "..", "secret.txt")), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expect 403, got %d", w.Code)
	}
}

func TestMediaHandlerOutsideRoot(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	fp := filepath.Join(other, "a.mp4")
	if err := os.WriteFile(fp, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(fp), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expect 403, got %d", w.Code)
	}
}

func TestMediaHandlerSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	target := filepath.Join(other, "b.mp4")
	if err := os.WriteFile(target, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link.mp4")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, root)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(link), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expect 403, got %d", w.Code)
	}
}

func TestMediaHandlerMissingAndDir(t *testing.T) {
	root := t.TempDir()
	r, _ := setupMediaRouter(t, root)

	// 缺少 path 参数 → 400
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/media/file", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expect 400, got %d", w.Code)
	}

	// 目录 → 404
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", mediaURL(root), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expect 404, got %d", w.Code)
	}

	// 不存在 → 404
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", mediaURL(filepath.Join(root, "nope.mp4")), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expect 404, got %d", w.Code)
	}
}

// ---- 上传（加载类节点\"选/拖文件\"的落点）----

// uploadBody 构造一个含单个 file 字段的 multipart 请求体
func uploadBody(t *testing.T, field, filename string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	return &buf, mw.FormDataContentType()
}

func postUpload(t *testing.T, r *gin.Engine, path, field, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	body, ctype := uploadBody(t, field, filename, content)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", path, body)
	req.Header.Set("Content-Type", ctype)
	r.ServeHTTP(w, req)
	return w
}

func TestMediaHandlerUploadOK(t *testing.T) {
	root := t.TempDir()
	inputRoot := filepath.Join(root, "flowx-input")
	if err := os.MkdirAll(inputRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	outputRoot := filepath.Join(root, "flowx-output")
	if err := os.MkdirAll(outputRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	// 白名单顺序故意把 output 放前面：上传必须优先落到 flowx-input（素材进，不是结果出）
	r, _ := setupMediaRouter(t, outputRoot, inputRoot)

	content := []byte("fake-png-bytes")
	w := postUpload(t, r, "/api/v1/media/upload", "file", "服装 参考图.PNG", content)
	if w.Code != http.StatusOK {
		t.Fatalf("expect 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Path    string `json:"path"`
			AbsPath string `json:"abs_path"`
			Name    string `json:"name"`
			Mime    string `json:"mime"`
			Kind    string `json:"kind"`
			Size    int64  `json:"size"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	d := resp.Data
	if d.Kind != "image" || d.Size != int64(len(content)) {
		t.Fatalf("bad meta: %+v", d)
	}
	// 消毒 + 时间戳前缀 + 落到 flowx-input/uploads/
	if !strings.HasPrefix(filepath.Dir(d.AbsPath), filepath.Join(inputRoot, "uploads")) {
		t.Fatalf("unexpected target dir: %s", d.AbsPath)
	}
	if !strings.Contains(d.Name, "_") || strings.ContainsAny(d.Name, " ") {
		t.Fatalf("filename not sanitized: %s", d.Name)
	}
	if !strings.HasSuffix(strings.ToLower(d.Name), ".png") {
		t.Fatalf("extension lost: %s", d.Name)
	}
	if got, err := os.ReadFile(d.AbsPath); err != nil || !bytes.Equal(got, content) {
		t.Fatalf("file content mismatch: %v", err)
	}
	// 上传结果必须能经 /media/file 直接预览（widget 拿它衬图）
	w = httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(d.Path), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), content) {
		t.Fatalf("preview of uploaded file failed: %d", w.Code)
	}
}

func TestMediaHandlerUploadRejects(t *testing.T) {
	root := t.TempDir()
	r, _ := setupMediaRouter(t, root)

	// 任意扩展名都放行（不再有白名单）——原 415 分支已删除
	if w := postUpload(t, r, "/api/v1/media/upload", "file", "evil.sh",
		[]byte("#!/bin/sh\n")); w.Code != http.StatusOK {
		t.Fatalf("expect 200 (no ext whitelist), got %d", w.Code)
	}
	// 字段名不对（非 file）→ 400
	if w := postUpload(t, r, "/api/v1/media/upload", "avatar", "a.png",
		[]byte("x")); w.Code != http.StatusBadRequest {
		t.Fatalf("expect 400, got %d", w.Code)
	}
	// subdir 穿越 → 400
	if w := postUpload(t, r, "/api/v1/media/upload?subdir=../escape", "file", "a.png",
		[]byte("x")); w.Code != http.StatusBadRequest {
		t.Fatalf("expect 400, got %d", w.Code)
	}
	// 非 multipart → 400
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/media/upload", strings.NewReader("x"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expect 400, got %d", w.Code)
	}
	// 无 media root → 500（配置缺失时不能静默吞掉上传物）
	empty, _ := setupMediaRouter(t)
	if w := postUpload(t, empty, "/api/v1/media/upload", "file", "a.png",
		[]byte("x")); w.Code != http.StatusInternalServerError {
		t.Fatalf("expect 500, got %d", w.Code)
	}
}

// TestMediaHandlerUploadAnyExt：上传不限扩展名（原图片/视频白名单已去掉），
// .json/.sh 一律放行；subdir 落到 uploads/<subdir>/（mask-paint 笔画外置走这条路）。
func TestMediaHandlerUploadAnyExt(t *testing.T) {
	root := t.TempDir()
	inputRoot := filepath.Join(root, "flowx-input")
	if err := os.MkdirAll(inputRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	r, _ := setupMediaRouter(t, inputRoot)

	strokes := []byte(`{"strokes":[{"type":"brush","size":40,"points":[[1,2]]}],"image_size":[768,1280]}`)
	w := postUpload(t, r, "/api/v1/media/upload?subdir=strokes", "file", "strokes.json", strokes)
	if w.Code != http.StatusOK {
		t.Fatalf("expect 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Path    string `json:"path"`
			AbsPath string `json:"abs_path"`
			Kind    string `json:"kind"`
			Mime    string `json:"mime"`
			Size    int64  `json:"size"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Kind != "file" || resp.Data.Mime != "application/json" || resp.Data.Size != int64(len(strokes)) {
		t.Fatalf("bad meta: %+v", resp.Data)
	}
	if !strings.HasPrefix(filepath.Dir(resp.Data.AbsPath), filepath.Join(inputRoot, "uploads", "strokes")) {
		t.Fatalf("unexpected target dir: %s", resp.Data.AbsPath)
	}
	// 回读（widget 靠这个端点把笔画读回来继续编辑）
	w = httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(resp.Data.Path), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), strokes) {
		t.Fatalf("read back failed: %d %s", w.Code, w.Body.String())
	}

	// 非媒体扩展名同样放行（不再有白名单），kind 归 "file"
	w = postUpload(t, r, "/api/v1/media/upload", "file", "notes.md", []byte("# hi"))
	if w.Code != http.StatusOK {
		t.Fatalf("expect 200 for .md, got %d: %s", w.Code, w.Body.String())
	}

	// 不限大小：2MB 一次过（原 data 类 8MB / image 32MB 上限已去掉）
	big := bytes.Repeat([]byte("x"), 2<<20)
	if w := postUpload(t, r, "/api/v1/media/upload?subdir=strokes", "file", "big.json", big); w.Code != http.StatusOK {
		t.Fatalf("expect 200 for 2MB, got %d", w.Code)
	}
}

// TestMediaHandlerUploadConfiguredDir：media.upload_dir 生效——文件落到配置目录，
// 且该目录即使不在 media.roots 里也能被 /media/file 读回（否则刚传的文件没法预览）。
func TestMediaHandlerUploadConfiguredDir(t *testing.T) {
	root := t.TempDir()
	readRoot := filepath.Join(root, "flowx-input")
	if err := os.MkdirAll(readRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	custom := filepath.Join(root, "custom-uploads") // 故意放在白名单外
	r, _ := setupMediaRouterWithUploadDir(t, custom, readRoot)

	content := []byte("payload")
	w := postUpload(t, r, "/api/v1/media/upload", "file", "a.bin", content)
	if w.Code != http.StatusOK {
		t.Fatalf("expect 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Path    string `json:"path"`
			AbsPath string `json:"abs_path"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(resp.Data.AbsPath) != custom {
		t.Fatalf("expect upload into %s, got %s", custom, resp.Data.AbsPath)
	}
	// subdir 追加在配置目录下
	w = postUpload(t, r, "/api/v1/media/upload?subdir=strokes", "file", "s.json", content)
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if filepath.Dir(resp.Data.AbsPath) != filepath.Join(custom, "strokes") {
		t.Fatalf("expect subdir under configured dir, got %s", resp.Data.AbsPath)
	}
	// 配置目录被自动纳入可读白名单
	w = httptest.NewRecorder()
	req, _ := http.NewRequest("GET", mediaURL(resp.Data.Path), nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), content) {
		t.Fatalf("configured upload dir must be readable, got %d", w.Code)
	}
	// subdir 仍不得越出配置目录
	if w := postUpload(t, r, "/api/v1/media/upload?subdir=../escape", "file", "a.bin",
		content); w.Code != http.StatusBadRequest {
		t.Fatalf("expect 400 for escaping subdir, got %d", w.Code)
	}
}

func TestWriteFile(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "ok.bin")
	n, err := writeFile(fp, bytes.NewReader([]byte("12345")))
	if err != nil || n != 5 {
		t.Fatalf("expect 5/nil, got %d/%v", n, err)
	}
	if got, _ := os.ReadFile(fp); !bytes.Equal(got, []byte("12345")) {
		t.Fatalf("content mismatch: %q", got)
	}
	// 无上限：3MB 一次写完
	fp = filepath.Join(dir, "big.bin")
	big := bytes.Repeat([]byte("x"), 3<<20)
	n, err = writeFile(fp, bytes.NewReader(big))
	if err != nil || n != int64(len(big)) {
		t.Fatalf("expect %d/nil, got %d/%v", len(big), n, err)
	}
}

func TestSanitizeUploadName(t *testing.T) {
	cases := map[string]string{
		"C:\\Users\\a\\演示 图.png": "演示_图.png",
		"../../etc/passwd":       "passwd",
		"中文名字.PNG":               "中文名字.PNG",
		"   ":                    "uploaded",
		"..":                     "uploaded",
	}
	for in, want := range cases {
		if got := SanitizeUploadName(in); got != want {
			t.Fatalf("SanitizeUploadName(%q) = %q, want %q", in, got, want)
		}
	}
}
