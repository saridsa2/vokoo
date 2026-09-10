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

## Document indexing and pgvector

The pinned database image is `supabase/postgres:17.6.1.136`. It already ships
pgvector 0.8.2 through its Nix PostgreSQL profile, so document indexing does
not require replacing the database image or touching its data volume.

Before applying migration `0123_document_indexing.sql`, verify the extension
is still available:

```bash
ssh vokoo "docker exec -i -u postgres -e DATABASE_URL=postgresql:///postgres supabase-db sh" \
  < deploy/postgres/verify-vector.sh
```

The command must print `vector-ready`. A missing extension is a deployment
blocker; do not apply the vector-column migration against a different image
and do not install an unpinned extension ad hoc into the running container.

Take and verify a PostgreSQL backup before the migration. Then apply migrations
with `ON_ERROR_STOP=1`. Migration 0123 runs:

```sql
create extension if not exists vector with schema extensions;
```

The extension is additive. Rolling application code back does not require
dropping it, its tables, or its indexes. A database rollback uses the verified
pre-migration backup; do not improvise a partial destructive rollback and never
run `docker compose down -v`.

## Document worker

`vokoo_document_worker` is deliberately separate from the call bridge. It
claims one durable ingestion lease at a time and listens only on
`127.0.0.1:8082` for health and internal document endpoints. Its environment
file is `/opt/vokoo/rustvani/.env` and must already provide `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `VOKOO_INTERNAL_TOKEN`. The Gemini key is not
duplicated there: the worker resolves the operator-managed `gemini` platform
credential through `resolve_vendor_secret`.

PDF layout extraction is selected explicitly by the systemd unit. It invokes
the pinned `vokoo-docling-rs:1.37.0-5a4f78e` CPU image through
`deploy/document-extractor/docling-vps`; the container receives one staged PDF,
has no network, and is limited to 2 CPUs, 4 GiB of memory, 256 processes, and a
512 MiB temporary filesystem. Build the small pinning image and prepare its
root-only staging directory before restarting the worker:

```bash
ssh vokoo 'cd /opt/vokoo/rustvani && sudo docker build -t vokoo-docling-rs:1.37.0-5a4f78e deploy/document-extractor'
ssh vokoo 'sudo install -d -m 0700 /opt/vokoo/document-extractor/tmp && sudo chmod 0755 /opt/vokoo/rustvani/deploy/document-extractor/docling-vps'
ssh vokoo '/opt/vokoo/rustvani/deploy/document-extractor/docling-vps --version'
```

Install or update the unit only after all document and compiler migrations through 0130
succeed:

```bash
ssh vokoo 'sudo cp /opt/vokoo/rustvani/deploy/vokoo-document-worker.service /etc/systemd/system/'
ssh vokoo 'sudo systemctl daemon-reload && sudo systemctl enable --now vokoo-document-worker'
ssh vokoo 'curl --fail --silent http://127.0.0.1:8082/health'
```

There must be only one enabled instance initially. The database lease remains
the correctness boundary if the process restarts; systemd uses a five-second
restart delay and the worker resumes from already-persisted chunks and vectors.

### Modal document extraction

For larger PDFs, the worker can keep its durable lease, persistence, embedding,
and classification work on the VPS while sending only the immutable PDF to a
Modal extractor with 16 reserved CPU cores. The endpoint returns Docling JSON;
Vokoo still normalizes and validates it before persistence.

The Modal image is pinned to the official Docling.rs CPU 1.37.0 image digest.
The upstream CUDA 1.37.0 images currently contain dangling ONNX provider-library
links under Modal's image import, so GPU execution is deliberately not selected
until an immutable upstream artifact passes the same fixture and NG28 corpus.
Create the endpoint bearer secret once, then deploy the app:

```bash
modal secret create vokoo-document-extractor-auth AUTH_TOKEN='<random-token>'
modal deploy deploy/document-extractor/modal_app.py
```

Put the generated HTTPS endpoint (including `/extract`) in
`/opt/vokoo/rustvani/.env` as `VOKOO_MODAL_DOCLING_URL`. Store the same bearer
token as the `Modal` key in the operator portal; it is encrypted in Supabase
Vault and resolved through the service-role-only `resolve_vendor_secret` RPC at
worker startup. Never place the token in the VPS environment, systemd unit, or
repository. Install the unit above only after the endpoint and operator key
exist. To return to the local CPU provider, override
`VOKOO_DOCUMENT_EXTRACTION_PROVIDER` with `docling-vps` and restore
`VOKOO_DOCLING_PATH` and `VOKOO_DOCUMENT_STAGING_DIR` from the wrapper
configuration above.

### Care-path compiler worker

The compiler shares the single off-call document worker process, but uses its
own durable queue and lease. Keep `VOKOO_COMPILER_ENABLED=false` while deploying
or rolling back binaries. After migrations 0127-0130 and the worker health check
pass, set it to `true` in the systemd override and restart the unit. The health
response reports `compiler_enabled`; only one worker process is supported for
the initial acceptance run.

Enable it only after those checks by installing the reviewed override:

```bash
rsync -az deploy/vokoo-document-worker-compiler-enabled.conf \
  vokoo:/opt/vokoo/rustvani/deploy/
ssh vokoo 'sudo install -D -m 0644 \
  /opt/vokoo/rustvani/deploy/vokoo-document-worker-compiler-enabled.conf \
  /etc/systemd/system/vokoo-document-worker.service.d/compiler-enabled.conf && \
  sudo systemctl daemon-reload && sudo systemctl restart vokoo-document-worker'
```

To disable it, remove only that drop-in, reload systemd, and restart the worker;
the base unit remains `VOKOO_COMPILER_ENABLED=false`.

Migration `0130_compiler_materialization_recovery.sql` is part of the compiler
release, not an optional follow-up. It lets an expired `materializing` lease be
reclaimed so a retry can replay the idempotent materialization transaction. Take
and verify a fresh backup before applying it:

```bash
ssh vokoo 'test ! -e /opt/vokoo/backups/compiler-pre-0130.dump && \
  docker exec supabase-db pg_dump -U postgres -Fc postgres > /opt/vokoo/backups/compiler-pre-0130.dump && \
  test -s /opt/vokoo/backups/compiler-pre-0130.dump && \
  docker exec -i supabase-db pg_restore --list < /opt/vokoo/backups/compiler-pre-0130.dump >/dev/null'

ssh vokoo 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' \
  < supabase/migrations/0130_compiler_materialization_recovery.sql
ssh vokoo 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' \
  < supabase/tests/0130_compiler_materialization_recovery.sql
```

Run the `0127`, `0128`, and `0129` SQL tests again after `0130`; every test is
transactional and must end in `ROLLBACK`. Then reload PostgREST and verify the
disabled worker before enabling compilation:

```bash
ssh vokoo 'docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "notify pgrst, '\''reload schema'\''"'
ssh vokoo 'curl --fail --silent http://127.0.0.1:8082/health'
```

The provider and model are frozen when a run is enqueued. Credentials are not
environment variables or browser inputs: the worker resolves the organization's
operator-managed Vault secret before constructing Anthropic, MiniMax, or OpenAI
through AISDK. Structured trace rows contain IDs, page ranges, chunk IDs, counts,
tokens, durations, and stable error codes only—never source text or model prose.
