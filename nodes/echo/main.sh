#!/usr/bin/env bash
# echo 节点：先 sleep 指定秒数，再输出日志并回显消息
set -e

MSG="${ECHO_MESSAGE:-hello}"
SLEEP="${ECHO_SLEEP:-0}"

echo "[echo] message=${MSG} sleep=${SLEEP}s"

# 支持小数的 sleep 时长
if awk "BEGIN{exit !($SLEEP > 0)}"; then
  echo "[echo] sleeping ${SLEEP}s ..."
  sleep "$SLEEP"
fi

echo "[echo] done: ${MSG}"

# 输出字段（regex 提取）：text=<message>
echo "text=${MSG}"
