#!/bin/zsh
set -euo pipefail

SARVATHRA_ROOT="${SARVATHRA_ROOT:-/Users/satyasumansaridae/Sarvathra}"

export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin
export DOCKER_CONFIG="$SARVATHRA_ROOT/shared/docker-config"
export DOCKER_HOST="unix:///Users/satyasumansaridae/.colima/default/docker.sock"

cd "$SARVATHRA_ROOT/supabase/docker"
exec /opt/homebrew/bin/docker-compose "$@"
