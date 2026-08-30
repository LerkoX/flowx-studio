package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/assets"
	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
)

func setupGCEnv(t *testing.T) (*NodeService, *assets.Store) {
	t.Helper()
	tmpDir := t.TempDir()
	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	store := assets.NewStore(tmpDir)
	svc := NewNodeService(database, event.NewBus())
	svc.SetAssetStore(store)
	return svc, store
}

func TestGCAssets(t *testing.T) {
	svc, store := setupGCEnv(t)

	// 存活节点：live-node@1.0.0（资产在库）与 bare-node（无资产）
	live := &model.Node{
		Name: "live-node", Language: "bash", Entry: "main.sh", Version: "1.0.0",
		NodeType: "code", Code: "echo hi",
		Parameters: []model.NodeParameter{},
	}
	if _, err := svc.Create(live); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put("live-node", "1.0.0", map[string]assets.FileData{
		"main.sh": {Content: []byte("echo hi"), Kind: assets.KindRuntime},
	}); err != nil {
		t.Fatal(err)
	}
	// 空版本节点：目录归一为 @0
	bare := &model.Node{
		Name: "bare-node", Language: "bash", Entry: "main.sh",
		NodeType: "code", Code: "echo hi", Parameters: []model.NodeParameter{},
	}
	if _, err := svc.Create(bare); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put("bare-node", "", map[string]assets.FileData{
		"main.sh": {Content: []byte("echo hi"), Kind: assets.KindRuntime},
	}); err != nil {
		t.Fatal(err)
	}

	// 制造孤儿：已删除节点、旧版本目录、Put 崩溃遗留 tmp、人工目录
	os.MkdirAll(filepath.Join(store.Root, "deleted-node@1.0.0"), 0755)
	os.MkdirAll(filepath.Join(store.Root, "live-node@0.9.0"), 0755)
	os.MkdirAll(filepath.Join(store.Root, "live-node@1.0.0.tmp-1234"), 0755)
	os.MkdirAll(filepath.Join(store.Root, "手工放置 dir"), 0755)

	removed, err := svc.GCAssets()
	if err != nil {
		t.Fatal(err)
	}
	removedSet := map[string]bool{}
	for _, d := range removed {
		removedSet[d] = true
	}

	for _, want := range []string{"deleted-node@1.0.0", "live-node@0.9.0", "live-node@1.0.0.tmp-1234"} {
		if !removedSet[want] {
			t.Errorf("expected %s to be GC'd, removed=%v", want, removed)
		}
	}
	for _, keep := range []string{"live-node@1.0.0", "bare-node@0", "手工放置 dir"} {
		if removedSet[keep] {
			t.Errorf("expected %s to be kept", keep)
		}
		if _, err := os.Stat(filepath.Join(store.Root, keep)); err != nil {
			t.Errorf("expected %s to still exist: %v", keep, err)
		}
	}

	// 再次 GC 应无可清理项
	removed2, err := svc.GCAssets()
	if err != nil {
		t.Fatal(err)
	}
	if len(removed2) != 0 {
		t.Errorf("second GC should be no-op, removed=%v", removed2)
	}
}

func TestGCAssetsWithoutStore(t *testing.T) {
	tmpDir := t.TempDir()
	database, err := db.New(filepath.Join(tmpDir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	svc := NewNodeService(database, event.NewBus()) // 未注入 store
	removed, err := svc.GCAssets()
	if err != nil || removed != nil {
		t.Errorf("expected no-op without store, got removed=%v err=%v", removed, err)
	}
}
