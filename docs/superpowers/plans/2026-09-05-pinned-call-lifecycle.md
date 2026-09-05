# Pinned Call Lifecycle Implementation Plan

> **For Codex:** Execute this plan inline with `superpowers:executing-plans`, one test-first task at a time.

**Goal:** Make every call execute one immutable published call-flow version for all lifecycle events, while reducing phone-number configuration to one call-flow binding.

**Architecture:** PostgreSQL owns the atomic resolve-and-pin operation. The bridge starts a call through that operation, loads the exact `flow_versions.snapshot`, and later hangup processing reads the same pinned identity from the call row. Existing per-event rows remain readable only as a logged compatibility fallback; new product writes use the single `call.answered` binding.

**Tech Stack:** PostgreSQL/Supabase SQL, Rust/Reqwest/Tokio, Axum, Next.js/React/TypeScript, Node test runner.

## Global constraints

- Preserve tenant boundaries: a number and selected flow must share an organisation.
- Never load the mutable `flows.graph` for a real lifecycle event after pinning.
- A republish affects only calls started after that publish.
- A missing lifecycle trigger in the pinned graph is a successful no-op.
- Keep the legacy `call.ended` number binding only as a diagnostic compatibility fallback during this phase.
- Do not deploy or run migration 0114 on the VPS until the user tests and explicitly approves deployment.

### Task 1: Specify the atomic database contract

**Files:**

- Create: `supabase/tests/0114_pin_call_flow_version.sql`
- Create: `supabase/migrations/0114_pin_call_flow_version.sql`

1. Write SQL assertions for these cases: the selected call flow is the number's `call.answered` binding; the newest published snapshot version is pinned; a retried start returns the original pin after a republish; the returned JSON contains `call_id`, `flow_id`, and `flow_version`; a number cannot be bound to a non-call flow; unbinding clears both the canonical binding and legacy pointer.
2. Run the SQL test against a disposable/local Supabase database when available and confirm it fails before the migration. If no local database is configured, syntax-check through the project migration runner or record the unavailable runtime gate explicitly.
3. Add `start_call(...) returns jsonb`, resolving and writing the binding and latest version in one transaction. Lock/reuse an existing `(carrier, provider_call_id)` row without changing its pin. Keep `call_started` intact for compatibility.
4. Redefine `set_number_flow` so new writes accept only `call.answered`, validate `flows.family = 'call'`, keep `phone_numbers.flow_id` synchronized, and remove stale lifecycle sibling bindings for that number.
5. Re-run the SQL assertions and commit.

### Task 2: Load immutable snapshots in the bridge

**Files:**

- Modify: `bridge/src/vokoo/graph.rs`
- Modify: `bridge/src/vokoo/record.rs`

1. Add failing Rust unit tests for parsing a `flow_versions.snapshot` into a flow and for decoding the `start_call` result, including an unconfigured/no-flow result.
2. Add `PinnedFlow { flow_id, version }` and `StartedCall { call_id, pinned_flow }` value types.
3. Change `CallRecord::open` to call `start_call`, retain the returned pin, and expose it without making call recording failure fatal.
4. Add `load_flow_version(base, key, flow_id, version, entry)` that reads only `flow_versions.snapshot`, loads the active node catalogue, parses the snapshot, and validates the requested entry.
5. Run targeted Rust tests in the full RustVani verification overlay and commit.

### Task 3: Enter the pinned answered flow

**Files:**

- Modify: `bridge/src/bin/vokoo_bridge.rs`

1. Start the call record before constructing the runtime flow.
2. Load `call.answered` from the exact pin returned by `start_call`; attribute the live call only after the snapshot supplies its organisation.
3. Keep the existing mutable DID resolver only for pre-call carrier XML/preview paths that do not yet have a durable call row.
4. Run bridge library and binary compile/tests in the verification overlay and commit.

### Task 4: Re-enter the same snapshot after hangup

**Files:**

- Modify: `bridge/src/vokoo/postcall.rs`
- Modify: `bridge/src/bin/vokoo_bridge.rs`

1. Add failing unit tests around a pure lifecycle-selection helper: pinned identity wins; absent `call.ended` entry is a no-op; legacy fallback is selected only when the call row has no pin.
2. Persist final recording/end data before dispatching post-call work.
3. Load the call row with `flow_id` and `flow_version`, then load that exact snapshot and enter `call.ended`.
4. If the pinned graph has no `call.ended` entry, log at debug/info and return success.
5. For legacy rows without a pin only, use the old DID + `call.ended` binding and emit a compatibility warning.
6. Run targeted Rust tests and commit.

### Task 5: Make the phone-number UI a single call-flow selector

**Files:**

- Create: `src/utils/number-flow-binding.ts`
- Create: `src/utils/number-flow-binding.test.ts`
- Modify: `src/components/application/screens/phone-number-detail-screen.tsx`
- Modify: `src/components/application/screens/resource-columns.tsx`
- Modify: `src/components/application/screens/flows-workspace-screen.tsx`
- Modify: `src/utils/api-client.ts`
- Modify: `server/src/main.rs`
- Modify: `package.json`

1. Add failing pure TypeScript tests showing that only `call` family flows are selectable, one canonical binding is displayed, and legacy per-event rows collapse deterministically to the answered binding.
2. Implement the helper and add it to `test:flows`.
3. Replace the two phone-number selectors with one “Call flow” selector and update copy/read models to describe lifecycle triggers inside the selected flow.
4. Keep the HTTP route stable but make the request body `{ flow_id }`; have the server supply `call.answered` to the database function.
5. Stop presenting integration flows as directly number-bound in list/workspace copy.
6. Run Node tests, TypeScript, server tests, and the Next build; commit.

### Task 6: Full verification and branch handoff

**Files:**

- Review all Phase 2 changes.

1. Run `npm test`, `npx tsc --noEmit`, `npm run build`, `cargo test --manifest-path server/Cargo.toml`, and full bridge library/binary checks in the RustVani overlay.
2. Run the SQL migration test against a disposable database if the environment provides one; otherwise report that exact gate as unverified.
3. Confirm no secrets, generated build output, or unrelated auth changes entered the branch.
4. Commit any verification-only corrections and report the branch/commits. Do not merge, push, migrate the VPS, or deploy without the user's next approval.
