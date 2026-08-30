#!/usr/bin/env bash
# earth-3d-viewer 入口：计算当前真实太阳直射点（subsolar point）
# 算法：低精度太阳位置模型（J2000 起算），误差 < 0.1°，对可视化足够精确
set -euo pipefail

NOW=$(date -u +%s)
UTC_ISO=$(date -u -d "@${NOW}" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "${NOW}" '+%Y-%m-%dT%H:%M:%SZ')

# 太阳直射点计算（赤纬 + 均时差/GMST）
RESULT=$(awk -v now="$NOW" 'BEGIN {
  D2R = atan2(0, -1) / 180.0
  d = (now - 946728000) / 86400.0            # 距 J2000.0 的天数
  L = 280.460 + 0.9856474 * d                # 平黄经
  g = 357.528 + 0.9856003 * d                # 平近点角
  g = g % 360; if (g < 0) g += 360
  lambda = L + 1.915 * sin(g * D2R) + 0.020 * sin(2 * g * D2R)   # 视黄经
  eps  = 23.439 - 0.0000004 * d              # 黄赤交角
  s = sin(eps * D2R) * sin(lambda * D2R)
  decl = atan2(s, sqrt(1 - s * s)) / D2R     # 赤纬 = 直射点纬度
  ra = atan2(cos(eps * D2R) * sin(lambda * D2R), cos(lambda * D2R)) / D2R  # 赤经(度)
  if (ra < 0) ra += 360
  gmst = (18.697374558 + 24.06570982441908 * d) * 15.0   # 格林尼治恒星时(度)
  gmst = gmst % 360; if (gmst < 0) gmst += 360
  lon = ra - gmst                             # 直射点经度
  while (lon > 180) lon -= 360
  while (lon < -180) lon += 360
  printf "%.4f %.4f", decl, lon
}')
SUN_LAT=${RESULT% *}
SUN_LON=${RESULT#* }

# UI 渲染配置（画布 3D 组件通过 outputs.config 读取）
AUTO_ROTATE=${AUTO_ROTATE:-true}
ROTATION_SPEED=${ROTATION_SPEED:-2}
CAMERA_LAT=${CAMERA_LAT:-25}
CAMERA_LON=${CAMERA_LON:-110}
CLOUD_OPACITY=${CLOUD_OPACITY:-0.85}
CONFIG=$(printf '{"autoRotate":%s,"rotationSpeed":%s,"cameraLat":%s,"cameraLon":%s,"cloudOpacity":%s}' \
  "$AUTO_ROTATE" "$ROTATION_SPEED" "$CAMERA_LAT" "$CAMERA_LON" "$CLOUD_OPACITY")

echo "earth-3d-viewer: UTC=${UTC_ISO} subsolar=(${SUN_LAT}, ${SUN_LON})"
echo '```flowx-yaml'
echo "sun_lat: ${SUN_LAT}  # 太阳直射点纬度（度）"
echo "sun_lon: ${SUN_LON}  # 太阳直射点经度（度，东经为正）"
echo "utc_time: \"${UTC_ISO}\"  # 计算时刻 UTC"
echo "config: '${CONFIG}'  # UI 渲染配置 JSON"
echo '```'
