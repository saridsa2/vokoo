# Multi-trigger Flow Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the compatibility-first graph v3 foundation so one published flow can contain multiple explicit triggers and both runtimes select an entry deterministically.

**Architecture:** Trigger identity moves from `flows.trigger_event` and singleton `graph.start` into versioned trigger nodes. Legacy v2 rows normalize in memory; newly edited flows publish as v3 with an explicit family. The bridge starts from an `(event, key)` entry while existing number/post-call resolution remains available until the next phase.

**Tech Stack:** PostgreSQL/Supabase and PL/pgSQL, TypeScript 5.9 with Node test runner, Next.js 16/React 19, Rust 2021 with serde and Cargo tests.

**Spec:** `docs/superpowers/specs/2026-09-05-multi-trigger-flows-and-integrations-design.md`

## Global Constraints

- Keep `flows.trigger_event`, `graph.start`, and `number_flows` readable during migration.
- Select triggers only by `(event, key)`, never node order.
- Store flow family explicitly; never infer it from the first trigger.
- Do not deploy or apply migrations to the Hostinger VPS before user testing.
- Preserve unrelated working-tree changes and keep them out of commits.

## File map

- `supabase/migrations/0112_a_flow_has_many_triggers.sql`: additive family column, backfill, and graph-v3 publish validation.
- `supabase/migrations/0113_flow_triggers_are_addable.sql`: replaces the legacy catalogue family and exposes call triggers in the call palette.
- `supabase/tests/0112_a_flow_has_many_triggers.sql`: transaction-wrapped migration contract test, safe to run against the VPS demo database.
- `src/utils/flow-graph.ts`: graph versions, families, legacy normalization, trigger enumeration, selection, and validation.
- `src/utils/flow-graph.test.ts`: pure TypeScript contract tests.
- `src/lib/flow-diagram.ts`: lossless graph/canvas conversion for every trigger.
- `src/lib/architecture-model.ts`: expanded explicit flow-family vocabulary.
- `src/components/application/screens/flow-composer-screen.tsx`: family plumbing and graph-v3 publishing.
- `src/components/stackplane/recovered-editor-host.tsx`: trigger add/delete/connect rules.
- `docs/flow-node-catalogue.json`: graph-v3 trigger palette metadata.
- `bridge/src/vokoo/graph.rs`: trigger index and entry selection.
- `bridge/src/vokoo/runner.rs`: runner construction from a selected entry.
- `bridge/src/bin/flow_check.rs`, `bridge/src/bin/vokoo_bridge.rs`, `bridge/src/vokoo/escalate.rs`: explicit event call sites.
- `bridge/Cargo.toml`: remove the stale missing `llm_only_test` target so tests run.
- `package.json`: include graph-contract tests in `npm test`.

---

### Task 1: TypeScript graph v3 contract

**Files:**
- Create: `src/utils/flow-graph.test.ts`
- Modify: `src/utils/flow-graph.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `FlowFamily`, `FlowEntryPoint`, `TriggerEntry`, `triggerEntries`, `entryNodeId`, and `normalizeFlowGraph`.
- Consumes: existing `Flow`, `FlowGraph`, `FlowNode`, and `checkGraph`.

- [x] **Step 1: Write failing contract tests**

Use this two-entry fixture and test answered selection, ended selection, missing
selection, duplicate rejection, reachability from both entries, and v2
normalization:

```ts
const graph = (): FlowGraph => ({
    version: 3,
    nodes: [
        { id: "answer", type: "trigger", implementation: "trigger.call_answered", name: "Answered", position: { x: 0, y: 0 }, config: {} },
        { id: "ended", type: "trigger", implementation: "trigger.call_ended", name: "Ended", position: { x: 0, y: 200 }, config: { key: "default" } },
        { id: "during", type: "custom", implementation: "agent", name: "Agent", position: { x: 300, y: 0 }, config: {} },
        { id: "after", type: "custom", implementation: "intelligence", name: "Extract", position: { x: 300, y: 200 }, config: {} },
    ],
    transitions: [
        { id: "a", from: "answer", outcome: "started", to: "during" },
        { id: "b", from: "ended", outcome: "caller_hung_up", to: "after" },
    ],
    variables: [],
});

assert.equal(entryNodeId(graph(), { event: "call.answered" }), "answer");
assert.equal(entryNodeId(graph(), { event: "call.ended" }), "ended");
assert.equal(entryNodeId(graph(), { event: "message.received" }), null);
```

- [x] **Step 2: Run RED test**

Run: `node --test src/utils/flow-graph.test.ts`

Expected: missing-export/type failures.

- [x] **Step 3: Implement graph types and helpers**

```ts
export type FlowFamily = "call" | "integration" | "care_path" | "message" | "general";
export type FlowEntryPoint = { event: string; key?: string };
export type TriggerEntry = { event: string; key: string; nodeId: string };

export function triggerEntries(graph: FlowGraph): TriggerEntry[] {
    return graph.nodes.flatMap((node) =>
        node.implementation.startsWith("trigger.")
            ? [{ event: node.implementation.slice(8), key: String(node.config.key ?? "default"), nodeId: node.id }]
            : [],
    );
}
```

Make v3 `start` optional. `normalizeFlowGraph` must clone v3 graphs and prepend a
deterministic trigger for a v2 graph with none, wiring it to the historical
start. `checkGraph` must require a trigger, reject duplicate event/key pairs,
and seed reachability from all trigger IDs.

- [x] **Step 4: Run GREEN tests**

Run: `node --test src/utils/flow-graph.test.ts`

Expected: all graph tests pass.

Run: `npm test`

Expected: graph, SDK, and CLI tests pass after adding `test:flows`.

- [x] **Step 5: Commit**

```bash
git add package.json src/utils/flow-graph.ts src/utils/flow-graph.test.ts
git commit -m "feat: add multi-trigger graph contract"
```

### Task 2: Additive database contract

**Files:**
- Create: `supabase/migrations/0112_a_flow_has_many_triggers.sql`
- Create: `supabase/tests/0112_a_flow_has_many_triggers.sql`

**Interfaces:**
- Consumes: graph-v3 event/key semantics.
- Produces: `flows.family` and `validate_flow(graph, family, legacy_trigger_event)` used by `publish_flow`.

- [x] **Step 1: Add failing migration assertions**

At migration end, assert that this fixture validates:

```sql
perform public.validate_flow(
  '{"version":3,"nodes":[{"id":"a","type":"trigger","implementation":"trigger.call_answered","config":{}},{"id":"e","type":"trigger","implementation":"trigger.call_ended","config":{}}],"transitions":[],"variables":[]}'::jsonb,
  'call',
  null
);
```

Add a nested exception assertion proving two default-key answered triggers raise
SQLSTATE `P0001`.

- [x] **Step 2: Run RED migration**

Run: `supabase db reset`

Expected: assertion fails until the family column and validator overload exist.

- [x] **Step 3: Implement migration**

Add constrained, non-null `flows.family`; retain `trigger_event`. Backfill
answered/failed rows as `call` and legacy ended rows as `integration` for display
compatibility without rewriting graphs. Implement graph-v2 legacy validation and
graph-v3 rules: at least one trigger, unique event/key, family-valid triggers,
valid references, and no duplicate node IDs. Update `publish_flow` to validate
with the locked row's family and `trigger_event` before inserting its immutable
snapshot. During compatibility only, an existing `integration` row whose
`trigger_event = 'call.ended'` may retain exactly one ended trigger; the editor
must not offer that trigger for new integration graphs. This prevents opening
and saving an existing CRM graph from becoming an accidental breaking change.

- [x] **Step 4: Run GREEN migration**

Run: `supabase db reset`

Expected: all migrations and embedded assertions pass.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/0112_a_flow_has_many_triggers.sql
git commit -m "feat: validate multi-trigger flow versions"
```

### Task 3: Lossless canvas conversion and explicit family

**Files:**
- Modify: `src/lib/flow-diagram.ts`
- Modify: `src/lib/architecture-model.ts`
- Modify: `src/components/application/screens/flow-composer-screen.tsx`
- Extend: `src/utils/flow-graph.test.ts`

**Interfaces:**
- Consumes: `Flow.family` and `normalizeFlowGraph`.
- Produces: diagram context `{ family, variables, version: 3, legacyStart? }`.

- [x] **Step 1: Write failing round-trip test**

Assert `flow -> diagram -> graph` preserves both trigger node IDs,
implementations, keys, and transitions and returns version 3. Move any
alias-dependent pure seam into `flow-graph.ts` if Node cannot resolve `@/`.

- [x] **Step 2: Run RED test**

Run: `node --test src/utils/flow-graph.test.ts`

Expected: current first-trigger/start behavior fails the assertion.

- [x] **Step 3: Implement conversion and family plumbing**

Replace singleton-trigger materialization with `normalizeFlowGraph`. Carry family
in typed diagram context. Expand `NodeFamily` to the stored families and keep
`engine` as an editor-only context. The composer must retain the loaded family
and save graph v3 without changing node IDs or transitions.

- [x] **Step 4: Run tests and typecheck**

Run: `node --test src/utils/flow-graph.test.ts`

Run: `npx tsc --noEmit`

Expected: both exit 0.

- [x] **Step 5: Commit**

```bash
git add src/lib/flow-diagram.ts src/lib/architecture-model.ts src/components/application/screens/flow-composer-screen.tsx src/utils/flow-graph.test.ts
git commit -m "feat: preserve multiple flow entries in editor"
```

### Task 4: Multiple-trigger editor behavior

**Files:**
- Create: `supabase/migrations/0113_flow_triggers_are_addable.sql`
- Create: `supabase/tests/0113_flow_triggers_are_addable.sql`
- Modify: `docs/flow-node-catalogue.json`
- Modify: `src/components/stackplane/recovered-editor-host.tsx`
- Extend: `src/utils/flow-graph.ts`
- Extend: `src/utils/flow-graph.test.ts`

**Interfaces:**
- Produces: `canConnectToNode` and `canDeleteTrigger` pure rules.
- Consumes: explicit family and trigger uniqueness.

- [x] **Step 1: Write failing rule tests**

```ts
assert.equal(canConnectToNode(graph().nodes[0]), false);
assert.equal(canDeleteTrigger(graph(), "answer"), true);
assert.equal(canDeleteTrigger({ ...graph(), nodes: [graph().nodes[0]] }, "answer"), false);
```

- [x] **Step 2: Run RED test**

Run: `node --test src/utils/flow-graph.test.ts`

Expected: missing-rule exports.

- [x] **Step 3: Implement editor rules**

Make call triggers addable only on call boards through catalogue `families`.
Reject a duplicate event/default-key trigger with a specific toast. Reject edges
whose target is a trigger. Allow trigger deletion only when another trigger
remains. Keep engine fixed-shape behavior unchanged.

- [x] **Step 4: Run GREEN tests and build**

Run: `node --test src/utils/flow-graph.test.ts`

Run: `npm run build`

Expected: both exit 0.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/0112_a_flow_has_many_triggers.sql docs/flow-node-catalogue.json src/components/stackplane/recovered-editor-host.tsx src/utils/flow-graph.ts src/utils/flow-graph.test.ts
git commit -m "feat: edit multiple flow triggers"
```

### Task 5: Rust entry-point selection

**Files:**
- Modify: `bridge/Cargo.toml`
- Modify: `bridge/src/vokoo/graph.rs`
- Modify: `bridge/src/vokoo/runner.rs`
- Modify: `bridge/src/bin/flow_check.rs`
- Modify: `bridge/src/bin/vokoo_bridge.rs`
- Modify: `bridge/src/vokoo/escalate.rs`

**Interfaces:**
- Produces: `EntryPoint::new(event)`, `Flow::entry_node`, and `FlowRunner::for_entry`.
- Consumes: `trigger.<event>` plus default-key semantics.

- [ ] **Step 1: Write failing Rust tests**

Deserialize one graph with answered and ended triggers and assert exact
selection, duplicate rejection, and missing-entry rejection. Assert the runner's
first step is the selected trigger rather than legacy `start`.

- [ ] **Step 2: Enable tests and confirm RED**

Remove only the stale `llm_only_test` bin declaration whose source is absent.

Run: `cargo test --manifest-path bridge/Cargo.toml --lib vokoo::graph`

Expected: new API tests fail.

- [ ] **Step 3: Implement Rust selection**

Build `HashMap<(String, String), String>` from trigger nodes while loading. Return
typed duplicate and missing errors. Add `FlowRunner::for_entry`; retain
`FlowRunner::new` temporarily as a call-answered wrapper. Update all known call
sites to pass `call.answered`, `call.ended`, or `call.failed` explicitly.

- [ ] **Step 4: Run Rust verification**

Run: `cargo test --manifest-path bridge/Cargo.toml --lib`

Run: `cargo check --manifest-path bridge/Cargo.toml --bin vokoo_bridge --bin flow_check`

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add bridge/Cargo.toml bridge/src/vokoo/graph.rs bridge/src/vokoo/runner.rs bridge/src/bin/flow_check.rs bridge/src/bin/vokoo_bridge.rs bridge/src/vokoo/escalate.rs
git commit -m "feat: select flow runtime entry points"
```

### Task 6: Phase-one verification checkpoint

**Files:**
- Modify only files from Tasks 1-5 if verification exposes defects.

**Interfaces:**
- Consumes: all phase-one deliverables.
- Produces: a tested checkpoint before call-version pinning.

- [ ] **Step 1: Run all gates**

```bash
npm test
npx tsc --noEmit
npm run build
cargo test --manifest-path server/Cargo.toml
cargo test --manifest-path bridge/Cargo.toml --lib
cargo check --manifest-path bridge/Cargo.toml --bin vokoo_bridge --bin flow_check
```

Expected: every command exits 0; unchanged Next.js warnings may remain.

- [ ] **Step 2: Inspect scope**

Run: `git diff console-and-canvas...HEAD --stat`

Run: `git status --short`

Expected: only planned files; clean status or clearly unrelated unstaged user files.

- [ ] **Step 3: Commit verification fixes if necessary**

Stage only exact files fixed and commit:

```bash
git commit -m "fix: complete multi-trigger compatibility checks"
```

Do not deploy. Report exact gates and anything environment-blocked.

## Follow-on plans

After this independently testable checkpoint:

1. pin call flow/version and replace event-specific number bindings;
2. add typed `integration.invoke` and durable `integration_runs` execution;
3. add assisted CRM migration/activity UI and retire legacy post-call resolution.
