#!/bin/sh
# 在安装目录启动。密钥缺失时生成到 run/secret，不打印密钥。
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
mkdir -p run
if [ -z "${COVER_SIGNING_SECRET:-}" ]; then
  if [ ! -s run/secret ]; then
    umask 077
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' > run/secret
    chmod 600 run/secret
  fi
  COVER_SIGNING_SECRET=$(cat run/secret)
  export COVER_SIGNING_SECRET
fi
if [ -z "${COVER_PUBLIC_ORIGIN:-}" ]; then
  echo "COVER_PUBLIC_ORIGIN is empty" >&2
  exit 1
fi
PORT="${PORT:-8787}"
export PORT
if [ -f run/cover.pid ] && kill -0 "$(cat run/cover.pid)" 2>/dev/null; then
  echo "already running" >&2
  exit 1
fi
node server.mjs >> run/service.log 2>&1 &
echo $! > run/cover.pid
