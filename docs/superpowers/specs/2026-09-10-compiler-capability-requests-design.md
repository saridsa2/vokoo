# Compiler capability requests and human remediation

**Status:** Approved direction; implementation review pending.

## Problem

The compiler currently identifies platform gaps but gives a workspace user no
way to act on them. `compiler_gaps` stores a review status and a free-text
resolution note, but authenticated users cannot update either field and the
compiler does not consume them. Changing those fields would therefore not
change a later compilation.

The review surface also renders internal identifiers such as
`threshold_requires_mapping` and `clinical.task` as headings. Those values are
stable machine identifiers, not user-facing labels.

The remediation boundary is deliberate:

- a workspace user can explain and request a missing platform capability;
- an operator can resolve the request against a real supported compiler
  adapter and catalogue component, commission a new component, request more
  information, or decline it;
- deterministic compiler code decides whether that resolution can lower safely;
- the original compiler run and its gaps remain immutable;
- a new run freezes the approved resolutions it uses.

## Gap classes

Compiler gaps are classified before presentation. The initial registry is held
in compiler code and returned through the control plane.

| Class | Example | Workspace action | Operator action |
| --- | --- | --- | --- |
| Missing capability | A clinician-directed task has no lowering adapter | Request capability | Use an existing adapter, deliver a new one, or decline |
| Missing mapping | A clinical observation threshold has no runtime mapping | Request capability | Select a supported observation adapter and mapping |
| Ambiguous evidence | Two cited passages conflict | Clarify or leave unresolved | None by default |
| Insufficient evidence | The source does not establish timing or completion | Correct the source or leave unresolved | None |
| Safety conflict | The requested behavior violates a compiler invariant | Leave omitted and review the source | None |

Only gap types explicitly marked `requestable` show **Request capability**.
Unknown codes use the neutral label **Compiler gap** and never become
requestable merely because they contain a `missing_capability` string.

The initial user-facing labels are:

- `threshold_requires_mapping`: **Clinical threshold cannot be evaluated**;
- `unsupported_action_actor`: **Care-team work cannot be created**.

The missing capability identifiers are also labelled:

- `clinical.threshold_mapping`: **Evaluate a clinical observation threshold**;
- `clinical.task`: **Create work for a clinician**.

## User experience

### Workspace compiler review

Each gap card contains:

1. a human-readable title;
2. severity and request status;
3. a plain-language explanation of what could not be represented;
4. the needed capability label;
5. source evidence, which continues to highlight the original document;
6. one contextual action.

For a requestable open gap, the action is **Request capability**. It opens a
small dialog containing the capability label, the structured need extracted by
the compiler, and an optional workspace note. Internal codes remain available
only in a secondary technical-details disclosure.

After submission the card shows one of:

- **Requested**;
- **Under operator review**;
- **More information needed**;
- **Resolution available**;
- **Capability being delivered**;
- **Declined**.

A resolved request shows what will be used, for example **Use Notify care team
for clinician work**. When at least one active resolution is available, the run
shows **Recompile with resolved capabilities**. The action creates a new run;
it never mutates or resumes the completed run.

### Operator portal

The operator receives a Capability requests queue grouped by capability key and
compatible requested contract. Each request shows the organization, compiler,
structured need, frequency of similar requests, and status. Raw source text is
not copied into the operator queue. Evidence remains in the tenant-owned
compiler gap and is visible only through an explicitly authorized tenant view.

The operator can:

1. **Use existing capability** — select a compatible active catalogue node and
   a registered compiler adapter, then complete the adapter's validated mapping;
2. **Deliver new capability** — mark the request as delivering and link it to a
   catalogue delivery record; the request is not resolved until both the node
   and its compiler adapter are active;
3. **Request information** — send a bounded question back to the workspace;
4. **Decline request** — provide a user-facing reason and optional safe
   alternative.

An operator cannot resolve a request with arbitrary graph JSON or an arbitrary
field mapping. The selected adapter defines the accepted mapping schema and the
compatible catalogue node types.

## Data model

### Gap presentation registry

The compiler owns a versioned code registry for each known gap:

- stable gap code;
- user-facing label and description;
- class and whether it is requestable;
- capability key and label when requestable;
- schema for the structured requested contract;
- compiler version that introduced the definition.

The control plane returns this presentation beside each gap. The database keeps
the stable identifiers and does not store duplicated display copy on every row.

### `capability_requests`

One row records a workspace request for one compiler gap:

- `id`, `org_id`, `run_id`, and `gap_id`;
- capability key and requested-contract JSON;
- contract digest used for grouping equivalent demand;
- status: `requested`, `under_review`, `needs_information`, `delivering`,
  `resolved`, `declined`, or `cancelled`;
- optional workspace note, operator response, and delivery reference;
- nullable active resolution ID;
- requester, resolver, and timestamps;
- unique `gap_id`, making submission idempotent.

The requested contract contains only the typed compiler need. For a threshold
this includes observation, operator, value, and unit. It does not duplicate a
full evidence excerpt or document page.

`compiler_gaps` gains a `details` JSON object populated by deterministic
lowering so this contract is never reconstructed by parsing human-readable
explanations. Known gap definitions validate the object before a request can be
created; legacy gaps with empty details remain readable but cannot be requested.

### `compiler_capability_adapters`

The database exposes a release-managed registry of adapters implemented by the
compiler binary. Each row contains adapter key and version, capability key,
user-facing label, compatible node type IDs, mapping schema, and active state.
Application migrations seed adapters shipped in that release. Operators may
select active adapters but cannot create or modify registry rows; this prevents
the database from claiming deterministic lowering support that the worker does
not implement.

### `compiler_capability_resolutions`

A resolution is reusable and operator-controlled:

- stable capability key;
- resolution type: `existing_component` or `new_component`;
- registered adapter key and adapter version;
- active catalogue node type ID;
- validated mapping JSON;
- scope, initially `platform`;
- status: `draft`, `active`, or `retired`;
- creator and timestamps.

The first slice supports platform-scoped resolutions only. Organization-scoped
resource bindings remain ordinary compiler inputs and are not smuggled into a
global resolution.

### Compiler runs

`compiler_runs` gains:

- nullable `parent_run_id` for recompilation lineage;
- `resolution_digest`;
- a frozen `resolution_snapshot` in `input_snapshot`.

The snapshot contains only active resolutions applicable to requested gaps from
the parent run. A resolution changed or retired after enqueue does not change an
existing run.

The compiler trace gains a `resolve` step that lists applied resolution IDs,
adapter versions, and gaps that remain unresolved. It stores decisions and
validation results, not chain-of-thought.

## Compiler adapters

A capability resolution is useful only when deterministic code implements its
adapter. Each adapter declares:

- the capability keys it resolves;
- compatible catalogue node types;
- mapping schema;
- adapter version;
- lowering behavior and validation invariants.

Initial adapters are:

### Clinician work through `escalate.notify`

Resolves `clinical.task` using the existing **Notify care team** component. The
mapping fixes the recipient policy and urgency vocabulary while the cited
instruction becomes the clinical note. The adapter preserves the node's
`notified` and `failed` outcomes and may not label creation of trackable work as
confirmed notification delivery.

### Observation threshold evaluation

Resolves `clinical.threshold_mapping` only when the observation can be bound to
a supported patient-scoped observation and the extracted operator and unit are
compatible. It lowers through registered trigger/condition/observation
components; it cannot invent a data source or silently convert units.

If no compatible patient observation exists, the operator must choose
**Deliver new capability** rather than activate an incomplete mapping.

## APIs and authorization

Workspace endpoints:

- `POST /api/v1/compiler-gaps/{gap_id}/capability-request`;
- `GET /api/v1/compiler-runs/{run_id}` includes request status and labelled gap
  presentation;
- `POST /api/v1/compiler-runs/{run_id}/recompile` creates the child run with
  applicable active resolutions.

Operator endpoints:

- `GET /api/v1/operator/capability-requests`;
- `GET /api/v1/operator/compiler-capability-adapters`;
- `POST /api/v1/operator/capability-requests/{id}/review`;
- `POST /api/v1/operator/capability-requests/{id}/request-information`;
- `POST /api/v1/operator/capability-requests/{id}/resolve-existing`;
- `POST /api/v1/operator/capability-requests/{id}/deliver`;
- `POST /api/v1/operator/capability-requests/{id}/decline`.

Narrow PostgreSQL functions enforce transitions and same-organization foreign
keys. Workspace members may read their organization's requests and create a
request for a visible terminal compiler run. Only platform operators may change
operator states or activate a resolution. The compiler worker alone consumes
resolution snapshots and materializes artifacts.

## State and failure behavior

- Repeating **Request capability** returns the existing request.
- A request cannot be marked resolved without an active compatible adapter and
  catalogue node.
- Retiring a resolution prevents new runs from selecting it but does not alter
  old run snapshots.
- Recompilation is rejected if no applicable active resolution exists.
- Remaining gaps are carried into the child run and presented normally.
- A child run that fails retains its parent link and applied resolution trace.
- Declining a request never marks the original clinical requirement as
  represented.

## Validation and testing

Database tests prove tenant isolation, operator-only transitions, idempotent
requests, valid state transitions, compatible resolution references, immutable
run snapshots, and parent-run lineage.

Rust tests prove that every registered adapter rejects incompatible nodes and
mappings, preserves source evidence, and never lowers an unresolved capability.
The clinician-work adapter must lower to the real `escalate.notify` contract;
the threshold adapter must reject unknown observations and incompatible units.

Control-plane tests prove request validation, labelled gap responses,
authorization, and recompilation input freezing. TypeScript tests prove known
and unknown gap presentation and request-state normalization.

The browser acceptance exercise uses the current heart-transplant guideline:

1. request `clinical.task` from a compiler gap;
2. resolve it in the operator portal using `escalate.notify` and its registered
   adapter;
3. return to the document and observe **Resolution available**;
4. recompile into a child run;
5. verify the trace names the frozen resolution and the clinician-directed
   recommendation no longer emits `unsupported_action_actor`;
6. verify unresolved threshold gaps remain visible and no draft is published.

## Delivery order

1. Gap labels and typed requestability registry.
2. Request and resolution ledger migration with RLS and transition tests.
3. Workspace and operator control-plane endpoints.
4. Operator request queue and resolution forms.
5. Workspace request/status/recompile UI.
6. Resolution snapshotting and compiler adapter boundary.
7. `clinical.task` to `escalate.notify` adapter acceptance slice.
8. Threshold adapter only after its supported observation contract is explicit.
9. Local browser acceptance, then VPS migration and deployment after approval.

## Non-goals

- Workspace users creating or editing catalogue nodes.
- Operators supplying arbitrary workflow JSON.
- Automatically generating executable nodes from a request.
- Treating a declined request as a successful compilation.
- Editing completed compiler runs or deleting their gaps.
- Publishing, enrolling, or executing generated drafts.
