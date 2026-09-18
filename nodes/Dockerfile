# FlowX Studio 自带节点共享镜像（镜像节点，executor.bundled）
#
# echo / earth-3d-viewer 是 bash 节点，get-weather / send-feishu 是 python 节点；
# python:3.11-slim（Debian）自带 bash，一个镜像全覆盖。
# 每个节点代码在 /opt/flowx-nodes/<name>/；ui/ 资产由 Studio 服务前端，不进镜像。
FROM python:3.11-slim

LABEL org.opencontainers.image.title="flowx-studio-nodes" \
      org.opencontainers.image.description="FlowX Studio bundled builtin node image"

WORKDIR /opt/flowx-nodes

COPY echo/main.sh             /opt/flowx-nodes/echo/
COPY get-weather/main.py      /opt/flowx-nodes/get-weather/
COPY send-feishu/main.py      /opt/flowx-nodes/send-feishu/
COPY earth-3d-viewer/main.sh  /opt/flowx-nodes/earth-3d-viewer/

RUN set -e; for d in /opt/flowx-nodes/*/; do ls "$d" >/dev/null; done
