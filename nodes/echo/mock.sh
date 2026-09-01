#!/usr/bin/env bash
# echo 节点 mock：不实际 sleep，直接回显，便于快速验证参数注入与输出提取
MSG="${FLOWX_PARAM_MESSAGE:-${ECHO_MESSAGE:-${MESSAGE:-hello}}}"
SLEEP="${FLOWX_PARAM_SLEEP:-${ECHO_SLEEP:-${SLEEP:-0}}}"

echo "[echo][mock] message=${MSG} sleep=${SLEEP}s (sleep skipped in mock)"
echo "text=${MSG}"
