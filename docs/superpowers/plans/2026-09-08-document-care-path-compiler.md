# Document Care-Path Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile the uploaded, immutable NG28 document version into cited draft care-path flows and draft agents, with durable structured trace, gaps, provenance, validation, and no publication or execution.

**Architecture:** The existing document worker claims durable compiler runs. An AISDK supervisor and evidence workers emit typed recommendation IR; deterministic Rust resolves that IR against a frozen catalogue and validates it. One service-role PostgreSQL function transactionally creates the draft agents, draft flows, evidence links, gaps, and final run state.

**Tech Stack:** PostgreSQL 17/Supabase RLS and RPCs, Rust/Tokio/AISDK/serde/reqwest, Axum control plane, Next.js 16/React/TypeScript, existing document extraction/layout/retrieval pipeline.

**Spec:** `docs/superpowers/specs/2026-09-06-care-path-compiler-design.md`

## Global Constraints

- Compile one immutable `file_version` and its frozen active extraction; never follow a later current version.
- Emit only active registered catalogue components in the `care_path` family; do not expose the operator-only provisioning template table to tenant runs.
- Create only draft flows and draft agents; never publish, enrol, or execute them.
- Store structured decisions and tool results, never hidden chain-of-thought.
- Resolve workspace intelligence credentials through the existing service-role Vault boundary.
- Every clinical claim in generated artifacts must link to a stored chunk from the compiled version.
- Unsupported intent becomes a first-class gap, never an approximate component.
- Materialization is one transaction and is idempotent per compiler run.
- Compiler-created outreach `declined`, `expired`, and `failed` paths reach `escalate.notify`.
- Preserve unrelated `docs/defects.md` and the existing untracked `bridge/` files.
- Recheck the highest migration number immediately before creating `0127`; if another committed migration occupies it, renumber this plan's three migrations together without reordering them.

## File Structure

- `supabase/migrations/0127_compiler_runs.sql` — run/step/gap ledger, RLS, queue, lease, cancellation, and state transitions.
- `supabase/tests/0127_compiler_runs.sql` — tenant, immutable-input, lease, transition, append-only, and cancellation behavior.
- `supabase/migrations/0128_compiler_artifacts.sql` — artifact/evidence relations and atomic materialization RPC.
- `supabase/tests/0128_compiler_artifacts.sql` — all-or-nothing draft creation, provenance, citations, deletion, and retry behavior.
- `supabase/migrations/0129_compiled_flow_validation.sql` — catalogue, graph, cycle, terminal, and compiled clinical-path validation.
- `supabase/tests/0129_compiled_flow_validation.sql` — valid and invalid care-path graph fixtures.
- `bridge/src/vokoo/compiler/types.rs` — typed run inputs, recommendation IR, drafts, gaps, steps, and materialization payload.
- `bridge/src/vokoo/compiler/lower.rs` — deterministic IR-to-agent/flow lowering.
- `bridge/src/vokoo/compiler/validate.rs` — Rust-side catalogue, provenance, graph, and clinical-path checks.
- `bridge/src/vokoo/compiler/model.rs` — AISDK provider boundary and forced-tool calls.
- `bridge/src/vokoo/compiler/harness.rs` — supervisor, bounded evidence workers, reconciliation, and trace events.
- `bridge/src/vokoo/compiler/repository.rs` — service-role PostgREST compiler RPC adapter.
- `bridge/src/vokoo/compiler/worker.rs` — claim/process/fail orchestration with resumable steps.
- `bridge/src/vokoo/compiler/mod.rs` — public compiler interface.
- `bridge/tests/compiler_core.rs` — deterministic lowering and validation tests.
- `bridge/tests/compiler_harness.rs` — fake-model supervisor/worker orchestration tests.
- `bridge/tests/compiler_worker.rs` — fake-PostgREST lifecycle and idempotency tests.
- `bridge/src/bin/vokoo_document_worker.rs` — poll ingestion and compiler jobs in the existing off-call worker.
- `server/src/main.rs` — authenticated start/status/cancel compiler endpoints and internal worker forwarding where required.
- `src/lib/document-workspace.ts` — compiler run, step, gap, artifact, and evidence UI contracts.
- `src/lib/document-workspace.test.ts` — normalization and polling tests.
- `src/components/application/screens/documents-screen.tsx` — compile action, progress, report, artifact links, and evidence selection.
- `docs/benchmarks/ng28-care-path-compiler.md` — measured NG28 acceptance evidence.
- `deploy/README.md` — compiler worker configuration, migration, rollback, and verification commands.

---

### Task 1: Add the Durable Compiler Run Ledger

**Files:**
- Create: `supabase/migrations/0127_compiler_runs.sql`
- Create: `supabase/tests/0127_compiler_runs.sql`

**Interfaces:**
- Consumes: `organizations`, `files`, `file_versions`, `document_extractions`, `is_org_member(uuid)`, and the existing authenticated/service-role roles.
- Produces: `compiler_runs`, `compiler_steps`, `compiler_gaps`, `enqueue_compiler_run(p_file_version_id uuid,p_compiler_id text,p_compiler_version text,p_prompt_version text)`, `claim_compiler_run(p_worker text,p_lease_seconds integer)`, `renew_compiler_run_lease(p_run_id uuid,p_worker text,p_lease_seconds integer)`, `append_compiler_step(p_run_id uuid,p_worker text,p_step jsonb)`, `advance_compiler_run(p_run_id uuid,p_worker text,p_status text)`, `fail_compiler_run(p_run_id uuid,p_worker text,p_code text,p_detail text,p_retryable boolean)`, and `cancel_compiler_run(p_run_id uuid)`.

- [x] **Step 1: Recheck migration ordering and write the failing SQL test**

Run `ls supabase/migrations | tail -5`. Expected before creation: `0126_document_layout_read.sql` is highest. Create a transactional test that seeds two organizations, one indexed version with an active extraction, and asserts the new tables and functions exist:

```sql
\set ON_ERROR_STOP on
begin;
do $$
begin
  if to_regclass('public.compiler_runs') is null
     or to_regclass('public.compiler_steps') is null
     or to_regclass('public.compiler_gaps') is null then
    raise exception 'compiler ledger is missing';
  end if;
end;
$$;
rollback;
```

- [x] **Step 2: Run the test before the migration**

Run the test with the same VPS `psql -v ON_ERROR_STOP=1` mechanism documented in `deploy/README.md`. Expected: failure `compiler ledger is missing`.

- [x] **Step 3: Implement tables, constraints, and RLS**

Create `compiler_runs` with frozen input IDs, provider/model/version fields, catalogue digest, `input_snapshot jsonb`, status check, lease fields, coverage counters, errors, timestamps, and composite organization foreign keys. Add the active-run uniqueness boundary:

```sql
create unique index compiler_runs_one_active_version_idx
on public.compiler_runs (org_id, file_version_id, compiler_id, compiler_version)
where status in ('queued','planning','compiling','validating','materializing');
```

Create append-only `compiler_steps` with `(run_id, sequence)` uniqueness and `compiler_gaps` with unique `(run_id, code, recommendation_id)`. Enable RLS on all three. Members may select their organization rows; direct authenticated insert/update/delete is denied.

- [x] **Step 4: Implement narrow state RPCs**

`enqueue_compiler_run` verifies membership, indexed status, active extraction, `care_path` recommendation, and SHA-256 catalogue digest before inserting. `claim_compiler_run` uses `FOR UPDATE SKIP LOCKED`, increments attempts, and leases exactly one run. `append_compiler_step` allocates `max(sequence)+1` while holding the run lock. State functions reject an invalid predecessor and a wrong lease owner.

- [x] **Step 5: Complete behavioral SQL assertions**

Assert: another tenant cannot enqueue/read the run; source/extraction IDs are frozen; duplicate active enqueue returns the existing run; two workers cannot claim one lease; expired leases are reclaimable; step sequence is monotonic; authenticated users cannot rewrite steps; cancellation works before `materializing` and is rejected during it; retryable failure requeues within `max_attempts`; permanent failure is terminal.

- [x] **Step 6: Apply migration and run the ledger test**

Run `0127_compiler_runs.sql`, reload PostgREST schema, then run `0127_compiler_runs.sql` test with `ON_ERROR_STOP=1`. Expected: all assertions pass and the test rolls back.

- [x] **Step 7: Commit the ledger**

```bash
git add supabase/migrations/0127_compiler_runs.sql supabase/tests/0127_compiler_runs.sql
git commit -m "feat: add durable compiler run ledger"
```

---

### Task 2: Materialize Drafts with Durable Provenance

**Files:**
- Create: `supabase/migrations/0128_compiler_artifacts.sql`
- Create: `supabase/tests/0128_compiler_artifacts.sql`

**Interfaces:**
- Consumes: terminally validated `compiler_runs`, existing `agents`, `flows`, `document_chunks`, and chunk-to-layout links.
- Produces: `compiler_artifacts`, `compiler_evidence_links`, and `materialize_care_path_compilation(uuid,text,jsonb,jsonb,jsonb,jsonb)`.

- [x] **Step 1: Write a failing atomic-materialization test**

Seed one `materializing` run, one cited chunk, one generated agent payload, and one care-path flow payload that references the agent by stable key:

```sql
v_result := public.materialize_care_path_compilation(
  v_run, 'compiler-worker',
  '[{"key":"hba1c-agent","name":"HbA1c follow-up","system_prompt":"Ask only the cited monitoring questions.","first_message":"Hello."}]',
  '[{"key":"hba1c-path","name":"HbA1c monitoring","graph":{"nodes":[],"transitions":[]}}]',
  '[]',
  jsonb_build_array(jsonb_build_object(
    'artifact_key','hba1c-agent','target_path','agent.system_prompt.monitoring',
    'chunk_id',v_chunk,'excerpt','Review HbA1c','role','timing'
  ))
);
```

Expected before migration: function does not exist.

- [x] **Step 2: Add artifact and evidence tables**

`compiler_artifacts` stores `artifact_type in ('agent','flow')`, stable key, role, nullable agent/flow FKs with `ON DELETE SET NULL`, and a check that no row points to both. The materializer, rather than a static check, requires the correct live FK at insertion. `compiler_evidence_links` references an artifact and a same-organization/version chunk, with unique `(artifact_id,target_path,chunk_id,role)`.

- [x] **Step 3: Implement transactional materialization**

The security-definer service-role RPC locks the run, checks lease owner/status/digests, rejects duplicate keys, validates all evidence chunks belong to the frozen version, inserts agents first, resolves `agent_key` in flow graphs to new UUIDs, inserts flows second, links artifacts/evidence/gaps, and updates the run in the same transaction. Use `status='draft'`; do not invoke either publish RPC.

- [x] **Step 4: Prove rollback and idempotency**

Add assertions that a foreign chunk, missing agent key, duplicate stable key, or malformed graph creates zero agents and zero flows. Repeating the completed call returns the same artifact IDs without duplicates. Deleting a generated draft nulls its FK but retains run origin and evidence.

- [x] **Step 5: Run SQL tests and commit**

Apply `0128`, reload PostgREST, and run the test with `ON_ERROR_STOP=1`. Expected: all assertions pass.

```bash
git add supabase/migrations/0128_compiler_artifacts.sql supabase/tests/0128_compiler_artifacts.sql
git commit -m "feat: materialize compiler drafts with provenance"
```

---

### Task 3: Enforce Graph and Clinical-Path Safety

**Files:**
- Create: `supabase/migrations/0129_compiled_flow_validation.sql`
- Create: `supabase/tests/0129_compiled_flow_validation.sql`

**Interfaces:**
- Consumes: `catalogue_node_types`, `validate_care_path_release(jsonb)`, and `validate_flow_release(uuid,text,jsonb)`.
- Produces: `validate_compiled_care_path(uuid,jsonb)` and stronger publish-time checks for compiler-linked care-path flows.

- [x] **Step 1: Write failing graph fixtures**

Create JSON fixtures for: a valid recurring HbA1c request with all non-success outcomes routed to `escalate.notify`; an invented component; an invalid source outcome; an unreachable node; a closed two-node cycle; and an outreach whose `expired` route ends silently. Before migration, the invalid fixtures must be accepted or the function must be missing.

- [x] **Step 2: Implement catalogue and transition validation**

Expand dynamic outcomes from `outcomes_from`, reject duplicate node IDs, reject missing transition endpoints, validate source outcomes, validate required fields and select options, and reject nodes outside `care_path`.

- [x] **Step 3: Implement reachability and terminal validation**

Use a recursive CTE bounded by node count to mark nodes reachable from every trigger. Reject unreachable nodes and strongly connected reachable regions whose exposed outcomes are all connected internally and have no terminal exit. Treat configured `loop` nodes as bounded only when `max_iterations` and `max_seconds` are valid positive integers.

- [x] **Step 4: Implement compiler clinical invariants**

For every `outreach.request`, recursively prove `declined`, `expired`, and `failed` lead to `escalate.notify`. Apply the same no-silent-terminal rule to `intelligence.empty`, `intelligence.failed`, `care_path.record.failed`, `care_path.complete.not_found`, and `care_path.complete.failed`. Validate `escalate.notify.to`, `urgency`, and nonblank `note` from catalogue options.

- [x] **Step 5: Recheck compiler safety at publish**

Update `validate_flow_release` so a flow linked through `compiler_artifacts` calls `validate_compiled_care_path` after the existing general and family validators. Hand-authored flows retain current behavior; compiler-origin safety cannot be removed by editing the draft.

- [x] **Step 6: Run SQL tests and commit**

Apply `0129`, reload PostgREST, and run all `0118`, `0119`, `0120`, and `0129` tests. Expected: existing valid flows still pass; every new invalid fixture fails with SQLSTATE `P0004`.

```bash
git add supabase/migrations/0129_compiled_flow_validation.sql supabase/tests/0129_compiled_flow_validation.sql
git commit -m "feat: validate compiled care paths"
```

---

### Task 4: Build the Deterministic Compiler Core

**Files:**
- Create: `bridge/src/vokoo/compiler/mod.rs`
- Create: `bridge/src/vokoo/compiler/types.rs`
- Create: `bridge/src/vokoo/compiler/lower.rs`
- Create: `bridge/src/vokoo/compiler/validate.rs`
- Create: `bridge/tests/compiler_core.rs`
- Modify: `bridge/src/vokoo/mod.rs`

**Interfaces:**
- Produces: `Recommendation`, `CarePathProgram`, `AgentDraft`, `FlowDraft`, `CompilerGap`, `CatalogueSnapshot`, `lower(program,catalogue,resources) -> CompilationOutput`, and `validate_output(output,catalogue,input) -> Result<(),Vec<ValidationError>>`.
- Consumes: deserialized catalogue rows and frozen workspace-resource IDs.

- [ ] **Step 1: Write failing lowering tests**

Use a minimal real-catalogue fixture and assert a recurring HbA1c recommendation lowers to `trigger.recurring -> outreach.request`, with `fulfilled` continuing and `declined/expired/failed` reaching `escalate.notify`. Assert an unsupported laboratory-ordering action becomes `CompilerGap { code: "missing_capability", .. }` rather than a node.

- [ ] **Step 2: Define source-bound intermediate types**

Every `Recommendation` contains population, anchor/timing, event, actions, completion, failure policy, and nonempty `Vec<EvidenceRef>`. `EvidenceRef` contains only `chunk_id`, recommendation ID, excerpt, and role; pages are derived from stored layout.

- [ ] **Step 3: Implement stable deterministic lowering**

Stable keys derive from recommendation IDs and operation roles, not model ordering. Resolve only exact operation-to-component mappings. Supply catalogue defaults; never synthesize missing required semantic values. Generate an agent only for a `Conversation` operation, and attach evidence target paths to each clinical prompt section.

- [ ] **Step 4: Implement Rust-side validation**

Mirror the database boundary: active family, fields, outcomes, endpoints, reachability, closed cycles, clinical escalation paths, evidence version membership, unique keys, and referenced resources. Return all validation errors in deterministic key order.

- [ ] **Step 5: Run focused tests and commit**

```bash
cargo test --manifest-path bridge/Cargo.toml --test compiler_core
```

Expected: all lowering, gap, provenance, graph, and deterministic-order tests pass.

```bash
git add bridge/src/vokoo/compiler bridge/src/vokoo/mod.rs bridge/tests/compiler_core.rs
git commit -m "feat: add deterministic care path compiler"
```

---

### Task 5: Move the AISDK Spike into a Bounded Production Harness

**Files:**
- Create: `bridge/src/vokoo/compiler/model.rs`
- Create: `bridge/src/vokoo/compiler/harness.rs`
- Create: `bridge/tests/compiler_harness.rs`
- Read only: `spikes/compiler-agent/`

**Interfaces:**
- Produces: `CompilerModel` trait, `AisdkCompilerModel`, `CompilerHarness::compile(input) -> Result<CompilationOutput,CompilerError>`, and `TraceSink`.
- Consumes: `DocumentEvidence`, physical-page outline, chunk retrieval, workspace provider/model/secret, and Task 4 compiler types.

- [ ] **Step 1: Write fake-model harness tests**

Implement a scripted `CompilerModel` test double. Assert the supervisor delegates bounded non-overlapping recommendation sections; workers cannot cite chunks outside their task/version; reconciliation cannot introduce uncited requirements; invalid tool output receives one correction attempt; and every decision emits a structured trace event.

- [ ] **Step 2: Define forced-tool contracts**

Define separate typed tools for `delegate_section`, `emit_recommendations`, `emit_reconciliation`, and `finish_compilation`. Tool schemas constrain enums but deterministic code revalidates relationships. No free-form response is parsed as compiler output.

- [ ] **Step 3: Implement provider construction**

Support the same configured readers as Workspace Intelligence: Anthropic, MiniMax through `https://api.minimax.io/anthropic/v1/`, and OpenAI. Force the named tool using the provider-specific body shape already proven in `intelligence.rs`. Resolve credentials before constructing `AisdkCompilerModel`; never accept a browser-supplied key.

- [ ] **Step 4: Implement bounded supervisor and workers**

The supervisor receives the page map and retrieval tool, delegates by headings/recommendations, and records exclusions. Cap workers, page span, retrieval results, model steps, and one correction attempt through explicit constants. Workers emit recommendations only; `lower` runs after reconciliation.

- [ ] **Step 5: Emit structured trace without source logs**

Trace events contain identifiers, page ranges, chunk IDs, tool names, accepted typed summaries, token usage, duration, and redacted errors. Add a test that scans logs/metric labels and rejects excerpts, prompts, document names, and model prose.

- [ ] **Step 6: Run focused tests and commit**

```bash
cargo test --manifest-path bridge/Cargo.toml --test compiler_harness
```

Expected: all tests pass without a provider request.

```bash
git add bridge/src/vokoo/compiler/model.rs bridge/src/vokoo/compiler/harness.rs bridge/tests/compiler_harness.rs
git commit -m "feat: add document compiler agent harness"
```

---

### Task 6: Run Compilations Durably in the Document Worker

**Files:**
- Create: `bridge/src/vokoo/compiler/repository.rs`
- Create: `bridge/src/vokoo/compiler/worker.rs`
- Create: `bridge/tests/compiler_worker.rs`
- Modify: `bridge/src/vokoo/compiler/mod.rs`
- Modify: `bridge/src/bin/vokoo_document_worker.rs`
- Modify: `bridge/src/vokoo/documents/metrics.rs`
- Modify: `deploy/vokoo-document-worker.service`
- Modify: `deploy/README.md`

**Interfaces:**
- Produces: `CompilerRepository`, `PostgrestCompilerRepository`, `CompilerWorker::run_once() -> Result<CompilerRunOutcome,CompilerWorkerError>`, and compiler metrics.
- Consumes: Task 1 RPCs, Task 2 materializer, Task 5 harness, service-role Supabase settings, and existing worker cancellation.

- [ ] **Step 1: Write fake-repository lifecycle tests**

Assert idle work makes no model call; successful work records ordered states and materializes once; retry resumes after completed immutable steps; permanent invalid evidence fails without drafts; lost lease prevents writes; cancellation stops before the next model call; and materialization retry returns existing artifacts.

- [ ] **Step 2: Implement typed PostgREST repository methods**

Add `claim`, `renew_lease`, `load_input`, `load_steps`, `append_step`, `advance`, `materialize`, and `fail`. Check every state-changing RPC response. Load only chunks from the frozen version and resources from the run snapshot.

- [ ] **Step 3: Implement resumable orchestration**

`run_once` claims one job, reconstructs completed phases from accepted step results, renews the lease around provider work, runs the harness, validates, advances to `materializing`, and calls the atomic RPC. Classify 408/429/5xx/network failures as retryable; malformed evidence, catalogue drift, and deterministic validation failures are permanent.

- [ ] **Step 4: Add compiler polling to the existing binary**

Alternate one ingestion claim and one compiler claim so a long compiler queue cannot starve indexing. Reuse the process cancellation token and workspace intelligence provider configuration. Keep `worker_processes: 1` and add `compiler_enabled` to health.

- [ ] **Step 5: Add source-safe metrics and configuration**

Record run totals, status, phase durations, model calls/retries/tokens, recommendations, gaps, and artifact counts. Labels may contain compiler/provider/model/phase/error code only. Add `VOKOO_COMPILER_ENABLED=true`; add no provider secret environment variable.

- [ ] **Step 6: Run worker tests and release build**

```bash
cargo test --manifest-path bridge/Cargo.toml --test compiler_worker
cargo test --manifest-path bridge/Cargo.toml --test document_worker
cargo build --release --manifest-path bridge/Cargo.toml --bin vokoo_document_worker
```

Expected: compiler and existing indexing tests pass; release worker builds.

- [ ] **Step 7: Commit the durable compiler worker**

```bash
git add bridge/src/vokoo/compiler bridge/tests/compiler_worker.rs bridge/src/bin/vokoo_document_worker.rs bridge/src/vokoo/documents/metrics.rs deploy/vokoo-document-worker.service deploy/README.md
git commit -m "feat: process compiler runs durably"
```

---

### Task 7: Expose Authenticated Compiler APIs

**Files:**
- Modify: `server/src/main.rs`
- Test: `server/src/main.rs`

**Interfaces:**
- Produces: `POST /api/v1/documents/{id}/versions/{version}/compilations`, `GET /api/v1/compiler-runs/{id}`, and `POST /api/v1/compiler-runs/{id}/cancel`.
- Consumes: authenticated `x-org-id`, Supabase user JWT, `enqueue_compiler_run`, RLS-visible compiler report rows, and `cancel_compiler_run`.

- [ ] **Step 1: Write failing request-validation tests**

Add unit tests for compiler ID allowlist (`care_path` only), UUID/version bounds, missing Workspace Intelligence recommendation, non-indexed versions, wrong organization, and terminal-run cancellation.

- [ ] **Step 2: Implement start endpoint**

Accept `{ "compiler_id": "care_path" }`, resolve the selected immutable version, call `enqueue_compiler_run`, and return HTTP 202 with the normalized run. Never accept provider, model, source text, catalogue, or credentials from the browser.

- [ ] **Step 3: Implement report endpoint**

Return the run plus ordered steps, gaps, artifacts, and evidence targets through RLS-scoped queries. Do not return stored prompt bodies, source excerpts beyond cited bounded excerpts, service diagnostics, or provider request payloads.

- [ ] **Step 4: Implement cancellation endpoint and routes**

Call `cancel_compiler_run` and return 409 when the run is materializing or terminal. Register exact routes before generic resource routes.

- [ ] **Step 5: Run server tests and commit**

```bash
cargo test --manifest-path server/Cargo.toml
```

Expected: all existing and compiler API tests pass.

```bash
git add server/src/main.rs
git commit -m "feat: expose document compiler runs"
```

---

### Task 8: Add the Document Compiler Review Surface

**Files:**
- Modify: `src/lib/document-workspace.ts`
- Modify: `src/lib/document-workspace.test.ts`
- Modify: `src/components/application/screens/documents-screen.tsx`

**Interfaces:**
- Produces: normalized `CompilerRun`, `CompilerStep`, `CompilerGap`, `CompilerArtifact`, polling helpers, compile/cancel actions, progress/report UI, artifact navigation, and evidence highlighting.
- Consumes: Task 7 endpoints and existing `selectEvidenceLayout`/`PdfDocumentViewer`.

- [ ] **Step 1: Write failing normalization and polling tests**

Assert unknown statuses are rejected, steps are sequence-sorted, gaps retain severity/code/evidence, deleted artifacts remain visible as unavailable, active states poll, terminal states stop, and evidence selection resolves chunk layout spans.

- [ ] **Step 2: Add strict TypeScript contracts**

Define the five nonterminal states plus `completed`, `completed_with_gaps`, `failed`, and `cancelled`. Parse arrays defensively and discard malformed IDs, target paths, and evidence instead of rendering unsafe assumptions.

- [ ] **Step 3: Add compile and progress controls**

Show **Compile into workflow** only for an indexed version with a normalized `care_path` recommendation. Start the run, poll its report, expose cancellation only before materialization, and use an accessible live status region.

- [ ] **Step 4: Add completion review**

Render generated flow and agent links, coverage, ordered trace summaries, warnings, and first-class gaps. Label `escalate.notify` as “Creates trackable escalation work,” never “Notifies clinician.” Preserve the existing 400px pane and current compact spacing.

- [ ] **Step 5: Wire evidence navigation**

Clicking a node/prompt evidence target calls the existing evidence selection with its `chunk_id`, causing the PDF viewer to move to and highlight linked layout spans. Clicking a live artifact opens its normal flow or agent editor.

- [ ] **Step 6: Run frontend tests and build**

```bash
node --import tsx --test src/lib/document-workspace.test.ts
npx tsc --noEmit
npm run build:deploy
```

Expected: tests, typecheck, and production build pass.

- [ ] **Step 7: Commit the review surface**

```bash
git add src/lib/document-workspace.ts src/lib/document-workspace.test.ts src/components/application/screens/documents-screen.tsx
git commit -m "feat: review document compiler output"
```

---

### Task 9: Compile the Uploaded NG28 Acceptance Slice and Deploy

**Files:**
- Create: `docs/benchmarks/ng28-care-path-compiler.md`
- Modify: `deploy/README.md`
- Modify only if verification exposes an in-scope defect: compiler files from Tasks 1–8.

**Interfaces:**
- Consumes: the uploaded NG28 Version 1, all previous tasks, current VPS services, and the existing operator-managed Workspace Intelligence credential.
- Produces: measured end-to-end evidence for a cited HbA1c monitoring draft flow and its supporting draft agents.

- [ ] **Step 1: Run the complete local verification matrix**

```bash
git diff --check
node --import tsx --test src/lib/document-workspace.test.ts
npx tsc --noEmit
npm run build:deploy
cargo test --manifest-path server/Cargo.toml
cargo test --manifest-path bridge/Cargo.toml --test compiler_core
cargo test --manifest-path bridge/Cargo.toml --test compiler_harness
cargo test --manifest-path bridge/Cargo.toml --test compiler_worker
cargo test --manifest-path bridge/Cargo.toml --test document_worker
cargo build --release --manifest-path bridge/Cargo.toml --bin vokoo_document_worker
```

Expected: every command exits zero; pre-existing warnings are recorded separately.

- [ ] **Step 2: Back up and apply migrations**

Follow `deploy/README.md` to create and verify a fresh database backup. Apply the three compiler migrations with `ON_ERROR_STOP=1`, run their SQL tests in transactions, reload PostgREST schema, and verify RLS and function grants.

- [ ] **Step 3: Deploy the server and worker disabled**

Sync only tracked in-scope files, build release binaries on the VPS, install the unit, and restart control plane and document worker with `VOKOO_COMPILER_ENABLED=false`. Verify existing indexing/search and console health first.

- [ ] **Step 4: Enable one compiler worker and start NG28**

Set `VOKOO_COMPILER_ENABLED=true`, restart the worker, and start `care_path` compilation from the signed-in NG28 Version 1 document UI. Confirm the run freezes its version, extraction, catalogue digest, provider, model, compiler version, and prompt version.

- [ ] **Step 5: Verify NG28 output**

Require: whole-document supervisor coverage report; cited HbA1c tasks; at least one draft `care_path` flow; supporting draft agents when conversation is required; multiple real triggers where evidence supports them; all request non-success paths reach `escalate.notify`; every clinical node/prompt section highlights stored PDF coordinates; unsupported actions appear as gaps; no artifact is published or executed.

- [ ] **Step 6: Verify retry, cancellation, and atomicity**

Cancel a separate test run before materialization and confirm zero artifacts. Re-fetch the completed NG28 run, then replay its materialization RPC inside the SQL acceptance boundary and confirm artifact IDs do not duplicate. Exercise one deliberately invalid synthetic payload through the repository test boundary and confirm materialization rolls back.

- [ ] **Step 7: Inspect security and runtime evidence**

Verify one worker process, healthy services, no provider key outside Vault, no prompts/source passages in system logs or metric labels, and tenant-scoped API responses. Record timings, model calls/tokens, selected pages, recommendation/artifact/gap counts, commit, migrations, and service versions in the benchmark document.

- [ ] **Step 8: Deploy the console and perform signed-in review**

```bash
bash deploy/console.sh vokoo
```

Expected: production build and asset checks pass. In the browser, confirm progress, trace, gaps, artifact links, source highlighting, and draft status for NG28.

- [ ] **Step 9: Commit verification evidence and push**

```bash
git add docs/benchmarks/ng28-care-path-compiler.md deploy/README.md
git commit -m "test: verify NG28 care path compilation"
git push origin console-and-canvas
```

Report exact commits, migration numbers, service health, NG28 artifact IDs/counts, measured timings, and anything not verified.
