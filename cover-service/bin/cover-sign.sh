#!/bin/sh
# 向 stdout 只写一行签名 URL。密钥来自环境变量，不回显。
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
if [ -z "${COVER_SIGNING_SECRET:-}" ] || [ -z "${COVER_PUBLIC_ORIGIN:-}" ]; then
  echo "COVER_SIGNING_SECRET and COVER_PUBLIC_ORIGIN are required" >&2
  exit 1
fi
exec node server.mjs sign
