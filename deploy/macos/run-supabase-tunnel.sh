#!/bin/zsh
set -euo pipefail

SARVATHRA_ROOT="${SARVATHRA_ROOT:-/Users/satyasumansaridae/Sarvathra}"

exec /usr/bin/ssh \
  -NT \
  -i "$SARVATHRA_ROOT/shared/mini-to-vps" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=yes \
  -L 127.0.0.1:18000:127.0.0.1:8000 \
  -R 127.0.0.1:13000:127.0.0.1:3000 \
  -R 127.0.0.1:18081:127.0.0.1:8081 \
  root@212.38.94.176
