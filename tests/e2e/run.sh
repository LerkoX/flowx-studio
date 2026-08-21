#!/usr/bin/env bash
# FlowX Studio E2E 测试脚本（见 docs/12-e2e-testing.md）
# 用法: bash tests/e2e/run.sh
# 可选环境变量: E2E_PORT（默认 18099）、E2E_BINARY（默认临时 go build）
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PORT="${E2E_PORT:-18099}"
BASE_URL="http://127.0.0.1:${PORT}"
TMP="$(mktemp -d)"
DATA_DIR="${TMP}/data"
WORK_DIR="${TMP}/work"
mkdir -p "${DATA_DIR}" "${WORK_DIR}"

PASS=0
FAIL=0
FAILED_CASES=()

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); FAILED_CASES+=("$1"); say "FAIL: $1"; }

# assert_exit <name> <expected_code> <cmd...>
assert_exit() {
    local name="$1"; local expected="$2"; shift 2
    local out code
    out="$("$@" 2>&1)"; code=$?
    LAST_OUT="$out"
    if [ "$code" -eq "$expected" ]; then ok "$name"; else
        bad "$name (expected exit $expected, got $code: $(echo "$out" | head -2))"
    fi
}

# assert_contains <name> <pattern>   —— 检查上一次 assert_exit 的输出
assert_contains() {
    local name="$1"; local pattern="$2"
    if printf '%s' "${LAST_OUT:-}" | grep -q -- "$pattern"; then ok "$name"; else
        bad "$name (output missing '$pattern': $(printf '%s' "${LAST_OUT:-}" | head -2))"
    fi
}

cleanup() {
    FLOWX_STUDIO_DATA_DIR="${DATA_DIR}" "${BINARY}" server stop >/dev/null 2>&1 || true
    rm -rf "${TMP}"
    if [ "${BUILT_BINARY:-}" = "1" ]; then rm -f "${BINARY}"; fi
}
trap cleanup EXIT

# ---------- 准备二进制 ----------
if [ -n "${E2E_BINARY:-}" ]; then
    BINARY="${E2E_BINARY}"
else
    BINARY="${TMP}/flowx-studio-e2e"
    (cd "${ROOT_DIR}" && go build -o "${BINARY}" ./cmd/flowx-studio) || { say "FATAL: go build failed"; exit 1; }
fi
say "binary: ${BINARY}  port: ${PORT}  data: ${DATA_DIR}"

# 所有 CLI 调用统一携带隔离环境
FXS() { FLOWX_STUDIO_DATA_DIR="${DATA_DIR}" "${BINARY}" --server "${BASE_URL}" "$@"; }
FXS_LOCAL() { FLOWX_STUDIO_DATA_DIR="${DATA_DIR}" "${BINARY}" "$@"; }  # server 子命令不带 --server

# ---------- 1. CLI 基础 ----------
say "== 1. CLI basics =="
assert_exit "1.1 help lists command tree" 0 "${BINARY}" --help
for c in server pipeline node ask info version; do
    assert_contains "1.1 help contains '$c'" "$c"
done
assert_exit "1.2 pipeline create --schema" 0 FXS pipeline create --schema
assert_contains "1.2 schema has required" '"required"'
echo "${LAST_OUT}" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null \
    && ok "1.2 schema is valid JSON" || bad "1.2 schema is valid JSON"
assert_exit "1.3 version" 0 "${BINARY}" version
assert_contains "1.3 version output" "flowx-studio"

# ---------- 6.1 server 未启动时的错误路径（在启动前验证） ----------
say "== 6. error paths (before start) =="
assert_exit "6.1 pipeline list without server" 1 FXS pipeline list
assert_contains "6.1 connect error message" "cannot connect to server"
assert_contains "6.1 hints server command" "flowx-studio server"

# ---------- 2. server 生命周期 ----------
say "== 2. server lifecycle =="
assert_exit "2.1 status stopped" 0 FXS_LOCAL server status
assert_contains "2.1 says stopped" "stopped"
assert_exit "2.2 server start" 0 FXS_LOCAL server start --port "${PORT}"
assert_contains "2.2 started message" "Server started"
assert_contains "2.2 prints url" "url=${BASE_URL}"
assert_exit "2.3 status running" 0 FXS_LOCAL server status
assert_contains "2.3 says running" "running"
assert_exit "2.4 start idempotent" 0 FXS_LOCAL server start --port "${PORT}"
assert_contains "2.4 already running" "already running"

# ---------- 3. 节点管理 ----------
say "== 3. node management =="
cat > "${WORK_DIR}/node.yaml" <<'EOF'
name: e2e-node
language: bash
nodeType: code
code: |
  echo "prefixed=$FLOWX_PARAM_GREETING bare=$GREETING"
parameters:
  - name: greeting
    type: string
    default: hello
mock:
  enabled: true
  code: |
    echo "prefixed=$FLOWX_PARAM_GREETING bare=$GREETING"
EOF
assert_exit "3.1 node create" 0 FXS node create --file "${WORK_DIR}/node.yaml"
assert_contains "3.1 created message" "Created node id="
NODE_ID=$(printf '%s' "${LAST_OUT}" | sed -n 's/.*id=\([0-9]*\).*/\1/p' | head -1)

echo "not: [valid yaml {{{" > "${WORK_DIR}/bad-node.yaml"
assert_exit "3.2 node create invalid" 1 FXS node create --file "${WORK_DIR}/bad-node.yaml"
assert_contains "3.2 invalid definition error" "invalid node definition"

assert_exit "3.3 node list table" 0 FXS node list
assert_contains "3.3 table contains node" "e2e-node"
assert_exit "3.4 node list json" 0 FXS node list --json
assert_contains "3.4 json contains node" "e2e-node"

assert_exit "3.5 node mock" 0 FXS node mock --id "${NODE_ID}" --params '{"greeting":"e2e"}'
assert_contains "3.5 mock success" "status=success"
assert_contains "3.5 prefixed env" "prefixed=e2e"
assert_contains "3.5 bare env alias" "bare=e2e"

mkdir -p "${WORK_DIR}/pkg"
cat > "${WORK_DIR}/pkg/flowx.json" <<'EOF'
{
  "name": "e2e-pkg-node",
  "version": "1.0.0",
  "language": "bash",
  "entry": "main.sh",
  "parameters": [{"name": "msg", "type": "string", "required": false, "default": "hi"}]
}
EOF
echo 'echo "pkg: $FLOWX_PARAM_MSG"' > "${WORK_DIR}/pkg/main.sh"
assert_exit "3.6 node import folder" 0 FXS node import --type folder --path "${WORK_DIR}/pkg"
assert_contains "3.6 imported message" "Imported node id="
PKG_NODE_ID=$(printf '%s' "${LAST_OUT}" | sed -n 's/.*id=\([0-9]*\).*/\1/p' | head -1)

# ---------- 4. 流水线管理 ----------
say "== 4. pipeline management =="
cat > "${WORK_DIR}/wf.yaml" <<'EOF'
Version: "1.0"
Name: e2e-wf
Executors:
  local:
    type: local
    config:
      shell: bash
Graph: |
  stateDiagram-v2
    [*] --> Hello
    Hello --> [*]
Nodes:
  Hello:
    executor: local
    steps:
      - name: hello
        run: echo "e2e pipeline ran"
EOF
assert_exit "4.1 pipeline create" 0 FXS pipeline create --name e2e-wf --file "${WORK_DIR}/wf.yaml"
assert_contains "4.1 created message" "Created pipeline id="
WF_ID=$(printf '%s' "${LAST_OUT}" | sed -n 's/.*id=\([0-9]*\).*/\1/p' | head -1)

echo 'Name: bad' > "${WORK_DIR}/bad-wf.yaml"
assert_exit "4.2 create invalid yaml" 1 FXS pipeline create --name bad --file "${WORK_DIR}/bad-wf.yaml"
assert_contains "4.2 retry hint" "Please regenerate the YAML and retry."

assert_exit "6.3 missing required flags" 1 FXS pipeline create
assert_contains "6.3 hints --schema" "--schema"

# 更新合并语义：不传 --file 时 yaml 保持原值
BEFORE=$(curl -s -H "Authorization: Bearer $(cat "${DATA_DIR}/auth.token")" "${BASE_URL}/api/v1/workflows/${WF_ID}" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['yamlConfig'])")
assert_exit "4.3 pipeline update status only" 0 FXS pipeline update --id "${WF_ID}" --status active
AFTER=$(curl -s -H "Authorization: Bearer $(cat "${DATA_DIR}/auth.token")" "${BASE_URL}/api/v1/workflows/${WF_ID}" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['yamlConfig'])")
[ "${BEFORE}" = "${AFTER}" ] && ok "4.3 yaml preserved on partial update" || bad "4.3 yaml preserved on partial update"

assert_exit "4.4 pipeline list json" 0 FXS pipeline list --json
assert_contains "4.4 list contains workflow" "e2e-wf"

assert_exit "4.5 run --follow success" 0 FXS pipeline run --id "${WF_ID}" --follow
assert_contains "4.5 node name shown" "Hello"
assert_contains "4.5 success status" "SUCCESS"

cat > "${WORK_DIR}/fail-wf.yaml" <<'EOF'
Version: "1.0"
Name: e2e-fail-wf
Executors:
  local:
    type: local
    config:
      shell: bash
Graph: |
  stateDiagram-v2
    [*] --> Boom
    Boom --> [*]
Nodes:
  Boom:
    executor: local
    steps:
      - name: boom
        run: exit 1
EOF
FXS pipeline create --name e2e-fail-wf --file "${WORK_DIR}/fail-wf.yaml" >/dev/null 2>&1
FAIL_WF_ID=$(FXS pipeline list --json | python3 -c "import json,sys; print([w['id'] for w in json.load(sys.stdin)['items'] if w['name']=='e2e-fail-wf'][0])")
assert_exit "4.6 run --follow failure exits 1" 1 FXS pipeline run --id "${FAIL_WF_ID}" --follow
assert_contains "4.6 failed status" "FAILED"

assert_exit "4.7 pipeline delete" 0 FXS pipeline delete --id "${WF_ID}"
assert_contains "4.7 deleted message" "Deleted pipeline id="

# ---------- 7. 审计日志 ----------
say "== 7. audit logs =="
assert_exit "7.1 audit list" 0 FXS audit list
assert_contains "7.1 has create_node" "create_node"
assert_contains "7.1 has run_workflow" "run_workflow"
assert_exit "7.2 audit filter by action" 0 FXS audit list --action create_node --json
assert_contains "7.2 filtered" "create_node"

# ---------- 8. 输入验证 ----------
say "== 8. input validation =="
printf 'name: "1bad name!"\nlanguage: bash\ncode: echo hi\n' > "${WORK_DIR}/badname-node.yaml"
assert_exit "8.1 invalid node name" 1 FXS node create --file "${WORK_DIR}/badname-node.yaml"
assert_contains "8.1 name error" "name must start with a letter"
printf 'name: badlang\nlanguage: cobol\ncode: echo hi\n' > "${WORK_DIR}/badlang-node.yaml"
assert_exit "8.2 unsupported language" 1 FXS node create --file "${WORK_DIR}/badlang-node.yaml"
assert_contains "8.2 language error" "unsupported language"

# ---------- 9. 备份与恢复 ----------
say "== 9. backup & restore =="
assert_exit "9.1 backup create" 0 FXS backup create
assert_contains "9.1 created message" "Created backup"
assert_exit "9.2 backup list" 0 FXS backup list
assert_contains "9.2 list has .db" ".db"
BACKUP_NAME=$(printf '%s' "${LAST_OUT}" | awk '{print $1}' | grep '\.db$' | head -1)
assert_exit "9.3 backup download" 0 FXS backup download --name "${BACKUP_NAME}" -o "${WORK_DIR}/dl.db"
[ -s "${WORK_DIR}/dl.db" ] && ok "9.3 downloaded file non-empty" || bad "9.3 downloaded file non-empty"
assert_exit "9.4 restore while running refused" 1 FXS backup restore --file "${WORK_DIR}/dl.db"
assert_contains "9.4 refuse message" "server stop"

# ---------- 5. 交互命令 ----------
say "== 5. interaction commands =="
OUT=$(echo "" | FXS ask --key env --prompt "pick env" --default prod 2>/dev/null)
[ "${OUT}" = "env=prod" ] && ok "5.1 ask default" || bad "5.1 ask default (got: ${OUT})"
OUT=$(printf 'bad\nstaging\n' | FXS ask --key env --prompt "pick env" --options prod,staging 2>/dev/null)
[ "${OUT}" = "env=staging" ] && ok "5.2 ask options retry" || bad "5.2 ask options retry (got: ${OUT})"
OUT=$(FXS ask --key k --prompt "?" --default d </dev/null 2>/dev/null); CODE=$?
if [ "${OUT}" = "k=d" ] || [ "${CODE}" -ne 0 ]; then ok "5.3 ask EOF"; else bad "5.3 ask EOF (got: ${OUT}, exit 0)"; fi
assert_exit "5.4 info card" 0 FXS info --title "E2E" --message "card body" --level warn
assert_contains "5.4 card title" "E2E"
assert_contains "5.4 card level" "WARN"

# ---------- 6. 其余错误路径 ----------
say "== 6. error paths =="
assert_exit "6.2 unknown flag" 2 FXS pipeline list --nope
assert_contains "6.2 unknown flag message" "unknown flag"

# ---------- 收尾：生命周期停止用例 ----------
say "== 2. lifecycle teardown =="
assert_exit "2.5 server stop" 0 FXS_LOCAL server stop
assert_contains "2.5 stopped message" "Server stopped"

# 停止后验证 restore（9.5）
assert_exit "9.5 restore after stop" 0 FXS_LOCAL backup restore --file "${WORK_DIR}/dl.db"
assert_contains "9.5 restored message" "Restored database"

# 恢复后重新拉起，验证 2.6/2.7
FXS_LOCAL server start --port "${PORT}" >/dev/null 2>&1 || true
assert_exit "2.6 status after restart" 0 FXS_LOCAL server status
assert_contains "2.6 says running" "running"
assert_exit "2.7 final stop" 0 FXS_LOCAL server stop
assert_contains "2.7 stopped message" "Server stopped"
FXS_LOCAL server status | grep -q stopped && ok "2.8 status stopped after final stop" || bad "2.8 status stopped after final stop"

# ---------- 汇总 ----------
say ""
say "==============================="
say "E2E 结果: ${PASS} passed, ${FAIL} failed"
if [ "${FAIL}" -gt 0 ]; then
    printf '失败用例:\n'; printf '  - %s\n' "${FAILED_CASES[@]}"
    exit 1
fi
say "全部通过 ✓"
