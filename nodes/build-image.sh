#!/usr/bin/env bash
# 构建并推送 Studio 自带节点共享镜像。节点代码变更后 bump BUNDLE_VERSION 再跑。
set -euo pipefail
cd "$(dirname "$0")"

TAG="lerkobba/flowx-studio-nodes:v$(tr -d '[:space:]' < BUNDLE_VERSION)"
echo "==> building $TAG"
docker build -t "$TAG" .
echo "==> pushing $TAG"
docker push "$TAG"
echo "==> done: $TAG"
