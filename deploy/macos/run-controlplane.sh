#!/bin/zsh
set -euo pipefail

SARVATHRA_ROOT="${SARVATHRA_ROOT:-/Users/satyasumansaridae/Sarvathra}"

set -a
source "$SARVATHRA_ROOT/shared/controlplane.env"
set +a

export CONTROLPLANE_HOST=127.0.0.1

cd "$SARVATHRA_ROOT/current/server"
exec "$SARVATHRA_ROOT/current/server/target/release/vokoo-controlplane"
