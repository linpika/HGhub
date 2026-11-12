#!/bin/sh
# 默认拒绝启动。只在明确选择 host 或 shared 且预检通过后构建自己的容器。
# 不修改已经在跑的 Caddy 或 xray，也不监听 80/443/8443。
set -eu
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
base=$(CDPATH= cd -- "$here/.." && pwd)
if [ ! -f "$base/.build/media.rs" ]; then
  if [ -f "$base/../src-tauri/src/media.rs" ]; then
    mkdir -p "$base/.build"
    cp "$base/../src-tauri/src/media.rs" "$base/.build/media.rs"
  else
    echo "media.rs is missing" >&2
    exit 1
  fi
fi
mode=${COVER_NETWORK:-}
if [ "$mode" != "host" ] && [ "$mode" != "shared" ]; then
  echo "Refusing to start. Set COVER_NETWORK=host or COVER_NETWORK=shared." >&2
  exit 1
fi
proxy=${TRUST_PROXY:-}
if ! printf '%s\n' "$proxy" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$|^[0-9A-Fa-f:]+$'; then
  echo "TRUST_PROXY must be one exact proxy address." >&2
  exit 1
fi
case "$proxy" in
  0.0.0.0|::|'*')
    echo "TRUST_PROXY must not be a wildcard." >&2
    exit 1
    ;;
esac
port=${PORT:-8787}
case "$port" in
  80|443|8443)
    echo "Refusing to use port $port." >&2
    exit 1
    ;;
esac
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not available" >&2
  exit 1
fi
override="$here/compose.host.yml"
if [ "$mode" = "shared" ]; then
  network=${COVER_DOCKER_NETWORK:-}
  if [ -z "$network" ]; then
    echo "COVER_DOCKER_NETWORK must name an existing network." >&2
    exit 1
  fi
  docker network inspect "$network" >/dev/null
  override="$here/compose.shared.yml"
fi
if docker image inspect hghub-cover:latest >/dev/null 2>&1; then
  docker tag hghub-cover:latest hghub-cover:previous
fi
PORT="$port" TRUST_PROXY="$proxy" COVER_DOCKER_NETWORK="${COVER_DOCKER_NETWORK:-}" \
  docker compose -f "$here/docker-compose.yml" -f "$override" up -d --build
