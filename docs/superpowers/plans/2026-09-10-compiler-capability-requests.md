# Compiler Capability Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workspace users request a missing compiler capability, let operators resolve it through a registered adapter and catalogue node, and recompile a new immutable run with that resolution frozen into its inputs.

**Architecture:** Known compiler gaps carry typed `details` and server-supplied presentation metadata. Tenant-scoped capability requests point to reusable operator-owned resolutions; a child compiler run snapshots active resolutions and deterministic Rust adapters consume them. The first complete adapter maps `clinical.task` to the existing `escalate.notify` node.

**Tech Stack:** PostgreSQL/Supabase migrations and pgTAP-style SQL tests, Rust/Axum control plane, Rust compiler worker, React/Next.js, React Aria/Untitled UI, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-10-compiler-capability-requests-design.md`

## Global Constraints

- Completed compiler runs, steps, gaps, and resolution snapshots are immutable.
- Workspace users may request capabilities but may not create catalogue nodes, select arbitrary graph JSON, or activate resolutions.
- Operators may resolve only through a registered adapter compatible with an active catalogue node.
- Operator queue responses do not include raw document excerpts.
- A recompile creates a child run and freezes resolution IDs, adapter versions, mappings, and a digest.
- Unknown gap codes use `Compiler gap` and are never automatically requestable.
- The first executable slice resolves only `clinical.task` through `escalate.notify`; threshold mapping remains requestable but cannot be activated until its observation contract exists.
- No generated draft is published, enrolled, or executed.

---

### Task 1: Typed compiler gaps and human-readable presentation

**Files:**
- Modify: `bridge/src/vokoo/compiler/types.rs`
- Modify: `bridge/src/vokoo/compiler/lower.rs`
- Modify: `bridge/tests/compiler_core.rs`
- Modify: `src/lib/document-workspace.ts`
- Modify: `src/lib/document-workspace.test.ts`

**Interfaces:**
- Produces Rust `CompilerGap.details: serde_json::Value` for durable structured needs.
- Produces TypeScript `compilerGapPresentation(code, missingCapability)` returning labels, class, and requestability.
- Later tasks persist `details` and return the presentation with each report gap.

- [ ] **Step 1: Write failing Rust tests for structured gap details**

Add assertions to the existing lowering tests:

```rust
assert_eq!(
    threshold_gap.details,
    json!({
        "observation": "dd_cfdna_percentage",
        "operator": "gt",
        "value": 1,
        "unit": "percent"
    })
);
assert_eq!(
    clinician_gap.details,
    json!({
        "actor": "clinician",
        "action_key": "review-result",
        "what": "Review the result",
        "instructions": "Review the cited result and decide follow-up.",
        "expires_days": 7
    })
);
```

- [ ] **Step 2: Run the Rust tests and verify the missing field fails**

Run: `cargo test --manifest-path bridge/Cargo.toml --test compiler_core`

Expected: FAIL because `CompilerGap` has no `details` field.

- [ ] **Step 3: Add `details` to every deterministic gap constructor**

Extend the type:

```rust
pub struct CompilerGap {
    pub code: String,
    pub severity: GapSeverity,
    pub recommendation_id: String,
    pub explanation: String,
    pub missing_capability: Option<String>,
    pub details: Value,
    pub evidence: Vec<EvidenceRef>,
}
```

Populate threshold and actor fields exactly from the typed IR. Other existing
gaps receive a specific JSON object when they have structured inputs and `{}`
only when no request contract exists.

- [ ] **Step 4: Run the Rust test and verify it passes**

Run: `cargo test --manifest-path bridge/Cargo.toml --test compiler_core`

Expected: PASS.

- [ ] **Step 5: Write failing TypeScript presentation tests**

```ts
assert.deepEqual(compilerGapPresentation("threshold_requires_mapping", "clinical.threshold_mapping"), {
    title: "Clinical threshold cannot be evaluated",
    capabilityLabel: "Evaluate a clinical observation threshold",
    class: "missing_mapping",
    requestable: true,
});
assert.deepEqual(compilerGapPresentation("unknown_code", "unknown.capability"), {
    title: "Compiler gap",
    capabilityLabel: null,
    class: "unknown",
    requestable: false,
});
```

- [ ] **Step 6: Run the TypeScript test and verify it fails**

Run: `node --import tsx --test src/lib/document-workspace.test.ts`

Expected: FAIL because `compilerGapPresentation` does not exist.

- [ ] **Step 7: Implement the closed presentation registry and normalize `details`**

Export:

```ts
export type CompilerGapPresentation = {
    title: string;
    capabilityLabel: string | null;
    class: "missing_capability" | "missing_mapping" | "ambiguous_evidence" | "insufficient_evidence" | "safety_conflict" | "unknown";
    requestable: boolean;
};

export function compilerGapPresentation(code: string, missingCapability: string | null): CompilerGapPresentation;
```

Add `details: Record<string, unknown>` to `CompilerGap` and reject non-object
details during report normalization.

- [ ] **Step 8: Run focused tests and commit**

Run: `node --import tsx --test src/lib/document-workspace.test.ts && cargo test --manifest-path bridge/Cargo.toml --test compiler_core`

```bash
git add bridge/src/vokoo/compiler/types.rs bridge/src/vokoo/compiler/lower.rs bridge/tests/compiler_core.rs src/lib/document-workspace.ts src/lib/document-workspace.test.ts
git commit -m "feat: describe requestable compiler gaps"
```

### Task 2: Capability request and resolution ledger

**Files:**
- Create: `supabase/migrations/0131_compiler_capability_requests.sql`
- Create: `supabase/tests/0131_compiler_capability_requests.sql`
- Modify: `supabase/migrations/0128_compiler_artifacts.sql` only if the test database rebuilds migrations from scratch and the new migration cannot safely replace the materializer; otherwise replace the materializer in `0131`.

**Interfaces:**
- Consumes `CompilerGap.details` from Task 1.
- Produces RPCs `request_compiler_capability(uuid,text)`, `resolve_compiler_capability_request(uuid,text,text,text,jsonb,text)`, `transition_compiler_capability_request(uuid,text,text)`, and `enqueue_compiler_recompile(uuid)`. The catalogue node ID parameter is `text`, matching `catalogue_node_types.id`.
- Produces tables `capability_requests`, `compiler_capability_adapters`, and
  `compiler_capability_resolutions`.

- [ ] **Step 1: Write the SQL acceptance test first**

The test must create two organizations, one member, and one platform operator,
then prove:

```sql
-- A member can request only a visible terminal run gap.
select public.request_compiler_capability(v_gap_id, 'Needed for transplant follow-up');

-- Repeating the request returns the same id.
if (v_first->>'id') is distinct from (v_second->>'id') then
  raise exception 'capability request was not idempotent';
end if;

-- A member cannot activate a resolution.
-- An operator cannot resolve against an inactive or incompatible node.
-- A resolved request creates a child run whose input_snapshot.resolutions is frozen.
-- The other organization cannot read the request or child run.
```

Also assert that a legacy gap with `{}` details and an unknown gap code cannot be requested.

- [ ] **Step 2: Run the SQL test against the current schema and verify failure**

Run through the repository's documented Supabase test harness:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0131_compiler_capability_requests.sql
```

Expected: FAIL because migration `0131` and its functions do not exist.

- [ ] **Step 3: Implement migration `0131`**

The migration must:

```sql
alter table public.compiler_gaps
  add column details jsonb not null default '{}'::jsonb
  check (jsonb_typeof(details) = 'object');

alter table public.compiler_runs
  add column parent_run_id uuid references public.compiler_runs(id),
  add column resolution_digest text,
  add constraint compiler_runs_resolution_digest_check
    check (resolution_digest is null or resolution_digest ~ '^[0-9a-f]{64}$');
```

Create the three tables and same-organization foreign keys described in the
spec. Adapter rows are release-managed: revoke tenant and operator writes and
seed `clinical-task-escalate-notify-v1` for capability `clinical.task`, version
`1`, compatible node `escalate.notify`, with an object schema that permits only
`to` and `urgency`. Replace `materialize_care_path_compilation` so it inserts
`coalesce(v_item->'details','{}')` into compiler gaps. Add a `resolve` value to
the `compiler_steps.kind` check.

`request_compiler_capability` validates the known requestable code and exact
details shape before copying the typed contract. `enqueue_compiler_recompile`
locks the parent terminal run, selects only active compatible resolutions,
builds a fresh current catalogue/resource snapshot for the immutable file
version, serializes resolutions under `input_snapshot.resolutions`, computes a
deterministic digest, and inserts a queued child run.

- [ ] **Step 4: Run migration tests and verify they pass**

Run the repository migration test sequence including `0127` through `0131`.
Expected: all scripts commit and `0131` reports no exception.

- [ ] **Step 5: Commit the ledger**

```bash
git add supabase/migrations/0131_compiler_capability_requests.sql supabase/tests/0131_compiler_capability_requests.sql
git commit -m "feat: add compiler capability request ledger"
```

### Task 3: Workspace and operator control-plane APIs

**Files:**
- Modify: `server/src/main.rs`
- Modify: `src/utils/api-client.ts`

**Interfaces:**
- Consumes the Task 2 RPCs and tables.
- Produces workspace request/recompile endpoints and operator queue/transition endpoints from the spec.
- Extends compiler-run gap responses with `presentation` and `capability_request`.

- [ ] **Step 1: Write failing Axum unit tests**

Add tests for pure validation and response shaping before route handlers:

```rust
#[test]
fn known_gap_codes_get_labels_without_exposing_codes_as_titles() {
    let presentation = compiler_gap_presentation("unsupported_action_actor", Some("clinical.task"));
    assert_eq!(presentation["title"], "Care-team work cannot be created");
    assert_eq!(presentation["capability_label"], "Create work for a clinician");
    assert_eq!(presentation["requestable"], true);
}

#[test]
fn unknown_gap_codes_are_not_requestable() {
    assert_eq!(compiler_gap_presentation("invented", Some("invented"))["requestable"], false);
}
```

Add request-body validation tests that reject unknown adapter keys, arbitrary
mapping properties, missing operator notes on decline, and workspace attempts
to choose a resolution.

- [ ] **Step 2: Run server tests and verify failure**

Run: `cargo test --manifest-path server/Cargo.toml`

Expected: FAIL because the presentation and validation functions are absent.

- [ ] **Step 3: Implement response shaping and handlers**

Add request structs with `#[serde(deny_unknown_fields)]`. Route:

```rust
.route("/api/v1/compiler-gaps/{id}/capability-request", post(request_compiler_capability))
.route("/api/v1/compiler-runs/{id}/recompile", post(recompile_with_capabilities))
.route("/api/v1/operator/capability-requests", get(operator_capability_requests))
.route("/api/v1/operator/compiler-capability-adapters", get(operator_compiler_capability_adapters))
.route("/api/v1/operator/capability-requests/{id}/review", post(operator_review_capability_request))
.route("/api/v1/operator/capability-requests/{id}/request-information", post(operator_request_capability_information))
.route("/api/v1/operator/capability-requests/{id}/resolve-existing", post(operator_resolve_existing_capability))
.route("/api/v1/operator/capability-requests/{id}/deliver", post(operator_deliver_capability))
.route("/api/v1/operator/capability-requests/{id}/decline", post(operator_decline_capability_request))
```

Operator list responses contain structured contracts but omit gap evidence and
document chunks. Extend `get_compiler_run` using a same-org request query and
attach at most one request to each gap.

- [ ] **Step 4: Add typed client methods**

```ts
requestCompilerCapability(gapId: string, note: string, context: AccessContext)
recompileWithCapabilities(runId: string, context: AccessContext)
operatorCapabilityRequests<T>(context: AccessContext)
operatorResolveCapability<T>(requestId: string, body: ResolveCapabilityBody, context: AccessContext)
operatorTransitionCapabilityRequest<T>(requestId: string, action: "review" | "request-information" | "deliver" | "decline", body: object, context: AccessContext)
```

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `cargo test --manifest-path server/Cargo.toml && npm run typecheck:console`

```bash
git add server/src/main.rs src/utils/api-client.ts
git commit -m "feat: expose compiler capability requests"
```

### Task 4: Workspace request and recompilation UI

**Files:**
- Modify: `src/lib/document-workspace.ts`
- Modify: `src/lib/document-workspace.test.ts`
- Modify: `src/components/application/screens/documents-screen.tsx`

**Interfaces:**
- Consumes labelled gaps and capability-request state from Task 3.
- Produces the request dialog, status display, and child-run recompilation action.

- [ ] **Step 1: Write failing normalization tests**

Cover all seven request states and malformed request payloads. Assert that an
unknown gap stays non-requestable even if the payload claims otherwise.

```ts
const report = normalizeCompilerRunReport(fixtureWithCapabilityRequest("resolved"));
assert.equal(report?.gaps[0].capability_request?.status, "resolved");
assert.equal(canRequestCompilerCapability(report!.gaps[0]), false);
assert.equal(canRecompileWithCapabilities(report!), true);
```

- [ ] **Step 2: Run the TypeScript test and verify failure**

Run: `node --import tsx --test src/lib/document-workspace.test.ts`

Expected: FAIL because capability request normalization and predicates are absent.

- [ ] **Step 3: Implement the minimal workspace UI**

Replace raw headers with `gap.presentation.title`; render the capability label
as **Needed capability** and move codes into a closed **Technical details**
disclosure. Use the existing Untitled UI `Dialog`, `Input`, `Textarea`, `Badge`,
and `Button` components.

The dialog title is **Request capability** and its primary action uses the same
text. Do not add explanatory copy beyond the structured need and optional note.
After success, refresh the compiler report. Show **Recompile with resolved
capabilities** only when the predicate is true and switch the pane to the child
run returned by the endpoint.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `node --import tsx --test src/lib/document-workspace.test.ts && npm run typecheck:console`

Expected: PASS.

- [ ] **Step 5: Commit the workspace surface**

```bash
git add src/lib/document-workspace.ts src/lib/document-workspace.test.ts src/components/application/screens/documents-screen.tsx
git commit -m "feat: request compiler capabilities from documents"
```

### Task 5: Operator capability request queue

**Files:**
- Create: `src/components/application/screens/platform-capability-requests.tsx`
- Create: `src/app/(platform)/platform/capability-requests/page.tsx`
- Create: `src/lib/compiler-capability-requests.ts`
- Create: `src/lib/compiler-capability-requests.test.ts`
- Modify: `src/components/application/app-navigation/platform-nav.ts`
- Modify: `src/utils/api-client.ts`

**Interfaces:**
- Consumes operator endpoints from Task 3.
- Produces queue filtering, request detail, and operator state transitions.

- [ ] **Step 1: Add pure state/action tests before UI code**

Create the pure state helper in `src/lib/compiler-capability-requests.ts` and
prove:

```ts
assert.deepEqual(operatorActions({ status: "requested" }), ["review", "decline"]);
assert.deepEqual(operatorActions({ status: "under_review" }), ["resolve_existing", "request_information", "deliver", "decline"]);
assert.deepEqual(operatorActions({ status: "resolved" }), []);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --import tsx --test src/lib/compiler-capability-requests.test.ts`
Expected: FAIL because `operatorActions` is absent.

- [ ] **Step 3: Build the queue and resolution dialog**

Use a two-column operator workspace: filterable request list on the left and a
sticky detail pane on the right. Show capability label, organization, status,
typed contract, demand count, and operator response. Do not render evidence
excerpts or document text.

**Use existing capability** contains only:

- registered adapter select;
- compatible active catalogue node select;
- adapter-defined mapping fields;
- operator note;
- **Activate resolution**.

For the first slice, the only activatable adapter is
`clinical-task-escalate-notify-v1` with node `escalate.notify`. Threshold
requests can be marked delivering, clarified, or declined but not resolved.

- [ ] **Step 4: Run test, typecheck, and commit**

Run: `node --import tsx --test src/lib/compiler-capability-requests.test.ts && npm run typecheck:console`

```bash
git add src/components/application/screens/platform-capability-requests.tsx 'src/app/(platform)/platform/capability-requests/page.tsx' src/components/application/app-navigation/platform-nav.ts src/lib/compiler-capability-requests.ts src/lib/compiler-capability-requests.test.ts src/utils/api-client.ts
git commit -m "feat: add operator capability request queue"
```

### Task 6: Freeze resolutions and lower clinician work

**Files:**
- Modify: `bridge/src/vokoo/compiler/repository.rs`
- Modify: `bridge/src/vokoo/compiler/types.rs`
- Modify: `bridge/src/vokoo/compiler/lower.rs`
- Modify: `bridge/src/vokoo/compiler/harness.rs`
- Modify: `bridge/tests/compiler_core.rs`
- Modify: `bridge/tests/compiler_harness.rs`

**Interfaces:**
- Consumes `input_snapshot.resolutions` created by Task 2.
- Produces a validated `CapabilityResolutionSnapshot` and the adapter `clinical-task-escalate-notify-v1`.

- [ ] **Step 1: Write failing adapter tests**

Test a clinician request with and without the resolution:

```rust
let unresolved = lower(&program, &catalogue, &resources, &[]);
assert_eq!(unresolved.gaps[0].code, "unsupported_action_actor");

let resolved = lower(&program, &catalogue, &resources, &[clinical_task_resolution()]);
assert!(resolved.gaps.iter().all(|gap| gap.code != "unsupported_action_actor"));
assert_eq!(resolved.flows[0].graph.nodes[1].component, "escalate.notify");
assert_eq!(resolved.flows[0].graph.nodes[1].config["to"], "clinician");
```

Also reject wrong capability keys, inactive/missing catalogue nodes, unknown
adapter versions, and mappings containing extra properties.

- [ ] **Step 2: Run Rust tests and verify failure**

Run: `cargo test --manifest-path bridge/Cargo.toml --test compiler_core --test compiler_harness`

Expected: FAIL because lowerer and compiler input accept no resolution snapshot.

- [ ] **Step 3: Parse and validate frozen snapshots**

Define:

```rust
pub struct CapabilityResolutionSnapshot {
    pub id: String,
    pub capability_key: String,
    pub adapter_key: String,
    pub adapter_version: String,
    pub node_type_id: String,
    pub mapping: Value,
}
```

`repository.rs` reads only the run's frozen snapshot. The harness appends a
`resolve` trace step listing resolution IDs and adapter versions before
lowering.

- [ ] **Step 4: Implement the clinician-work adapter**

For `RequestActor::Clinician` and `RequestActor::CareTeam`, consume only the
matching active snapshot. Lower to `escalate.notify` with validated `to` and
`urgency`; render the cited instruction as `note`; wire `notified` to the next
supported action and `failed` to the recommendation's failure escalation path.
If a safe continuation cannot be wired, retain a blocking gap instead of
emitting a partial flow.

- [ ] **Step 5: Run Rust tests and commit**

Run: `cargo test --manifest-path bridge/Cargo.toml --test compiler_core --test compiler_harness`

```bash
git add bridge/src/vokoo/compiler/repository.rs bridge/src/vokoo/compiler/types.rs bridge/src/vokoo/compiler/lower.rs bridge/src/vokoo/compiler/harness.rs bridge/tests/compiler_core.rs bridge/tests/compiler_harness.rs
git commit -m "feat: compile resolved clinician work"
```

### Task 7: Full validation and local acceptance exercise

**Files:**
- Modify only files required by defects discovered through the following tests.
- Update: `docs/benchmarks/heart-transplant-capability-resolution.md`

**Interfaces:**
- Exercises all previous tasks as one tenant-safe vertical slice.

- [ ] **Step 1: Run complete automated verification**

```bash
npm run test:console
npm run typecheck:console
cargo test --manifest-path server/Cargo.toml
cargo test --manifest-path bridge/Cargo.toml --test compiler_core --test compiler_harness --test compiler_worker
git diff --check
```

Expected: every command exits zero with no test failures.

- [ ] **Step 2: Run the SQL migration locally or on the designated VPS test database**

Apply through `0131`, then run `supabase/tests/0131_compiler_capability_requests.sql` with `ON_ERROR_STOP=1`. Record the database target and migration result without recording credentials.

- [ ] **Step 3: Perform the signed-in browser acceptance exercise**

Using the current heart-transplant document:

1. compile or open its completed-with-gaps run;
2. verify headings are human labels and codes are under Technical details;
3. request `clinical.task`;
4. open `/platform/capability-requests` as an operator;
5. resolve it with `clinical-task-escalate-notify-v1` and `escalate.notify`;
6. return to Documents and recompile;
7. verify the child run trace names the frozen resolution;
8. verify `unsupported_action_actor` is absent while unresolved threshold gaps remain;
9. verify any produced flow and agent are drafts.

- [ ] **Step 4: Record evidence and remaining gaps**

Create `docs/benchmarks/heart-transplant-capability-resolution.md` with run IDs,
status, counts, adapter version, resolution ID, remaining gap codes, test
commands, and explicit statements that nothing was published or executed.

- [ ] **Step 5: Commit the acceptance record**

```bash
git add docs/benchmarks/heart-transplant-capability-resolution.md
git commit -m "test: record compiler capability resolution exercise"
```
