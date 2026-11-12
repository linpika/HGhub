#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
mkdir -p "$root/cover-service/.build"
cp "$root/src-tauri/src/media.rs" "$root/cover-service/.build/media.rs"
if docker image inspect hghub-cover:latest >/dev/null 2>&1; then
  docker tag hghub-cover:latest hghub-cover:previous
fi
docker compose -f "$root/cover-service/deploy/docker-compose.yml" up -d --build
