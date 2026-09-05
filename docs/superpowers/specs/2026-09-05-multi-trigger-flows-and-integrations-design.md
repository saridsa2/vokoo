# Multi-trigger flows and explicit integration invocation

**Issue:** [#6](https://github.com/saridsa2/vokoo/issues/6)

**Status:** Proposed

**Rollout:** Compatibility first; no VPS deployment until user testing is complete

## Problem

Vokoo currently models a flow as a handler for one event. The event is stored in
`flows.trigger_event`, the graph has one `start`, and phone numbers bind a
different flow for each call event through `number_flows`. The bridge therefore
resolves one flow when a call is answered and a second flow after hangup.

That model conflicts with the product architecture:

```text
care path -> flow -> N triggers
```

It also puts call-specific work in integrations. A CRM push currently begins
with `Call ended -> Process call`, even though call lifecycle and call-data
extraction belong to the call flow. Integrations must be independent workflows
that accept typed input from any caller: a call flow, a care-path flow, or a
future manual/API invocation.

## Goals

1. Let one flow contain multiple explicit trigger nodes.
2. Start a graph at the trigger selected by the incoming event, rather than at a
   single global `graph.start`.
3. Pin a call to the exact published flow version selected at call start and
   reuse that version for all later call events.
4. Keep call-data extraction inside the call flow.
5. Let a flow explicitly invoke a reusable integration with a typed payload.
6. Make integration delivery durable, observable, retryable, and idempotent.
7. Preserve existing single-trigger flows during a staged migration.

## Non-goals

- Building the complete care-path compiler, follower, or scheduling system.
- Treating integrations as call-specific post-call flows.
- Deploying these changes before local review and user testing.
- Migrating real patient or live call data; the current environments contain
  demo/test data only.

## Domain model

### Flow

A flow is a versioned directed graph. Its family describes what the graph is
allowed to do, but does not choose its entry point.

Initial families are:

- `call`: call lifecycle, media, agents, and call-data extraction.
- `integration`: receives typed input and performs external side effects.
- `care_path`: longitudinal patient orchestration.
- `message`: message lifecycle handling.
- `general`: reusable logic that is not restricted to one channel.

Family is stored explicitly on the flow. It must not be inferred from the first
trigger node because node order has no semantic meaning and a graph may contain
several triggers.

### Trigger

A trigger node is an addressable graph entry point. Its implementation is the
event name, for example:

- `trigger.call_answered`
- `trigger.call_ended`
- `trigger.call_never_answered`
- `trigger.integration_invoked`
- `trigger.due`
- `trigger.recurring`
- `trigger.reported`
- `trigger.document`

Within one published flow version, `(implementation, trigger key)` must be
unique. Most event types need one trigger only, so the trigger key defaults to
`default`. The key exists to support future named webhooks/schedules without
changing the execution identity.

The trigger node itself is included in the trace, then execution follows the
transition for its `started` outcome. There is no hidden pre-trigger edge.

### Integration

An integration is a flow with family `integration` and exactly one
`trigger.integration_invoked` entry point in the first release. Its trigger
declares an input schema using the same JSON Schema representation already used
for structured outputs.

An `integration.invoke` node in another flow selects:

- the target integration flow;
- a version policy;
- an input mapping;
- an optional idempotency-key expression.

The default version policy is `published_at_execution`. The target integration
version is resolved once when the durable run is created and is stored on that
run. Future retries use the stored version. A later enhancement may expose an
explicit pinned-version policy in the editor.

The invocation node does not know about calls. It maps values from the source
execution context into the integration's declared schema.

## Graph contract

The new graph contract is version 3:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "on_answered",
      "type": "trigger",
      "implementation": "trigger.call_answered",
      "config": { "key": "default" }
    },
    {
      "id": "on_ended",
      "type": "trigger",
      "implementation": "trigger.call_ended",
      "config": { "key": "default" }
    }
  ],
  "transitions": [],
  "variables": []
}
```

`start` is optional in version 3 and has no runtime authority when an explicit
entry event is supplied. Draft readers retain it only for compatibility with
older graphs.

Runtime entry selection takes an `EntryPoint`:

```text
event: implementation without the trigger. prefix, e.g. call.ended
key: default unless supplied
payload: event-specific JSON object
```

Selection rules are deterministic:

1. Find a trigger node whose implementation matches `trigger.<event>` and whose
   config key matches the requested key.
2. Reject execution if none exists.
3. Reject publish if more than one node has the same event/key pair.
4. Never select a trigger by node order.

## Storage changes

### `flows`

Add `family text not null default 'call'` with a constrained set of values.
Keep `trigger_event` during compatibility rollout, but stop using it as runtime
authority once a graph has explicit trigger nodes. Remove it only in a later,
separate cleanup migration after all deployed readers use graph v3.

Trigger definitions remain inside each immutable flow-version snapshot. A
separate mutable `flow_triggers` table would allow routing metadata to diverge
from the published graph and is intentionally avoided.

### `calls`

`calls.flow_id` already exists. `calls.flow_version` already exists but must be
populated atomically when the answered flow is resolved. Together they are the
authority for all subsequent lifecycle events.

No later event may re-resolve a call flow from the phone number. This prevents a
mid-call publish or number reconfiguration from sending hangup work through a
different graph.

### Phone-number bindings

The final model binds one call flow to a phone number. Multiple call events are
entry points inside that flow, so separate `call.answered` and `call.ended`
bindings are no longer needed.

During migration:

1. Existing `call.answered` binding remains the primary call-flow binding.
2. Existing `call.ended`/`call.never_answered` bindings remain readable only by
   the legacy fallback.
3. The UI exposes one call-flow selector once the selected flow supports the
   relevant triggers.
4. Legacy post-call bindings can be reported and migrated, but are not silently
   merged when their graphs contain conflicting variables or nodes.

### `integration_runs`

Add a durable queue table containing at least:

- `id`, `org_id`
- source `flow_id`, `flow_version`, execution/call identifier, and node ID
- target integration `flow_id`, resolved `flow_version`
- validated `input` JSON
- `idempotency_key`
- `status`: `queued`, `running`, `succeeded`, `retryable`, `failed`, `cancelled`
- `attempt_count`, `max_attempts`, `available_at`, `locked_at`, `locked_by`
- `result`, `last_error`, timestamps

Enforce uniqueness on `(org_id, target_flow_id, idempotency_key)` when a key is
present. The enqueue operation returns the existing run for a duplicate key.

RLS allows organization members to observe runs; only trusted service paths
claim and mutate queue state.

## Publish validation

Publishing a graph v3 flow validates:

- at least one trigger exists;
- trigger event/key pairs are unique;
- each trigger is allowed for the stored flow family;
- all nodes are reachable from at least one trigger, except editor-only
  annotations;
- call-only nodes do not appear in integration flows;
- integration flows have one `trigger.integration_invoked` node;
- each `integration.invoke` target exists in the same organization, is an
  integration flow, and is published;
- the invocation mapping can satisfy required target fields where that can be
  proven statically;
- existing agent publication checks still pass.

Runtime validates the fully materialized payload against the resolved target
version's input schema before enqueueing. A validation failure follows the
node's `invalid_payload` outcome and creates no run.

## Call lifecycle

### Start/answer

1. Resolve the phone number's primary call flow.
2. Resolve its current published version.
3. Atomically write both IDs to the call record.
4. Load the immutable version snapshot.
5. Execute `call.answered` with call metadata as the trigger payload.

If a legacy flow has no explicit trigger node, the compatibility reader
materializes its historical trigger from `flows.trigger_event`/`graph.start`.

### Hangup

1. Persist final call state, transcript, variables, recording metadata, and
   disconnect reason.
2. Read `calls.flow_id` and `calls.flow_version`.
3. Load that exact snapshot.
4. If it contains `trigger.call_ended`, execute that branch with the complete
   call snapshot.
5. If it lacks the trigger, finish successfully; the event is optional.

The hangup path no longer resolves a separate flow from `number_flows` once the
new contract is active.

`call.never_answered` follows the same pinned-version rule when a call record
already exists. If the provider event arrives before normal call creation, the
ingress creates/pins the call exactly once before executing the event.

## Execution and durability

The call-ended graph may execute local extraction nodes synchronously against
persisted call data. When it reaches `integration.invoke`, it validates and
enqueues the integration run transactionally. External I/O is not performed in
the hangup webhook lifecycle.

A worker claims runs with database locking, executes the stored integration
version at `integration.invoked`, and records every node outcome. Retryable
transport/5xx failures use bounded exponential backoff with jitter. Schema,
authorization, mapping, and explicit 4xx failures are terminal unless the node
declares otherwise.

The source graph sees `queued` after a successful enqueue. It must not treat a
later CRM response as synchronous control flow. Run status and errors are
observable in the integration activity UI and API.

## Editor changes

- Permit multiple trigger nodes on a canvas.
- Trigger nodes cannot be connected into; they only have outgoing outcomes.
- Permit deletion when at least one valid trigger remains.
- Replace first-trigger family inference with the stored family.
- Add `Integration invoked` to integration canvases.
- Add `Invoke integration` to allowed source families.
- The invocation configuration selects the target and maps target-schema fields
  from variables, trigger payload, call data, and previous node outputs.
- Existing CRM graphs get an assisted migration: remove `Call ended` and
  call-processing nodes from the integration, declare the extracted payload as
  integration input, and add extraction plus invocation to the originating
  call flow. This is previewed before saving because mapping is semantic.

## Compatibility phases

### Phase 1: contract and readers

- Introduce graph v3 types, explicit family, entry selection, and validation.
- Read legacy graph v2 and materialize its single trigger in memory.
- Publish new/edited flows as v3 while retaining legacy columns.

### Phase 2: pinned call lifecycle

- Persist the selected flow version at call start.
- Re-enter that snapshot for answered, ended, and never-answered events.
- Keep legacy post-call resolution behind an explicit compatibility path and
  emit diagnostics whenever it is used.

### Phase 3: integration invocation

- Add typed integration inputs and the two node implementations.
- Add durable runs, worker, API, activity surface, retries, and idempotency.
- Provide the assisted CRM migration path.

### Phase 4: cleanup

- Verify no legacy fallback use in test/demo environments.
- Remove separate post-call selectors and detached resolver.
- Later, in a dedicated migration, remove `flows.trigger_event`, graph `start`,
  and event-specific `number_flows` semantics.

## Failure behavior

- Missing requested call trigger: record a structured skipped event; do not run
  a different entry point.
- Missing pinned version: mark lifecycle execution failed and alert; never fall
  forward to the latest version.
- Invalid integration payload: take `invalid_payload`; do not enqueue.
- Duplicate invocation: return the existing run and its current status.
- Worker crash: lease expires and another worker may retry.
- Terminal integration failure: retain input/error metadata subject to data
  retention rules and expose it for manual retry.

## Test strategy

### Unit and contract tests

- Event/key entry selection with two or more triggers.
- Duplicate, missing, and invalid-family triggers.
- Legacy graph materialization and new graph serialization.
- Static and runtime integration schema validation.
- Idempotent enqueue and retry classification.

### Database tests

- Family constraints and same-org target enforcement.
- Atomic call flow/version pinning.
- Queue claiming, lease expiry, uniqueness, RLS, and retry scheduling.
- Backfill preserves existing flows and bindings.

### Bridge/runtime tests

- Answered and ended branches load the same immutable version after a new
  version is published mid-call.
- Hangup persists data before extraction begins.
- Missing optional ended trigger is a successful no-op.
- Integration enqueue does not block external I/O on the carrier callback.
- Legacy single-trigger and detached post-call paths remain functional during
  the compatibility window.

### UI tests

- Add, configure, connect, and delete multiple triggers.
- Family-specific palette and publish errors.
- One phone-number call-flow binding.
- Typed invocation mapping and integration-run activity/error states.

## Operational rollout

All implementation and validation happens on this branch first. Applying
migrations or deploying services to the Hostinger VPS requires a separate user
approval after local testing. Before any eventual rollout:

1. back up the database;
2. deploy additive migrations and compatible readers first;
3. deploy the updated console/control plane/bridge/worker;
4. migrate demo graphs and inspect diagnostics;
5. keep legacy columns and resolution available for rollback;
6. remove compatibility behavior only in a later release.

## Decisions captured

- A flow owns many triggers; a care path owns flows.
- Call lifecycle branches belong to the same pinned call flow/version.
- Call-data extraction belongs to the call flow.
- Integrations are independent, typed, explicitly invoked workflows.
- External integration work is durable and asynchronous.
- Migration is compatibility-first rather than a hard cutover.
