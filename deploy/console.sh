#!/usr/bin/env bash
#
# Deploy the console and the platform portal.
#
# Three rsyncs in this order, every time. The order is not incidental:
#
#   1. `.next/standalone` with --delete, which wipes anything on the server
#      that Next did not put in the standalone output — and Next puts neither
#      `.next/static` nor `public` there.
#   2. `.next/static`, restoring what step 1 removed.
#   3. `public`, likewise.
#
# Skipping step 3 deletes the favicon and every image on the site. It has
# happened; that is why this is a script and not three commands somebody
# remembers.
#
# The build is `build:deploy`, never `build` — see README.md. `.env.local`
# overrides `.env.production` even in a production build, so a plain build bakes
# a developer's own API URL into the bundle.
set -euo pipefail

HOST="${1:-vokoo}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> building with the production environment"
npm run build:deploy

echo "==> checking the bundle points at the right API"
if grep -rqo "212\.38\." .next/static 2>/dev/null; then
    echo "    REFUSING: the bundle contains a raw VPS IP." >&2
    echo "    A plain 'next build' picked up .env.local. Use npm run build:deploy." >&2
    exit 1
fi
grep -rqo "api.sarvathra.ai" .next/static \
    || { echo "    REFUSING: the bundle names no API host." >&2; exit 1; }
echo "    ok"

echo "==> 1/3 standalone (this deletes everything not in it)"
rsync -az --delete .next/standalone/ "$HOST:/opt/vokoo/console/"
echo "==> 2/3 static"
rsync -az --delete .next/static/     "$HOST:/opt/vokoo/console/.next/static/"
echo "==> 3/3 public"
rsync -az --delete public/           "$HOST:/opt/vokoo/console/public/"

echo "==> restarting"
ssh "$HOST" 'systemctl restart vokoo-console && sleep 4 && systemctl is-active vokoo-console'

echo "==> checking what the server actually serves"
ssh "$HOST" 'for p in /favicon.ico /sarvathra-mark@2x.png; do
    printf "    %-24s " "$p"
    curl -s -o /dev/null -w "%{http_code}\n" -H "Host: console.sarvathra.ai" "http://127.0.0.1:3000$p"
done'
