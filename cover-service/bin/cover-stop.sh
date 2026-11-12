#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
if [ ! -f run/cover.pid ]; then
  echo "not running" >&2
  exit 1
fi
pid=$(cat run/cover.pid)
kill "$pid"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 50 ]; then
    kill -9 "$pid" 2>/dev/null || true
    break
  fi
  sleep 0.1
done
rm -f run/cover.pid
