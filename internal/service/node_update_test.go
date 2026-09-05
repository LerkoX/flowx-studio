package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
)

// 原地更新：同名同版本节点已存在时 overwrite=true 应保持 ID 不变并覆盖内容
func TestNodeImportService_ImportOverwriteKeepsID(t *testing.T) {
	tmpDir, cleanup := writeTestPackage(t, `{
  "name": "overwrite-node",
  "displayName": "旧名称",
  "language": "python",
  "entry": "main.py",
  "version": "1.0.0",
  "parameters": []
}`)
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	nodeSvc := NewNodeService(database, event.NewBus())
	nodeSvc.SetAssetStore(&assets.Store{Root: filepath.Join(tmpDir, "assets-store")})
	importSvc := NewNodeImportService(nodeSvc)

	first, err := importSvc.ImportFromFolder(tmpDir, false)
	if err != nil {
		t.Fatalf("first import failed: %v", err)
	}

	// 修改包内容后再次导入（overwrite，同版本）
	updated := `{
  "name": "overwrite-node",
  "displayName": "新名称",
  "language": "python",
  "entry": "main.py",
  "version": "1.0.0",
  "parameters": []
}`
	if err := os.WriteFile(filepath.Join(tmpDir, "flowx.json"), []byte(updated), 0644); err != nil {
		t.Fatalf("failed to rewrite flowx.json: %v", err)
	}

	second, err := importSvc.ImportFromFolder(tmpDir, true)
	if err != nil {
		t.Fatalf("overwrite import failed: %v", err)
	}

	if second.ID != first.ID {
		t.Errorf("overwrite should keep node ID: first=%d second=%d", first.ID, second.ID)
	}
	if second.DisplayName != "新名称" || second.Version != "1.0.0" {
		t.Errorf("overwrite should update fields, got displayName=%q version=%q", second.DisplayName, second.Version)
	}

	// DB 中读回确认
	stored, err := nodeSvc.Get(first.ID)
	if err != nil {
		t.Fatalf("failed to get node: %v", err)
	}
	if stored.DisplayName != "新名称" {
		t.Errorf("stored node not updated, displayName=%q", stored.DisplayName)
	}

	// 不带 overwrite 同名同版本导入应报错
	if _, err := importSvc.ImportFromFolder(tmpDir, false); err == nil {
		t.Fatal("expected conflict error when importing same name+version without overwrite")
	} else if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("expected 'already exists' error, got: %v", err)
	}
}

// 同名不同版本导入：多版本并存为独立节点行（新 ID），无需 overwrite
func TestNodeImportService_ImportNewVersionCoexists(t *testing.T) {
	tmpDir, cleanup := writeTestPackage(t, `{
  "name": "versioned-node",
  "displayName": "v1",
  "language": "python",
  "entry": "main.py",
  "version": "1.0.0",
  "parameters": []
}`)
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	nodeSvc := NewNodeService(database, event.NewBus())
	nodeSvc.SetAssetStore(&assets.Store{Root: filepath.Join(tmpDir, "assets-store")})
	importSvc := NewNodeImportService(nodeSvc)

	v1, err := importSvc.ImportFromFolder(tmpDir, false)
	if err != nil {
		t.Fatalf("v1 import failed: %v", err)
	}

	updated := `{
  "name": "versioned-node",
  "displayName": "v2",
  "language": "python",
  "entry": "main.py",
  "version": "2.0.0",
  "parameters": []
}`
	if err := os.WriteFile(filepath.Join(tmpDir, "flowx.json"), []byte(updated), 0644); err != nil {
		t.Fatalf("failed to rewrite flowx.json: %v", err)
	}

	v2, err := importSvc.ImportFromFolder(tmpDir, false)
	if err != nil {
		t.Fatalf("v2 import failed: %v", err)
	}
	if v2.ID == v1.ID {
		t.Errorf("new version should be a separate node row, got same ID %d", v2.ID)
	}

	// 旧版本仍可按精确引用取回，新版本成为裸引用解析目标
	gotV1, err := nodeSvc.GetByRef("versioned-node", "1.0.0")
	if err != nil || gotV1 == nil || gotV1.ID != v1.ID {
		t.Errorf("GetByRef 1.0.0 = %v, err=%v", gotV1, err)
	}
	latest, err := nodeSvc.GetByRef("versioned-node", "")
	if err != nil || latest == nil || latest.ID != v2.ID {
		t.Errorf("bare ref should resolve to latest (v2), got %v, err=%v", latest, err)
	}
}

// overwrite=true 但同名节点不存在时退化为创建
func TestNodeImportService_ImportOverwriteCreatesWhenAbsent(t *testing.T) {
	tmpDir, cleanup := writeTestPackage(t, `{
  "name": "overwrite-absent",
  "language": "python",
  "entry": "main.py",
  "parameters": []
}`)
	defer cleanup()

	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	nodeSvc := NewNodeService(database, event.NewBus())
	nodeSvc.SetAssetStore(&assets.Store{Root: filepath.Join(tmpDir, "assets-store")})
	importSvc := NewNodeImportService(nodeSvc)

	node, err := importSvc.ImportFromFolder(tmpDir, true)
	if err != nil {
		t.Fatalf("overwrite import (absent) failed: %v", err)
	}
	if node.ID <= 0 {
		t.Errorf("expected created node with valid ID, got %d", node.ID)
	}
}

// NodeService.Update：ID 不存在报 node not found；改名为已占用名称报冲突
func TestNodeService_UpdateErrors(t *testing.T) {
	tmpDir := t.TempDir()
	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	nodeSvc := NewNodeService(database, event.NewBus())

	a, err := nodeSvc.Create(&model.Node{Name: "node-a", Language: "python", Code: "print(1)"})
	if err != nil {
		t.Fatalf("create node-a failed: %v", err)
	}
	if _, err := nodeSvc.Create(&model.Node{Name: "node-b", Language: "python", Code: "print(2)"}); err != nil {
		t.Fatalf("create node-b failed: %v", err)
	}

	// 正常更新：ID 与名称保持不变
	if err := nodeSvc.Update(a.ID, &model.Node{Name: "node-a", Language: "python", Code: "print('v2')"}); err != nil {
		t.Fatalf("update failed: %v", err)
	}
	got, _ := nodeSvc.Get(a.ID)
	if got.Code != "print('v2')" {
		t.Errorf("update did not apply, code=%q", got.Code)
	}

	// ID 不存在
	if err := nodeSvc.Update(99999, &model.Node{Name: "ghost", Language: "python", Code: "x"}); err == nil {
		t.Fatal("expected error for non-existent ID")
	} else if err.Error() != "node not found" {
		t.Errorf("expected 'node not found', got: %v", err)
	}

	// 改名为已占用名称（同版本组合冲突）
	if err := nodeSvc.Update(a.ID, &model.Node{Name: "node-b", Language: "python", Code: "x"}); err == nil {
		t.Fatal("expected conflict error when renaming to an occupied name")
	} else if err.Error() != "node node-b@0 already exists" {
		t.Errorf("expected 'node node-b@0 already exists', got: %v", err)
	}
}
