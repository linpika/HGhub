#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
mode=${COVER_NETWORK:-}
if [ "$mode" != "host" ] && [ "$mode" != "shared" ]; then
  echo "Refusing to roll back. Set COVER_NETWORK=host or COVER_NETWORK=shared." >&2
  exit 1
fi
if [ -z "${TRUST_PROXY:-}" ]; then
  echo "TRUST_PROXY must be one exact proxy address." >&2
  exit 1
fi
if ! docker image inspect hghub-cover:previous >/dev/null 2>&1; then
  echo "no previous image" >&2
  exit 1
fi
override="$here/compose.host.yml"
if [ "$mode" = "shared" ]; then
  if [ -z "${COVER_DOCKER_NETWORK:-}" ]; then
    echo "COVER_DOCKER_NETWORK must name an existing network." >&2
    exit 1
  fi
  docker network inspect "$COVER_DOCKER_NETWORK" >/dev/null
  override="$here/compose.shared.yml"
fi
docker tag hghub-cover:previous hghub-cover:latest
PORT="${PORT:-8787}" TRUST_PROXY="$TRUST_PROXY" COVER_DOCKER_NETWORK="${COVER_DOCKER_NETWORK:-}" \
  docker compose -f "$here/docker-compose.yml" -f "$override" up -d --no-build
