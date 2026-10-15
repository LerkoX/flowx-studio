package service

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/LerkoX/flowx-studio/internal/db"
	"github.com/LerkoX/flowx-studio/internal/event"
	"github.com/LerkoX/flowx-studio/internal/model"
	"github.com/LerkoX/flowx-studio/internal/validator"
)

// 乐观锁（baseRevision）回归测试：
// 画布参数写回是整份 YAML 的全量 PUT，持有旧定义的客户端（另一标签页/设备、
// SSE 断线期间错过 workflow.updated 的页面）一旦写回就会把他端最新修改整体
// 覆盖（mask-paint 笔画/底图参数被冲掉的事故）。带上 baseRevision 后，
// 内容版本不一致必须 409 拒绝而不是静默覆盖。
func TestWorkflowUpdateOptimisticLock(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.New(dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer database.Close()

	svc := &WorkflowService{db: database, validator: validator.NewWorkflowValidator(), eventBus: event.NewBus()}

	const yamlV1 = "Name: wf\nGraph: |\n  stateDiagram-v2\n    [*] --> A\nNodes:\n  A:\n    name: a\n"
	wf, err := svc.Create(&model.Workflow{Name: "wf", YAMLConfig: yamlV1, Status: "draft"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// GET 下发的 revision 是内容版本号
	got, err := svc.Get(wf.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Revision == "" {
		t.Fatal("Get should populate Revision")
	}
	if got.Revision != ComputeRevision(got) {
		t.Fatal("Revision should equal ComputeRevision")
	}

	// ① 基线一致 → 正常更新
	yamlV2 := strings.Replace(yamlV1, "name: a", "name: b", 1)
	if err := svc.Update(wf.ID, &model.Workflow{
		Name: "wf", YAMLConfig: yamlV2, Status: "draft", BaseRevision: got.Revision,
	}); err != nil {
		t.Fatalf("update with matching baseRevision should succeed: %v", err)
	}

	// ② 基线过期（还用旧 revision）→ 409 冲突
	yamlV3 := strings.Replace(yamlV2, "name: b", "name: c", 1)
	err = svc.Update(wf.ID, &model.Workflow{
		Name: "wf", YAMLConfig: yamlV3, Status: "draft", BaseRevision: got.Revision,
	})
	if !errors.Is(err, ErrWorkflowConflict) {
		t.Fatalf("stale baseRevision should conflict, got: %v", err)
	}
	// 冲突时内容未被覆盖
	cur, _ := svc.Get(wf.ID)
	if cur.YAMLConfig != yamlV2 {
		t.Fatal("conflicted update must not overwrite content")
	}

	// ③ 不带 baseRevision → 兼容旧行为（CLI 等旧客户端），直接写
	if err := svc.Update(wf.ID, &model.Workflow{
		Name: "wf", YAMLConfig: yamlV3, Status: "draft",
	}); err != nil {
		t.Fatalf("update without baseRevision should succeed (compat): %v", err)
	}

	// ④ 内容未变则 revision 不变（自己 PUT 成功后本地基线仍然有效）
	before, _ := svc.Get(wf.ID)
	if err := svc.Update(wf.ID, &model.Workflow{
		Name: "wf", YAMLConfig: yamlV3, Status: "draft", BaseRevision: before.Revision,
	}); err != nil {
		t.Fatalf("re-put same content should succeed: %v", err)
	}
	after, _ := svc.Get(wf.ID)
	if after.Revision != before.Revision {
		t.Fatal("identical content should yield identical revision")
	}
}
