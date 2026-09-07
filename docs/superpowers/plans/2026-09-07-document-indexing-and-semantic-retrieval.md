# Document Indexing and Semantic Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build immutable document version uploads, durable structure-aware indexing with Gemini embeddings, tenant-scoped hybrid retrieval, and retrieval-backed Workspace Intelligence recommendations.

**Architecture:** PostgreSQL stores immutable sources, versioned chunks, embeddings, and leased jobs. A dedicated Rust `vokoo-document-worker` processes jobs and serves an internal search endpoint; the control plane remains the authenticated tenant boundary, while the console and operator portal expose version status and embedding-profile controls.

**Tech Stack:** PostgreSQL 17.6, Supabase/PostgREST RLS and RPCs, bundled pgvector 0.8.2, Rust/Axum/reqwest, Gemini `gemini-embedding-2`, Next.js/React/TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-07-document-indexing-and-semantic-retrieval-design.md`

## Global Constraints

- Current-version chunks are searched by default; historical retrieval requires both document id and version.
- Initial embedding profile is Gemini `gemini-embedding-2`, 768 dimensions, cosine distance, `RETRIEVAL_DOCUMENT`/`RETRIEVAL_QUERY` task types.
- Gemini credentials come only from the operator-managed `resolve_vendor_secret` path.
- Workspace Intelligence recommends registered compilers but never executes one.
- Document source, extracted text, chunks, and vectors stay tenant-scoped; browser clients never receive vectors or provider keys.
- Processing must run outside latency-sensitive call execution and start with worker concurrency one.
- Use synthetic documents only for tests and deployment verification.
- Preserve unrelated untracked `bridge/` files and the other agent's auth changes; stage only files named by each task.

---

## File Structure

### Database and deployment

- `deploy/postgres/verify-vector.sh` — read-only extension preflight used before migrations.
- `deploy/vokoo-document-worker.service` — isolated worker/search service.
- `deploy/README.md` — extension preflight, migration, worker, and rollback runbook.
- `supabase/migrations/0123_document_indexing.sql` — profiles, version metadata, chunks, embeddings, jobs, RLS, and indexing RPCs.
- `supabase/migrations/0124_document_retrieval.sql` — current/historical hybrid retrieval and profile-switch RPCs.
- `supabase/tests/0123_document_indexing.sql` — version, job lease, idempotency, and tenant tests.
- `supabase/tests/0124_document_retrieval.sql` — current-version, historical-version, hybrid rank, and profile-switch tests.

### Rust document service

- `bridge/src/vokoo/documents/mod.rs` — shared document types and module boundary.
- `bridge/src/vokoo/documents/extract.rs` — PDF, DOCX, text, and Markdown extraction.
- `bridge/src/vokoo/documents/chunk.rs` — deterministic `clinical-structure-v1` chunker.
- `bridge/src/vokoo/documents/embedding.rs` — embedding profile types, Gemini request construction, response validation, and provider interface.
- `bridge/src/vokoo/documents/jobs.rs` — PostgREST/RPC job repository and state transitions.
- `bridge/src/vokoo/documents/metrics.rs` — queue, stage, provider, and retrieval metrics without source text.
- `bridge/src/vokoo/documents/search.rs` — query embedding and hybrid-search RPC client.
- `bridge/src/vokoo/documents/worker.rs` — leased job orchestration and Workspace Intelligence classification.
- `bridge/src/bin/vokoo_document_worker.rs` — polling loop, internal Axum search API, health endpoint, and graceful shutdown.
- `bridge/src/vokoo/intelligence.rs` — consume retrieval evidence and keep compiler recommendations bounded.
- `bridge/src/vokoo/mod.rs`, `bridge/Cargo.toml`, `bridge/Cargo.lock` — module/binary registration and dependencies.

### Control plane and console

- `server/src/main.rs` — version, process, job status, and search routes; synchronous analyze compatibility wrapper.
- `src/lib/document-workspace.ts` — version/job/search types and state helpers.
- `src/lib/document-workspace.test.ts` — UI-domain tests.
- `src/utils/api-client.ts` — document version, process, job, and search calls.
- `src/components/application/screens/documents-screen.tsx` — version history, processing state, retry, and evidence UI.
- `src/components/application/screens/tenant-detail-screen.tsx` — operator embedding-profile control.
- `package.json` — include document tests in the existing test command.

---

### Task 1: Stabilize the Existing Documents Foundation

**Files:**
- Modify: `supabase/migrations/0121_document_workspace.sql`
- Modify: `supabase/migrations/0122_document_digest_search_path.sql`
- Test: `supabase/tests/0121_document_workspace.sql`
- Modify: `server/src/main.rs`
- Modify: `server/Cargo.toml`
- Modify: `server/Cargo.lock`
- Modify: `bridge/src/vokoo/intelligence.rs`
- Modify: `bridge/src/bin/vokoo_bridge.rs`
- Modify: `bridge/Cargo.toml`
- Modify: `bridge/Cargo.lock`
- Modify: `src/lib/document-workspace.ts`
- Test: `src/lib/document-workspace.test.ts`
- Modify: `src/utils/api-client.ts`
- Create: `src/components/application/screens/documents-screen.tsx`
- Modify: `src/app/(console)/[...screen]/page.tsx`
- Modify: `src/components/application/app-navigation/vokoo-nav.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: immutable `file_versions`, `create_document(uuid,text,text,text)`, `POST /api/v1/documents`, the `/files` Documents pane, and the existing synchronous inspection compatibility path.
- Consumes: existing `files`, organization membership RLS, operator-managed Workspace Intelligence provider/model, and `resolve_vendor_secret`.

- [x] **Step 1: Run the focused red/green tests already added for this foundation**

Run:

```bash
node --import tsx --test src/lib/document-workspace.test.ts
cargo test --manifest-path server/Cargo.toml document_uploads_are_bounded_before_the_database_sees_them
cargo test --manifest-path bridge/Cargo.toml document_
```

Expected: all focused tests pass; failures are repaired without changing the approved source/version boundary.

- [x] **Step 2: Verify TypeScript and production compilation**

Run:

```bash
npx tsc --noEmit
npm run build
```

Expected: both commands exit zero. Existing deprecation or `metadataBase` warnings may remain, but no document-related warning or error is accepted.

- [x] **Step 3: Re-run the transaction-scoped SQL test on the VPS**

Run the test file through `psql` against the Supabase database. Expected: `BEGIN`, all `DO` blocks complete, and `ROLLBACK`; no persistent test rows remain.

- [x] **Step 4: Commit only the Documents foundation**

```bash
git add supabase/migrations/0121_document_workspace.sql supabase/migrations/0122_document_digest_search_path.sql supabase/tests/0121_document_workspace.sql server/src/main.rs server/Cargo.toml server/Cargo.lock bridge/src/vokoo/intelligence.rs bridge/src/bin/vokoo_bridge.rs bridge/Cargo.toml bridge/Cargo.lock src/lib/document-workspace.ts src/lib/document-workspace.test.ts src/utils/api-client.ts src/components/application/screens/documents-screen.tsx 'src/app/(console)/[...screen]/page.tsx' src/components/application/app-navigation/vokoo-nav.ts package.json
git commit -m "feat: add versioned document workspace"
```

Expected: unrelated untracked bridge files and auth edits are absent from the commit.

---

### Task 2: Add pgvector Runtime and Indexing Schema

**Files:**
- Create: `deploy/postgres/verify-vector.sh`
- Create: `supabase/migrations/0123_document_indexing.sql`
- Test: `supabase/tests/0123_document_indexing.sql`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: `files`, `file_versions`, `catalogue_providers`, organizations, and `is_org_member(uuid)`.
- Produces: `embedding_profiles`, `document_chunks`, `document_chunk_embeddings`, `document_ingestion_jobs`, `create_document_version`, `enqueue_document_ingestion`, `claim_document_ingestion`, `complete_document_ingestion`, and `fail_document_ingestion`.

- [x] **Step 1: Verify the bundled pgvector preflight**

Create `deploy/postgres/verify-vector.sh`:

```sh
#!/bin/sh
set -eu
available="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from pg_available_extensions where name='vector')"
test "$available" = "1"
printf '%s\n' vector-ready
```

Run it against the current VPS image. Expected and observed: `vector-ready`. A diagnostic query reports available version `0.8.2` and installed version `NULL`, so no image replacement is required.

- [x] **Step 2: Write the failing indexing SQL test**

Create `supabase/tests/0123_document_indexing.sql` as a transaction. Use the repository's existing `DO`-block assertion style so the test does not depend on pgTAP:

```sql
begin;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception 'vector extension is missing';
  end if;
  if to_regclass('public.embedding_profiles') is null
     or to_regclass('public.document_chunks') is null
     or to_regclass('public.document_chunk_embeddings') is null
     or to_regclass('public.document_ingestion_jobs') is null then
    raise exception 'document indexing tables are missing';
  end if;
end $$;
rollback;
```

Add behavioral `DO` blocks that create two organizations and prove: cross-org chunk references fail; one nonterminal job exists per `(file_version_id, chunker_version, embedding_profile_id)`; two workers cannot claim the same lease; an expired lease is reclaimable; incomplete jobs cannot set a version indexed; and a stale version cannot update `files.intelligence`.

Run before the migration. Expected: failure on the missing extension/tables/functions.

- [x] **Step 3: Implement the additive schema and RPCs**

Create `0123_document_indexing.sql` with these enforced values:

```sql
create extension if not exists vector with schema extensions;

insert into public.embedding_profiles
  (id, provider_id, provider_model_id, dimensions, distance_metric,
   document_task_type, query_task_type, is_active)
values
  ('gemini-embedding-2-768', 'gemini', 'gemini-embedding-2', 768,
   'cosine', 'RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY', true);
```

Use `extensions.vector(768)`, `vector_cosine_ops`, `to_tsvector('simple', content)`, composite tenant foreign keys, and member RLS. Make job claim/completion/failure RPCs service-role-only. Replace `create_document` so version 1 is enqueued in the same transaction. `create_document_version` must lock the `files` row before allocating `current_version + 1`, and enqueue both active and pending organization profiles when a profile migration is in progress.

- [x] **Step 4: Run schema and transactional tests**

Run migration `0123`, then the SQL test with `ON_ERROR_STOP=1`. Expected: every structural and behavioral assertion passes, ending in rollback.

- [x] **Step 5: Document extension enablement and rollback**

In `deploy/README.md`, record the pinned image `supabase/postgres:17.6.1.136`, backup verification, `pg_available_extensions` preflight, extension creation, and schema rollback boundaries. No database container or volume replacement is required.

- [ ] **Step 6: Commit database runtime and schema**

```bash
git add deploy/postgres/verify-vector.sh deploy/README.md supabase/migrations/0123_document_indexing.sql supabase/tests/0123_document_indexing.sql docs/superpowers/specs/2026-09-07-document-indexing-and-semantic-retrieval-design.md docs/superpowers/plans/2026-09-07-document-indexing-and-semantic-retrieval.md
git commit -m "feat: add durable document indexing schema"
```

---

### Task 3: Extract and Chunk Documents Deterministically

**Files:**
- Create: `bridge/src/vokoo/documents/mod.rs`
- Create: `bridge/src/vokoo/documents/extract.rs`
- Create: `bridge/src/vokoo/documents/chunk.rs`
- Create: `bridge/tests/fixtures/documents/guideline.docx`
- Create: `bridge/tests/fixtures/documents/guideline.pdf`
- Create: `bridge/tests/document_pipeline.rs`
- Modify: `bridge/src/vokoo/mod.rs`
- Modify: `bridge/src/vokoo/intelligence.rs`

**Interfaces:**
- Produces: `extract_document(mime_type: &str, bytes: &[u8]) -> Result<ExtractedDocument, DocumentError>` and `chunk_document(document: &ExtractedDocument, config: &ChunkConfig) -> Vec<DocumentChunk>`.
- `ExtractedDocument` contains `text`, `pages`, and structural `blocks`; `DocumentChunk` contains ordinal, page range, section path, content, token count, and SHA-256.
- Consumes: `pdftotext`, `unzip`, and existing MIME validation.

- [x] **Step 1: Write failing extraction tests**

Start with these concrete tests, then apply the same assertions to the PDF and DOCX fixtures:

```rust
#[test]
fn text_pages_keep_physical_provenance() {
    let source = b"Scope\x0cRecommendation\nEscalate after 14 days.";
    let extracted = extract_document("text/plain", source).unwrap();
    assert_eq!(extracted.pages.len(), 2);
    assert_eq!(extracted.pages[1].physical_page, Some(2));
    assert!(extracted.pages[1].text.contains("Escalate after 14 days"));
}

#[test]
fn corrupt_docx_is_rejected() {
    assert!(extract_document(DOCX_MIME, b"not a zip").is_err());
}
```

The fixture assertions require DOCX headings, lists, and tables to become structural blocks, Markdown headings to populate `section_path`, PDF form feeds to map to physical pages, and staged temporary files to be absent after success and failure.

Run:

```bash
cargo test --manifest-path bridge/Cargo.toml documents::extract
```

Expected: compilation fails because the module and types do not exist.

- [x] **Step 2: Move extraction behind the focused interface**

Move the document extraction logic out of `intelligence.rs`. Define:

```rust
pub struct ExtractedDocument {
    pub text: String,
    pub pages: Vec<ExtractedPage>,
    pub blocks: Vec<StructuralBlock>,
}

pub fn extract_document(mime_type: &str, bytes: &[u8])
    -> Result<ExtractedDocument, DocumentError>;
```

Keep process arguments fixed by MIME type; never accept a caller-provided executable or flag.

- [x] **Step 3: Write failing chunker tests**

Use a repeated structural fixture and assert the public contract directly:

```rust
#[test]
fn clinical_chunks_are_bounded_deterministic_and_keep_recommendations_together() {
    assert_eq!(CHUNKER_VERSION, "clinical-structure-v1");
    let document = guideline_fixture();
    let first = chunk_document(&document, &ChunkConfig::default());
    let second = chunk_document(&document, &ChunkConfig::default());
    assert_eq!(first, second);
    assert!(first.iter().all(|chunk| chunk.token_count <= 1_200));
    let escalation = first.iter().find(|chunk| chunk.content.contains("Escalate")).unwrap();
    assert!(escalation.content.contains("If symptoms persist"));
    assert_eq!(escalation.page_start, Some(2));
}
```

The long fixture also asserts non-final chunks fall within 600–900 tokens, adjacent chunks share approximately 100 boundary tokens, ordinals are sequential, and hashes change when content changes.

- [x] **Step 4: Implement structure-aware chunking**

Define:

```rust
pub const CHUNKER_VERSION: &str = "clinical-structure-v1";

pub struct ChunkConfig {
    pub target_min_tokens: usize,
    pub target_max_tokens: usize,
    pub overlap_tokens: usize,
    pub hard_max_tokens: usize,
}
```

Default to `600`, `900`, `100`, and `1200`. Use deterministic conservative token counting and block-aware splitting. Never discard headings or page provenance.

- [x] **Step 5: Run focused and regression tests**

```bash
cargo test --manifest-path bridge/Cargo.toml documents::extract
cargo test --manifest-path bridge/Cargo.toml documents::chunk
cargo test --manifest-path bridge/Cargo.toml vokoo::intelligence
```

Expected: all pass.

- [ ] **Step 6: Commit extraction and chunking**

```bash
git add bridge/src/vokoo/documents bridge/src/vokoo/mod.rs bridge/src/vokoo/intelligence.rs bridge/tests/fixtures/documents
git commit -m "feat: extract and chunk document versions"
```

---

### Task 4: Implement Gemini Embeddings

**Files:**
- Create: `bridge/src/vokoo/documents/embedding.rs`
- Modify: `bridge/src/vokoo/documents/mod.rs`
- Modify: `bridge/Cargo.toml`
- Modify: `bridge/Cargo.lock`

**Interfaces:**
- Produces: async trait `Embedder`, `GeminiEmbedder::new(api_key, profile, base_url)`, `embed_documents(&[String])`, and `embed_query(&str)`.
- Consumes: `EmbeddingProfile { id, provider_model_id, dimensions, document_task_type, query_task_type }` and operator-resolved Gemini secret.

- [ ] **Step 1: Write failing payload and response tests**

Use a local Axum fake server. Assert document batches call:

```text
POST /v1beta/models/gemini-embedding-2:batchEmbedContents
x-goog-api-key: <resolved secret>
```

Every request carries `RETRIEVAL_DOCUMENT` and `outputDimensionality: 768`; query calls carry `RETRIEVAL_QUERY`. Tests also cover result ordering, a non-768 vector, missing embeddings, `429` with `Retry-After`, `401`, and `5xx`.

- [ ] **Step 2: Run the tests to prove the client is missing**

```bash
cargo test --manifest-path bridge/Cargo.toml documents::embedding
```

Expected: failure on unresolved embedding types/functions.

- [ ] **Step 3: Implement the provider interface and Gemini client**

Define:

```rust
#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed_documents(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError>;
    async fn embed_query(&self, query: &str) -> Result<Vec<f32>, EmbedError>;
}
```

Cap a synchronous API batch to 100 chunks and validate count, order, finite values, and exactly 768 dimensions before returning. Classify `429`, timeouts, and `5xx` as retryable; classify authentication, schema, and dimension failures as permanent.

- [ ] **Step 4: Run focused tests and formatting**

```bash
cargo test --manifest-path bridge/Cargo.toml documents::embedding
cargo fmt --manifest-path bridge/Cargo.toml -- --check
```

Expected: all embedding tests pass and formatting is clean.

- [ ] **Step 5: Commit the embedding boundary**

```bash
git add bridge/src/vokoo/documents/embedding.rs bridge/src/vokoo/documents/mod.rs bridge/Cargo.toml bridge/Cargo.lock
git commit -m "feat: embed document chunks with Gemini"
```

---

### Task 5: Build the Durable Document Worker

**Files:**
- Create: `bridge/src/vokoo/documents/jobs.rs`
- Create: `bridge/src/vokoo/documents/metrics.rs`
- Create: `bridge/src/vokoo/documents/worker.rs`
- Create: `bridge/src/bin/vokoo_document_worker.rs`
- Modify: `bridge/src/vokoo/documents/mod.rs`
- Modify: `bridge/src/vokoo/intelligence.rs`
- Modify: `bridge/Cargo.toml`
- Create: `deploy/vokoo-document-worker.service`
- Modify: `deploy/README.md`

**Interfaces:**
- Produces: `JobRepository`, `DocumentWorker::run_once() -> Result<RunOutcome, WorkerError>`, health endpoint `GET /health`, and internal endpoint `POST /documents/search` reserved for Task 7.
- Consumes: extraction/chunking, `Embedder`, service-role Supabase URL/key, internal token, and Workspace Intelligence routing.

- [ ] **Step 1: Write failing repository and worker tests**

Against fake PostgREST/Gemini servers, start with these orchestration assertions:

```rust
#[tokio::test]
async fn idle_worker_does_not_call_a_provider() {
    let harness = WorkerHarness::with_no_jobs().await;
    assert_eq!(harness.worker.run_once().await.unwrap(), RunOutcome::Idle);
    assert_eq!(harness.gemini_request_count(), 0);
}

#[tokio::test]
async fn retryable_embedding_failure_resumes_after_chunks() {
    let harness = WorkerHarness::with_job_and_gemini_status(429).await;
    assert!(matches!(harness.worker.run_once().await, Err(WorkerError::Retryable(_))));
    assert_eq!(harness.recorded_stage(), JobStage::RetryableFailed);
    assert!(harness.persisted_chunks() > 0);
    assert_eq!(harness.persisted_embeddings(), 0);
}
```

Complete the harness with explicit assertions for successful stage order, lease renewal, restart after extraction, restart after partial embedding, permanent corrupt-source failure, stale-version intelligence stored only on its version, and repeated completion producing no duplicates.

- [ ] **Step 2: Implement typed job repository calls**

Define `ClaimedJob`, `JobStage`, `JobFailure`, and repository methods `claim`, `renew_lease`, `store_extraction`, `upsert_chunks`, `upsert_embeddings`, `complete`, and `fail`. Every database request includes `org_id`, and state-changing RPC responses are checked rather than discarded.

- [ ] **Step 3: Implement `run_once` orchestration**

Process exactly one lease per call:

```rust
pub async fn run_once(&self) -> Result<RunOutcome, WorkerError> {
    let Some(job) = self.jobs.claim(&self.worker_id).await? else {
        return Ok(RunOutcome::Idle);
    };
    self.process(job).await
}
```

Persist each completed stage before starting the next. Resolve the Gemini key through `resolve_vendor_secret`; do not load it from a new environment variable.

- [ ] **Step 4: Change Workspace Intelligence to retrieved evidence input**

Replace the 160,000-character prefix contract with `DocumentEvidence { outline, representative_chunks, compiler_matches }`. Preserve the forced `route_document` tool and registered compiler allowlist. Persist page, section, chunk id, and version with every cited evidence item.

- [ ] **Step 5: Add the worker binary and unit**

The binary loads the existing Supabase service settings and `VOKOO_INTERNAL_TOKEN`, polls one job at a time, exposes health on `127.0.0.1:8082`, and shuts down on SIGTERM. The systemd unit uses `Restart=always`, a five-second restart delay, `Nice=10`, and no more than one worker process.

- [ ] **Step 6: Add source-safe metrics**

Expose counters/gauges for queued and leased work, stage duration, extracted page/character totals, chunk/embedding counts, Gemini latency/retries, permanent error codes, and retrieval latency/candidate totals. Metric labels may contain provider, model, stage, and error code. A focused test scans rendered metric labels and rejects document ids, names, source text, and chunk text.

- [ ] **Step 7: Run worker and intelligence tests**

```bash
cargo test --manifest-path bridge/Cargo.toml documents::jobs
cargo test --manifest-path bridge/Cargo.toml documents::worker
cargo test --manifest-path bridge/Cargo.toml vokoo::intelligence
cargo build --release --manifest-path bridge/Cargo.toml --bin vokoo_document_worker
```

Expected: tests pass and the release worker builds.

- [ ] **Step 8: Commit the durable worker**

```bash
git add bridge/src/vokoo/documents bridge/src/vokoo/intelligence.rs bridge/src/bin/vokoo_document_worker.rs bridge/Cargo.toml bridge/Cargo.lock deploy/vokoo-document-worker.service deploy/README.md
git commit -m "feat: process document indexes durably"
```

---

### Task 6: Add Hybrid Retrieval and Profile Switching

**Files:**
- Create: `supabase/migrations/0124_document_retrieval.sql`
- Test: `supabase/tests/0124_document_retrieval.sql`
- Create: `bridge/src/vokoo/documents/search.rs`
- Modify: `bridge/src/vokoo/documents/mod.rs`
- Modify: `bridge/src/bin/vokoo_document_worker.rs`

**Interfaces:**
- Produces: `search_document_chunks` RPC; `embedding_profile_choices` RPC; `begin_embedding_profile_migration` RPC; internal `POST /documents/search`; `DocumentSearchRequest`, `DocumentSearchResult`, and `unavailable_current_documents` response metadata.
- Consumes: 768-value query embedding, authenticated org id from the control plane, current document filters or explicit `(document_id, version)` pairs.

- [ ] **Step 1: Write failing retrieval SQL tests**

Seed two organizations, two versions with contradictory passages, exact clinical identifiers, and deterministic test vectors. Assert current search returns only `files.current_version`; explicit history returns only the named version; another tenant returns nothing; incomplete embeddings return nothing; exact identifiers survive lexical rank; and reciprocal-rank fusion produces deterministic order.

- [ ] **Step 2: Implement current and historical retrieval RPCs**

Use cosine candidates (`embedding <=> p_query_embedding`) and `ts_rank_cd` lexical candidates, each capped before fusion. Combine with reciprocal rank:

```sql
coalesce(1.0 / (60 + semantic_rank), 0) +
coalesce(1.0 / (60 + lexical_rank), 0) as fused_score
```

Reject mixed conflicting filters, limit results to 1–50, and return all provenance and component scores. Explicit historical mode requires a nonempty list of document/version pairs. Return `unavailable_current_documents` as a separate count rather than silently falling back to old versions.

- [ ] **Step 3: Implement safe profile migration**

`embedding_profile_choices` returns active profiles without credentials. `begin_embedding_profile_migration` validates operator status and an active profile, sets `pending_embedding_profile_id`, and enqueues every current version. Completion locks the organization and flips profiles only when every current version has complete pending-profile embeddings.

- [ ] **Step 4: Run SQL tests**

Run `0124` and its transaction-scoped test with `ON_ERROR_STOP=1`. Expected: current, historical, tenant, hybrid, and profile-switch assertions all pass.

- [ ] **Step 5: Write failing Rust search tests**

Cover current filters, explicit historical filters, conflicting inputs, 768-dimension validation, Gemini query task type, internal-token rejection, RPC failures, and provenance decoding.

- [ ] **Step 6: Implement the internal search endpoint**

The worker resolves the active profile and Gemini key, embeds the query once, invokes `search_document_chunks`, and returns cited results. Require `x-vokoo-internal-token`; never accept caller-supplied org identity from a public socket.

- [ ] **Step 7: Run and commit retrieval**

```bash
cargo test --manifest-path bridge/Cargo.toml documents::search
git add supabase/migrations/0124_document_retrieval.sql supabase/tests/0124_document_retrieval.sql bridge/src/vokoo/documents/search.rs bridge/src/vokoo/documents/mod.rs bridge/src/bin/vokoo_document_worker.rs
git commit -m "feat: search versioned document chunks"
```

---

### Task 7: Expose Version, Processing, Job, and Search APIs

**Files:**
- Modify: `server/src/main.rs`
- Modify: `src/utils/api-client.ts`

**Interfaces:**
- Produces: version append/history, process/retry, job status, search, operator profile choices, and profile-migration APIs; existing analyze route returns the same queued-job shape.
- Consumes: authenticated `x-org-id`, database RPCs, `DOCUMENT_WORKER_URL=http://127.0.0.1:8082`, and `VOKOO_INTERNAL_TOKEN`.

- [ ] **Step 1: Write failing control-plane tests**

Add pure validation tests for document/version ids, current versus explicit history filters, query length 1–2,000, result limit 1–50, supported MIME types, and the 15 MiB decoded upload bound. Add handler tests with fake upstreams proving the authenticated organization overrides any body value and internal errors do not expose provider responses containing source text.

- [ ] **Step 2: Implement request and response types**

Add `CreateDocumentVersionRequest`, `ProcessDocumentResponse`, `DocumentJobResponse`, `DocumentSearchRequest`, `HistoricalVersionFilter`, and `DocumentSearchResult`. Reject `document_ids` and `versions` when they conflict for the same document.

- [ ] **Step 3: Implement routes**

Add:

```text
POST /api/v1/documents/{id}/versions
GET  /api/v1/documents/{id}/versions
POST /api/v1/documents/{id}/versions/{version}/process
GET  /api/v1/document-jobs/{id}
POST /api/v1/documents/search
GET  /api/v1/operator/embedding-profiles
POST /api/v1/operator/tenants/{id}/embedding-profile
```

The search route forwards only the authenticated org id and validated filters to the internal worker. The two embedding-profile routes call the operator-guarded database RPCs and never return credentials. Give upload routes a 21 MiB JSON body cap for 15 MiB base64 sources.

- [ ] **Step 4: Convert the analyze compatibility route**

`POST /api/v1/documents/{id}/analyze` calls the same enqueue helper as `process` and returns `202 Accepted` with a job resource. Remove its direct 120-second reasoning request.

- [ ] **Step 5: Add typed browser API methods**

In `api-client.ts`, add `uploadDocumentVersion`, `listDocumentVersions`, `processDocumentVersion`, `getDocumentJob`, and `searchDocuments`. Keep organization and bearer headers in the shared `request` function.

- [ ] **Step 6: Verify and commit APIs**

```bash
cargo test --manifest-path server/Cargo.toml
cargo fmt --manifest-path server/Cargo.toml -- --check
npx tsc --noEmit
git add server/src/main.rs src/utils/api-client.ts
git commit -m "feat: expose document indexing APIs"
```

---

### Task 8: Add Version and Processing UX

**Files:**
- Modify: `src/lib/document-workspace.ts`
- Test: `src/lib/document-workspace.test.ts`
- Modify: `src/components/application/screens/documents-screen.tsx`
- Modify: `src/components/application/screens/tenant-detail-screen.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: version selection/history, upload replacement, process/retry polling, evidence rendering, and operator embedding-profile selection.
- Consumes: Task 7 API client methods and the existing `useResource`/notification/dialog components.

- [ ] **Step 1: Write failing UI-domain tests**

Test `selectDocumentVersion`, `documentProcessingLabel`, `shouldPollDocumentJob`, `validateHistoricalSearch`, and `normalizeDocumentEvidence`. Include stale selected versions, terminal versus retryable jobs, missing page numbers, conflicting search filters, and unknown compiler ids.

- [ ] **Step 2: Run the tests to prove helpers are missing**

```bash
node --import tsx --test src/lib/document-workspace.test.ts
```

Expected: failure on missing helpers/types.

- [ ] **Step 3: Implement types and pure helpers**

Add `DocumentVersion`, `DocumentJob`, `DocumentEvidence`, `DocumentSearchRequest`, and state helpers. Keep unknown compiler recommendations filtered at the client boundary.

- [ ] **Step 4: Implement Documents-pane states**

Add a version menu, “Upload new version,” current/historical labeling, queued/extracting/chunking/embedding/classifying progress, retryable/permanent failure messages, retry action, and cited evidence with version/page/section. Poll only nonterminal jobs and stop polling after unmount or terminal state.

- [ ] **Step 5: Implement operator embedding profile selection**

Load catalogue profiles through an operator endpoint backed by the migration RPC. Show active and pending profiles. Saving a different profile starts the controlled backfill and explains that active search remains on the prior profile until completion. Never render credential material.

- [ ] **Step 6: Run accessibility-oriented component checks and builds**

```bash
npm run test:flows
npx tsc --noEmit
npm run build
```

Expected: tests/typecheck/build pass; dialogs and progress regions have accessible names and live status does not trap focus.

- [ ] **Step 7: Commit the UI**

```bash
git add src/lib/document-workspace.ts src/lib/document-workspace.test.ts src/components/application/screens/documents-screen.tsx src/components/application/screens/tenant-detail-screen.tsx package.json
git commit -m "feat: manage document versions and indexing"
```

---

### Task 9: Full Verification and VPS Deployment

**Files:**
- Modify only if verification exposes an in-scope defect.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified local build, migrated VPS, healthy services, and signed-in UI evidence using synthetic documents.

- [ ] **Step 1: Run the complete local verification matrix**

```bash
git diff --check
npm test
npx tsc --noEmit
npm run schemas:check
npm run tools:check
npm run catalogue:check
npm run build
cargo test --manifest-path server/Cargo.toml
cargo test --manifest-path bridge/Cargo.toml
cargo build --release --manifest-path bridge/Cargo.toml --bin vokoo_document_worker
```

Expected: every command exits zero. Record pre-existing warnings separately from failures.

- [ ] **Step 2: Back up and preflight the VPS database**

Follow `deploy/README.md`: verify a fresh backup and run the pgvector preflight against the existing pinned database image. No database container or volume replacement is required.

- [ ] **Step 3: Apply and test migrations**

Apply `0123` and `0124` with `ON_ERROR_STOP=1`. Run both SQL tests in transactions. Verify `vector` version `0.8.2`, RLS enabled, HNSW/GIN indexes present, and PostgREST schema reload complete.

- [ ] **Step 4: Deploy backend services with the worker disabled**

Sync explicit changed server/bridge/deploy files, build release binaries on the VPS, install/reload the systemd unit, restart control plane and existing bridge, and health-check them. Do not enable the worker until schema checks pass.

- [ ] **Step 5: Enable and health-check one worker**

Start `vokoo-document-worker`, verify `/health`, one-process concurrency, Gemini credential resolution, and an empty/settled queue.

- [ ] **Step 6: Deploy the console**

```bash
bash deploy/console.sh vokoo
```

Expected: production build succeeds and `vokoo-console` is active.

- [ ] **Step 7: Run synthetic end-to-end verification**

Through the signed-in UI, upload a synthetic two-page guideline, wait for indexing, search with a paraphrase and an exact clinical token, and verify cited current-version results. Upload a contradictory version 2, verify default search returns only version 2, explicitly select version 1 and verify its historical result, then run Workspace Intelligence and confirm only a recommendation is produced.

- [ ] **Step 8: Clean synthetic data and inspect logs**

Delete the synthetic logical document through its scoped database/API path so cascade removes versions, chunks, embeddings, and jobs. Inspect worker, control-plane, bridge, and console logs for errors and verify no source passage was logged.

- [ ] **Step 9: Commit any verification-only fixes and push**

Stage only named in-scope files, commit with a focused message, push `console-and-canvas`, and report the exact commit ids, migration versions, service health, browser checks, and any remaining unverified behavior.
