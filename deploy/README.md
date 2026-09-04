# Deploying the console and the platform portal

Two products, one Next process, two hostnames. `src/middleware.ts` decides
which hostname serves which; Caddy terminates TLS and proxies both to the same
upstream on loopback.

## Why a standalone build rather than `npm install` on the server

The Font Awesome kit is a private package, so installing on the VPS would mean
putting `FA_PACKAGE_TOKEN` on the box and keeping it there. `output:
"standalone"` traces exactly what the built app imports and copies it beside
the server, so the server resolves nothing and needs no registry credential.

It also means what is deployed is the artefact that was built and tested,
rather than a fresh resolve that may pick up a different patch version.

## The deploy

```bash
npm run build

rsync -a --delete .next/standalone/ vokoo:/opt/vokoo/console/
rsync -a --delete .next/static/     vokoo:/opt/vokoo/console/.next/static/
rsync -a          public/           vokoo:/opt/vokoo/console/public/

ssh vokoo systemctl restart vokoo-console
```

The two `.next` copies are both required and easy to get wrong: `standalone`
carries the server and its traced dependencies but **not** the static assets,
so shipping only the first gives a running server that renders unstyled pages.

## Checking the host routing without DNS

Each product should be *absent* from the other's host, not merely hidden:

```bash
ssh vokoo 'curl -s -o /dev/null -w "%{http_code}\n" -H "Host: platform.sarvathra.ai" http://127.0.0.1:3000/dashboard'   # 404
ssh vokoo 'curl -s -o /dev/null -w "%{http_code}\n" -H "Host: console.sarvathra.ai"  http://127.0.0.1:3000/platform'    # 404
```

## `api.sarvathra.ai` is not optional

A page served over HTTPS cannot call `http://`. The browser blocks it as mixed
content without making the request, so the deployed console fails every call
while the API is healthy and answers `curl` perfectly. The control plane needs
a TLS host of its own.

Port 8081 stays open alongside it, because the console is still developed
locally against that address. That is a deliberate loose end.

## CORS is a list

`CORS_ORIGIN` takes comma-separated origins. One value meant deploying broke
local work and local work broke the deployment.

## Build with `npm run build:deploy`, never `npm run build`

`NEXT_PUBLIC_*` is inlined into the bundle **at build time**, and Next.js loads
`.env.local` *after* `.env.production` — in a production build as well. So a
plain `npm run build` on a development machine bakes in whatever the developer
points at.

It did. The deployed console called `http://212.38.94.176:8081`, the VPS by raw
IP over plain HTTP, from an HTTPS page — so it was both the wrong host and
blocked as mixed content. The correct `.env.production` was sitting on the
server the whole time and could do nothing, because the value had already been
compiled in.

`build:deploy` exports `.env.production` as real environment variables before
running the build, and a shell variable beats every `.env` file.

**The check, which is two seconds and would have caught this:**

```bash
grep -rlo "212.38" .next/static | head        # expect nothing
grep -rlo "api.sarvathra.ai" .next/static | head   # expect a chunk
```

Worth doing after any build that is about to be rsynced, because nothing else
fails: the bundle compiles, deploys and serves perfectly while pointing at a
host the browser will refuse to call.
