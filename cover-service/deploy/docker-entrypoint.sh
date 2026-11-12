#!/bin/sh
set -eu
if [ ! -s "$COVER_SECRET_FILE" ]; then
  umask 077
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' > "$COVER_SECRET_FILE"
  chown node:node "$COVER_SECRET_FILE"
  chmod 600 "$COVER_SECRET_FILE"
fi
exec su-exec node:node node server.mjs
