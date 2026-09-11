#!/bin/zsh
set -euo pipefail

export HOME=/Users/satyasumansaridae
export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin

# `colima start` daemonizes after the VM is ready. Keep this launchd-owned
# supervisor alive so a stopped VM is brought back without a user login.
while true; do
  if ! /opt/homebrew/bin/colima status >/dev/null 2>&1; then
    /opt/homebrew/bin/colima start
  fi
  /bin/sleep 30
done
