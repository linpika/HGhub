#!/bin/sh
# 在 COVER_ROOT 下把 current 指回 previous。不猜测主机或域名。
set -eu
if [ -z "${COVER_ROOT:-}" ] || [ ! -d "$COVER_ROOT/previous" ] || [ ! -L "$COVER_ROOT/current" ]; then
  echo "COVER_ROOT must contain current symlink and previous directory" >&2
  exit 1
fi
hold=$(mktemp -d)
mv "$COVER_ROOT/current" "$hold/current"
mv "$COVER_ROOT/previous" "$COVER_ROOT/current"
mv "$hold/current" "$COVER_ROOT/previous"
rmdir "$hold"
echo "rolled back current"
