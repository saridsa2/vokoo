# Durable Integration Invocation Implementation Plan

> **For Codex:** Execute inline with `superpowers:executing-plans`; keep every behavior behind a failing contract test first.

**Goal:** Replace call-specific post-call integrations with typed, explicitly invoked, durable integration workflows.

**Architecture:** Source flows materialize and validate a target payload, then enqueue an immutable target flow/version in PostgreSQL. A background bridge worker claims leased runs, enters `integration.invoked`, executes integration-safe nodes, and records outcomes. The console configures typed invocations, shows run activity, and previews legacy CRM graph migration before applying it.

**Tech Stack:** PostgreSQL/Supabase, Rust/Tokio/Reqwest, vendored VoKoo Rust and JSON schemas, Next.js/TypeScript, Axum.

## Constraints

- Integration flows know nothing about calls; their only input is the invocation payload and VoKoo execution envelope.
- External I/O never runs in the carrier hangup callback.
- A run resolves its target published version once; retries never move forward to a newer version.
- Same-tenant target validation is enforced in PostgreSQL and publish validation.
- Duplicate idempotency keys return the existing run.
- Only leased service workers mutate run state; members observe and request retries through guarded RPCs.
- Do not apply migrations or deploy to the VPS without separate approval.

### Task 1: Durable queue and catalogue contract

**Files:**

- Create: `supabase/tests/0115_durable_integration_runs.sql`
- Create: `supabase/migrations/0115_durable_integration_runs.sql`
- Modify: `docs/flow-node-catalogue.json`

Write rollback-only tests, then add `integration_runs`, `integration_run_events`, idempotent enqueue, lease-based claim, completion/failure/retry RPCs, member RLS, and indexes. Add `trigger.integration_invoked` and `integration.invoke`; move `intelligence` into call-family extraction and retain HTTP/code only for integrations. Extend publish validation for exactly one integration trigger and same-org published invoke targets.

### Task 2: Consume the vendored clinical schemas

**Files:**

- Modify: `bridge/Cargo.toml`
- Create: `bridge/src/vokoo/clinical.rs`
- Create: `src/lib/vokoo-schemas.ts`
- Modify: `src/components/stackplane/recovered-editor-host.tsx`

Add failing Rust tests that accepted examples deserialize through the vendored VoKoo crate and invalid payloads fail. Add a thin payload-kind validator over the vendored types. Import the same owned JSON schemas in TypeScript to provide built-in typed input choices and field metadata without copying definitions.

### Task 3: Enqueue from `integration.invoke`

**Files:**

- Create: `bridge/src/vokoo/integration.rs`
- Modify: `bridge/src/vokoo/mod.rs`
- Modify: `bridge/src/vokoo/postcall.rs`

Test payload materialization, invalid-payload behavior, and idempotency expression resolution. Implement the node in the source call-ended walker: resolve mapping against scope, validate the target trigger schema/VoKoo kind, call `enqueue_integration_run`, and return `queued`, `invalid_payload`, or `failed`. Do not execute the target inline.

### Task 4: Lease worker and integration runner

**Files:**

- Modify: `bridge/src/vokoo/integration.rs`
- Modify: `bridge/src/bin/vokoo_bridge.rs`

Test retry classification and bounded backoff. Add a background worker that claims a stored target version, enters `integration.invoked`, executes trigger/var/condition/loop/code/http nodes, appends run events, marks success, and schedules retry only for transport/429/5xx outcomes. Leases expired by a crash become claimable again.

### Task 5: Editor, creation, and activity

**Files:**

- Modify: `src/lib/architecture-model.ts`
- Modify: `src/components/stackplane/recovered-editor-host.tsx`
- Modify: `src/components/application/screens/flow-composer-screen.tsx`
- Modify: `src/components/application/screens/flows-workspace-screen.tsx`
- Create: `src/components/application/screens/integration-activity.tsx`
- Modify: `src/utils/api-client.ts`
- Modify: `server/src/main.rs`

Create new integrations with graph v3 and `trigger.integration_invoked`, render integration target and schema-aware mapping controls for `integration.invoke`, expose recent run status/errors/attempts, and add a member-authorized manual retry endpoint.

### Task 6: Assisted legacy CRM migration

**Files:**

- Create: `src/lib/integration-migration.ts`
- Create: `src/lib/integration-migration.test.ts`
- Modify: `src/components/application/screens/flow-composer-screen.tsx`

Test and implement a pure preview transformer. It removes legacy `call.ended` and extraction nodes from the integration, declares the extracted schema on `integration.invoked`, and proposes the corresponding `call.ended -> intelligence -> integration.invoke` branch for the selected call flow. Show both graph diffs and require explicit apply; do not silently rewrite graphs.

### Task 7: Verification and handoff

Run rollback-only database tests in disposable PostgreSQL, all Node/type/build/server gates, the full RustVani library suite and bridge binary checks. Update design status and report commits. Do not merge, push, migrate, or deploy yet.
