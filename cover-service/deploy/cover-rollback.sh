#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
if ! docker image inspect hghub-cover:previous >/dev/null 2>&1; then
  echo "no previous image" >&2
  exit 1
fi
docker tag hghub-cover:previous hghub-cover:latest
docker compose -f "$root/cover-service/deploy/docker-compose.yml" up -d --no-build
