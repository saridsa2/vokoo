#!/bin/zsh
set -euo pipefail

SARVATHRA_ROOT="${SARVATHRA_ROOT:-/Users/satyasumansaridae/Sarvathra}"
CONSOLE_DIR="$SARVATHRA_ROOT/runtime/console"

cd "$CONSOLE_DIR"
exec env \
  HOSTNAME=127.0.0.1 \
  PORT=3000 \
  NODE_ENV=production \
  /opt/homebrew/bin/node server.js
