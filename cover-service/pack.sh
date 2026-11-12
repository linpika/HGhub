#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
stage=$(mktemp -d)
name=cover-service-linux
dest="$stage/$name"
mkdir -p "$dest/bin" "$dest/deploy" "$dest/.build"
cp "$root/cover-service/"*.mjs "$root/cover-service/README.md" "$root/cover-service/NOTICE" "$root/cover-service/env.example" "$root/cover-service/package.json" "$root/cover-service/package-lock.json" "$dest/"
mkdir -p "$dest/rex"
cp "$root/rex/hghub.widget.js" "$root/rex/test-widget.mjs" "$dest/rex/"
cp "$root/cover-service/bin/"*.sh "$dest/bin/"
cp "$root/cover-service/deploy/"* "$dest/deploy/"
cp "$root/src-tauri/src/media.rs" "$dest/.build/media.rs"
if [ -f "$root/cover-service/evidence/guest-cover.json" ]; then
  mkdir -p "$dest/evidence"
  cp "$root/cover-service/evidence/guest-cover.json" "$dest/evidence/"
fi
cp "$root/LICENSE" "$dest/LICENSE"
chmod 755 "$dest/bin/"*.sh "$dest/deploy/"*.sh
find "$dest" -name '.env' -o -name 'secret' -o -name '*.secret' | while read -r hit; do
  echo "refusing to pack $hit" >&2
  exit 1
done
mkdir -p "$root/dist"
tar -C "$stage" -czf "$root/dist/cover-service-linux.tar.gz" "$name"
rm -rf "$stage"
echo "$root/dist/cover-service-linux.tar.gz"
