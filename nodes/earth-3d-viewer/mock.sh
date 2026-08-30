#!/usr/bin/env bash
# earth-3d-viewer mock：固定直射点（夏至正午直射北回归线附近），用于离线验证
set -euo pipefail
UTC_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "mock")
AUTO_ROTATE=${AUTO_ROTATE:-true}
ROTATION_SPEED=${ROTATION_SPEED:-2}
CAMERA_LAT=${CAMERA_LAT:-25}
CAMERA_LON=${CAMERA_LON:-110}
CLOUD_OPACITY=${CLOUD_OPACITY:-0.85}
CONFIG=$(printf '{"autoRotate":%s,"rotationSpeed":%s,"cameraLat":%s,"cameraLon":%s,"cloudOpacity":%s}' \
  "$AUTO_ROTATE" "$ROTATION_SPEED" "$CAMERA_LAT" "$CAMERA_LON" "$CLOUD_OPACITY")

echo "earth-3d-viewer mock: fixed subsolar point"
echo '```flowx-yaml'
echo "sun_lat: 23.4367  # 太阳直射点纬度（度，mock 固定值）"
echo "sun_lon: 15.0000  # 太阳直射点经度（度，mock 固定值）"
echo "utc_time: \"${UTC_ISO}\"  # 计算时刻 UTC"
echo "config: '${CONFIG}'  # UI 渲染配置 JSON"
echo '```'
