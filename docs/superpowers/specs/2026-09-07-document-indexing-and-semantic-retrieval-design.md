# Document Indexing and Semantic Retrieval

**Date:** 2026-09-07

**Status:** Approved in conversation; written specification ready for final review
**Scope:** Immutable document versions, structure-aware chunks, Gemini embeddings, PostgreSQL semantic retrieval, and Workspace Intelligence integration

## Context

The Documents workspace already establishes the first boundary:

- `files` is the logical document shown in the library.
- `file_versions` holds immutable source bytes and version-specific extracted text and intelligence.
- the control plane authenticates the tenant and the Rust bridge performs provider-facing Workspace Intelligence work.
- Workspace Intelligence recommends registered compilers; it does not execute them.

The current inspection path still sends a bounded prefix of the extracted document directly to a reasoning model. That is insufficient for long clinical guidelines: relevant recommendations may occur outside the prefix, citations are not retrieval-backed, and the extracted source cannot be searched semantically by the compiler supervisor.

This design adds a durable indexing pipeline and tenant-scoped retrieval without moving document ownership or provider credentials into the browser.

## Goals

1. Preserve every uploaded source version and all provenance needed to audit an answer or compiled artifact.
2. Extract and chunk long documents without separating clinical recommendations from their conditions, timing, rationale, or escalation criteria.
3. Generate embeddings through the operator-managed Gemini credential.
4. Store and query vectors in the existing PostgreSQL/Supabase boundary with `pgvector`.
5. Search current document versions by default and historical versions only when a caller explicitly requests them.
6. Give Workspace Intelligence and future compiler agents a bounded, cited evidence set rather than an arbitrary document prefix.
7. Keep document processing away from latency-sensitive call execution.

## Non-goals

- This work does not compile a document into flows or agents.
- It does not automatically invoke a recommended compiler.
- It does not add a second credential store or expose provider keys to tenant users.
- It does not provide patient-record search or relax any tenant boundary.
- It does not use Gemini File Search as the system of record; PostgreSQL remains authoritative.
- It does not make arbitrary embedding models user-selectable in the tenant console.

## Decisions

### PostgreSQL owns versions, chunks, jobs, and vectors

PostgreSQL is already the authoritative tenant store. `pgvector` adds similarity search without creating a second authorization or consistency boundary. Exact-term search remains in PostgreSQL as a generated full-text vector, enabling hybrid retrieval for medicine names, measurements, abbreviations, and clinical codes.

The VPS PostgreSQL image does not currently expose the `vector` extension. Deployment must first produce a version-pinned Supabase PostgreSQL image containing a compatible `pgvector`, then run `create extension vector with schema extensions`. Migration preflight must fail before schema changes if the extension is unavailable.

### Gemini generates embeddings through the existing operator credential boundary

The initial embedding profile is:

| Property | Value |
|---|---|
| Provider | `gemini` |
| Provider model | `gemini-embedding-2` |
| Dimensions | `768` |
| Distance | cosine |
| Document task | `RETRIEVAL_DOCUMENT` |
| Query task | `RETRIEVAL_QUERY` |

The operator portal already owns platform provider credentials. The worker resolves the `gemini` key through the existing service-role-only `resolve_vendor_secret` path. No new key column, environment variable, or tenant-facing credential control is introduced.

Embedding configuration is separate from `organizations.intelligence_provider` and `intelligence_model`. The latter select the reasoning model used by Workspace Intelligence. A reasoning-model change must not invalidate stored vectors.

### Processing runs in a dedicated worker

A `vokoo-document-worker` binary claims durable database jobs and performs extraction, chunking, embedding, and classification. It shares focused library modules with the bridge but is a separate process and systemd service. One job runs at a time initially. This prevents PDF extraction, network batching, and retries from blocking calls or ordinary control-plane requests.

## Data Model

### Existing tables

`files` remains the logical document. `current_version` identifies the version used by ordinary search and Workspace Intelligence.

`file_versions` remains append-only for source data. It gains processing projections needed by the UI:

- `active_chunker_version text null`
- `active_embedding_profile text null`
- `indexed_at timestamptz null`
- `processing_error jsonb null`

`status` continues to be the compact UI state. Detailed stages live on the ingestion job.

### `embedding_profiles`

A global, operator-controlled catalogue of valid combinations:

- `id text primary key`
- `provider_id text` referencing `catalogue_providers`
- `provider_model_id text`
- `dimensions integer`
- `distance_metric text`
- `document_task_type text`
- `query_task_type text`
- `is_active boolean`
- `created_at timestamptz`

The initial row is `gemini-embedding-2-768`. Profile rows are immutable once referenced. A model or dimensionality change creates a new profile rather than editing the old one.

`organizations.embedding_profile_id` references the active catalogue profile and defaults to the initial profile. `organizations.pending_embedding_profile_id` is normally null and records a profile being backfilled. The operator tenant-settings screen displays and validates these profiles. It never displays the credential.

### `document_chunks`

Each row is derived from one immutable source version:

- `id uuid primary key`
- `org_id uuid`
- `file_id uuid`
- `file_version_id uuid`
- `chunker_version text`
- `ordinal integer`
- `page_start integer null`
- `page_end integer null`
- `section_path text[]`
- `content text`
- `token_count integer`
- `content_sha256 text`
- `search_vector tsvector` generated from `content`
- `created_at timestamptz`

Foreign keys include `org_id` in their identity so a chunk cannot refer across tenants. `(file_version_id, chunker_version, ordinal)` is unique. Chunks are immutable within a chunker version.

### `document_chunk_embeddings`

Embedding storage is separate so an existing chunk can be embedded under a new profile without repeating extraction:

- `id uuid primary key`
- `org_id uuid`
- `chunk_id uuid`
- `embedding_profile_id text`
- `embedding extensions.vector(768)`
- `created_at timestamptz`

`(chunk_id, embedding_profile_id)` is unique. The profile constraint ensures this table only accepts 768-dimensional profiles. A future profile with a different storage dimension requires an explicit schema migration rather than silently mixing incompatible vectors.

An HNSW index uses `vector_cosine_ops`. A GIN index covers `document_chunks.search_vector`. Both queries apply tenant and version filters in SQL.

### `document_ingestion_jobs`

One durable, idempotent indexing attempt is identified by source version, chunker version, and embedding profile:

- `id uuid primary key`
- `org_id uuid`
- `file_id uuid`
- `file_version_id uuid`
- `chunker_version text`
- `embedding_profile_id text`
- `stage text`
- `attempt_count integer`
- `available_at timestamptz`
- `lease_owner text null`
- `lease_expires_at timestamptz null`
- `last_error_code text null`
- `last_error_detail text null`
- `created_at`, `started_at`, `completed_at`, `updated_at`

Stages are `queued`, `extracting`, `chunking`, `embedding`, `classifying`, `ready`, `retryable_failed`, and `permanent_failed`.

Only one nonterminal job may exist for the same source/profile/chunker tuple. The worker claims work through a service-role RPC using `FOR UPDATE SKIP LOCKED`, assigns a lease, and increments the attempt count. Expired leases become claimable. Transient provider, timeout, and rate-limit failures retry with bounded exponential backoff. Unsupported or corrupt input becomes a permanent failure.

## Version Semantics

Uploading a replacement calls a transactional `create_document_version` RPC. It locks the `files` row, verifies tenant membership, allocates `current_version + 1`, stores the immutable bytes and hash, advances the current pointer, clears the logical document's prior intelligence projection, and enqueues indexing.

Ordinary retrieval joins `files.current_version` to `file_versions.version`. This prevents duplicate or contradictory passages from old versions entering results.

Historical retrieval is permitted only when the request names both a document and an explicit version. “All historical versions” is not an ordinary search mode.

Intelligence is always stored on the analyzed `file_versions` row. It is copied to `files.intelligence` only when that version is still current. A delayed result for version 1 therefore cannot overwrite version 2.

Repeated content hashes do not destroy history. The API may report that the source matches an earlier version, but an explicitly requested upload still creates a distinct immutable version.

Changing an organization's embedding profile is a controlled re-index operation. The operator action sets `pending_embedding_profile_id` and enqueues every current document version under that profile. The old profile remains active for search until every current document version has embeddings under the pending profile. The final completion transaction locks the organization, verifies the complete current-version set again, copies the pending profile to `embedding_profile_id`, and clears the pending field. A version uploaded during a backfill is enqueued for both the active and pending profiles, so it cannot be omitted from the final readiness check. Old embeddings remain available for audit until a separate retention policy removes them.

## Extraction and Chunking

Extraction retains physical page boundaries where the source format provides them:

- PDF uses `pdftotext` and form-feed page separation.
- DOCX extraction preserves paragraphs, headings, lists, and tables from document XML.
- plain text and Markdown preserve headings and paragraph boundaries.

The first chunker version is `clinical-structure-v1`. It builds structural blocks before applying token limits:

1. Detect page, heading, paragraph, list, table, and recommendation-like blocks.
2. Keep a heading with the content it introduces.
3. Keep a recommendation with adjacent conditions, timing, rationale, contraindications, and escalation text where possible.
4. Combine blocks toward 600–900 tokens.
5. Add approximately 100 tokens of boundary overlap.
6. Split only pathological blocks above 1,200 tokens, preserving their page and section provenance.

Token counts use the embedding model's tokenizer or a conservative compatible tokenizer. The original extracted text remains on `file_versions`; chunks are a reproducible derived representation stamped with the chunker version.

## Ingestion Flow

```text
upload immutable version
        |
        v
enqueue durable job
        |
        v
extract -> chunk -> batch embed -> classify
        |                            |
        +------ retry by stage ------+
                                     |
                                     v
                     atomically mark version ready
```

The upload endpoint returns after the transaction commits. The console polls job status. A retry resumes from persisted completed work: extraction is reused when present, chunks upsert by deterministic ordinal and hash, and embeddings upsert by chunk/profile.

Gemini embedding requests are batched within documented request limits. Provider `429` and `5xx` responses are retryable; authentication and invalid-request responses are permanent until an operator changes configuration and explicitly retries. Source text and chunk text are never written to application logs.

Classification runs only after the index is complete. It receives document metadata, a structural outline, diversified representative chunks, and compiler-specific retrieved evidence. The first registered compiler remains `care_path`. Classification records recommendations and evidence but does not execute a compiler.

## Retrieval

### Endpoint

`POST /api/v1/documents/search`

Request:

```json
{
  "query": "When should treatment be escalated?",
  "document_ids": ["optional-document-id"],
  "versions": [{ "document_id": "required-with-history", "version": 2 }],
  "limit": 12
}
```

`document_ids` means current versions. `versions` is the only historical mode. The two filters cannot name conflicting versions of the same document. Limits are bounded server-side.

The control plane authenticates the user and tenant, then asks the document service to embed the query using the organization's active embedding profile. PostgreSQL RPCs apply the same `org_id` and membership constraints before ranking.

### Ranking

The search RPC obtains two candidate lists:

1. cosine similarity over the HNSW vector index;
2. PostgreSQL full-text rank over the GIN index.

Reciprocal-rank fusion combines the lists. It does not compare provider-specific raw score scales. A minimum semantic threshold removes unrelated vector results; lexical-only results can still survive for exact clinical identifiers. Initial thresholds are constants covered by retrieval fixtures and may later become operator-tuned configuration.

Each result returns:

- document id and name;
- version and chunk id;
- page range and section path;
- chunk text;
- semantic, lexical, and fused scores;
- embedding profile and chunker version.

Consumers must carry this provenance into summaries, recommendations, and compiler evidence.

## API and UI Changes

The control plane exposes:

- `POST /api/v1/documents`
- `POST /api/v1/documents/{id}/versions`
- `GET /api/v1/documents/{id}/versions`
- `POST /api/v1/documents/{id}/versions/{version}/process`
- `GET /api/v1/document-jobs/{id}`
- `POST /api/v1/documents/search`

The current synchronous analyze endpoint becomes a compatibility wrapper that enqueues processing and returns a job. New clients use the process route directly.

The Documents pane adds version history and explicit processing states. “Review with Workspace Intelligence” starts or retries a job. The right pane shows extraction/index/classification progress, the active version, and cited recommendations. It does not add a compiler execution button in this phase.

The operator tenant screen adds the embedding profile beside Workspace Intelligence settings. The choices come from `embedding_profiles`; arbitrary provider/model strings are rejected in PostgreSQL as well as the UI.

## Authorization and Data Handling

- RLS covers versions, chunks, embeddings, and jobs using organization membership.
- Composite foreign keys prevent cross-organization references even under service-role writes.
- Claim, completion, and search RPCs expose only the minimum role required; internal job claims remain service-role-only.
- The browser never receives raw vectors or a provider key.
- Embeddings are treated as sensitive derived document data and follow source deletion and retention.
- Provider calls use the operator-managed platform Gemini key resolved at runtime.
- Logs contain ids, stages, durations, token/chunk counts, and error codes, never source passages.

## Failure and Consistency Rules

- No partial job becomes searchable. `file_versions.active_chunker_version`, `active_embedding_profile`, and `indexed_at` are updated together only after every required chunk has an embedding.
- A new source version may become current while its index is pending. During that interval the document is visibly processing and is excluded from ordinary semantic results; search never silently falls back to an obsolete source version.
- A failed current version remains visible with its failure state and retry action.
- A deleted logical document cascades to versions, chunks, embeddings, and jobs.
- Job completion is idempotent. Replaying a completion cannot duplicate chunks or embeddings.
- Provider profile mismatch, wrong vector dimensionality, and stale-version projection are database-enforced errors.

## Observability

The document worker exports:

- queued and leased job counts;
- stage duration;
- extraction pages and characters;
- chunk and embedding counts;
- Gemini request latency and retry counts;
- permanent failures by error code;
- retrieval latency and candidate counts.

Health checks report database access, `pgvector` availability, worker lease activity, embedding profile validity, and whether the Gemini platform credential resolves. They do not make a billable provider call.

## Deployment and Migration

1. Build and pin a Supabase PostgreSQL image with a compatible `pgvector` extension.
2. Back up the database and verify the restore procedure.
3. Deploy the database image without changing the data volume.
4. Verify `pg_available_extensions`, then enable `vector` in the `extensions` schema.
5. Apply additive schema, RLS, catalogue, RPC, and index migrations.
6. Deploy the control plane and `vokoo-document-worker` with the worker disabled.
7. Run schema and authenticated tenant-boundary tests.
8. Enable one worker with concurrency one.
9. Enqueue existing analyzed document versions for indexing.
10. Verify retrieval and Workspace Intelligence on a synthetic non-patient document.
11. Deploy the Documents and operator UI changes.

The migration is additive. Existing extracted text and intelligence remain valid while indexing catches up. Search returns only indexed documents and states how many current documents remain unavailable.

## Testing

### Database

- version allocation remains monotonic under concurrent uploads;
- source versions cannot be updated or cross-linked between tenants;
- job claiming is exclusive and expired leases are recoverable;
- incomplete jobs are not searchable;
- current-version search excludes historical chunks;
- explicit historical search returns only the named version;
- stale intelligence cannot overwrite the logical document projection;
- vector dimensionality and embedding-profile mismatches fail;
- RLS and RPC tests prove tenant isolation.

### Rust

- extraction fixtures cover PDF, DOCX, text, malformed input, and page boundaries;
- chunking fixtures preserve headings, lists, tables, recommendations, and overlap;
- Gemini request tests cover task types, batches, normalization, rate limits, and malformed responses;
- worker tests cover leases, retries, idempotency, and stage resume;
- hybrid ranking fixtures cover semantic paraphrases and exact clinical terms;
- classification tests prove that only registered compilers are recommended.

### Control plane and console

- upload and replacement validation;
- version history and state transitions;
- search filter validation and bounded result limits;
- operator embedding-profile validation;
- accessible progress, failure, retry, and evidence states;
- signed-in browser test from upload through indexed recommendation.

### Deployment verification

- `pgvector` extension and indexes exist on the VPS;
- worker health is green and concurrency is one;
- a synthetic guideline can be uploaded, indexed, semantically searched with a paraphrase, and classified with page-backed evidence;
- an explicit historical query differentiates two conflicting synthetic versions;
- no live call or patient data is used for verification.

## Acceptance Criteria

The phase is complete when:

1. A document can have multiple immutable source versions from the UI.
2. Each current version is durably extracted, structurally chunked, and embedded with the operator-managed Gemini key.
3. Semantic and exact-term retrieval return tenant-scoped, cited chunks from current versions by default.
4. Historical results appear only under an explicit document/version request.
5. Workspace Intelligence classifies from retrieved evidence and never automatically invokes a compiler.
6. Processing survives worker restarts and exposes actionable failure states.
7. Operator configuration selects a valid embedding profile without exposing its key.
8. Database, Rust, TypeScript, production build, VPS health, and signed-in browser checks pass using synthetic data.
