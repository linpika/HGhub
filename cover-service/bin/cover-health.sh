#!/bin/sh
set -eu
port="${PORT:-8787}"
exec curl -fsS "http://127.0.0.1:${port}/healthz"
