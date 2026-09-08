# The document care-path compiler

**Status:** Approved design. Not implemented.

This document defines the first production compiler: take one immutable,
indexed document version and create reviewable draft care-path flows and draft
agents from it. The uploaded NICE NG28 Version 1 is the first acceptance
document.

The compiler does not publish anything. It produces ordinary workspace drafts,
which remain subject to the existing agent and flow review and publish paths.

## Grounded platform boundary

The compiler may emit only registered, active catalogue components that support
the target flow family. The current care-path vocabulary includes:

- `trigger.recurring`, `trigger.due`, `trigger.document`, and
  `trigger.reported`;
- `outreach.request`, `outreach.call`, and `outreach.message`;
- `intelligence`, `care_path.record`, and `care_path.complete`;
- `escalate.notify`.

`outreach.request` already requires `what`, `instructions`, and `expires_days`,
and exposes `fulfilled`, `declined`, `expired`, and `failed`. The compiler can
therefore validate expiry and failure routes against real catalogue outcomes.

`escalate.notify` is a real component. Its handler creates a durable
`care_path_escalations` row through `notify_care_path_escalation`. That proves
trackable escalation work was created; it does not prove that a clinician
received a notification.

Document coordinates are also real. Chunks map to layout items carrying page
and bounding-box coordinates, and `get_document_layout` exposes them to the
console. A generated artifact can therefore highlight its source passage.

What does not exist yet is the compiler ledger, artifact provenance, evidence
links, gap storage, transactional materialization, or the stronger graph and
clinical-path validation described below. Those are requirements of this
design, not descriptions of the current system.

## Inputs

Every run freezes these inputs before model work begins:

1. `org_id`, requested by an authenticated workspace member.
2. The file and immutable `file_version` selected in Documents.
3. The version's active completed extraction and layout.
4. Version-scoped indexed chunks and embeddings.
5. The Workspace Intelligence recommendation for compiler `care_path`.
6. A snapshot and digest of active catalogue components.
7. Published workspace agents, schemas, tools, and integrations that the
   compiler may reference. Catalogue fields of type `template` accept inline
   rendered strings; the operator-only provisioning template table is not a
   tenant compiler input.
8. Workspace intelligence provider and model, with its credential resolved by
   the service-role worker from Vault.
9. Compiler version, prompt version, and retrieval profile.

The run never silently follows `current_version` or `active_extraction_id` after
it starts. A later upload or re-extraction creates a different input and must be
compiled by a different run.

For NG28 the worker consumes the stored 131-page Version 1, its Docling layout,
and its indexed chunks. It does not download or parse the source again.

## Outputs

A successful run creates:

- one or more `care_path` flows with `status = 'draft'`;
- every supporting agent with `status = 'draft'`;
- durable links from those drafts to the compiler run;
- evidence links from individual flow nodes and agent prompt sections to source
  chunks and layout coordinates;
- structured gaps for recommendations that could not be represented;
- an append-only execution trace;
- a run summary and source-coverage report.

One guideline can yield several coherent care paths. Each care path is one flow
with N registered trigger nodes. A single enormous NG28 canvas is not a success:
the supervisor should separate pathways whose population, anchor, or clinical
purpose is materially different. All artifacts still belong to one run and are
reviewed together.

`completed_with_gaps` may create valid drafts. A gap never permits an invalid or
partly materialized graph.

## Architecture

The agentic layer interprets the document. Deterministic code owns the platform
boundary and database writes.

```text
immutable document version
        |
        v
workspace intelligence routing
        |
        v
supervisor: map and delegate cited sections
        |
        v
evidence workers: typed recommendation IR
        |
        v
reconciler: deduplicate and propose care-path units
        |
        v
deterministic lowering against frozen catalogue
        |
        v
validation + transactional materialization
        |
        v
draft flows + draft agents + evidence + gaps
```

The model never inserts rows and never supplies arbitrary graph JSON to an
unvalidated write endpoint. It must call typed tools. Code parses the tool
arguments, checks them against the frozen inputs, lowers them into platform
graphs, and persists only accepted output.

## Compiler ledger

### `compiler_runs`

One row owns a compilation:

- organization, file, file version, and extraction IDs;
- compiler ID (`care_path` initially);
- status;
- provider and model;
- compiler, prompt, and retrieval-profile versions;
- catalogue digest and input snapshot;
- requester and timestamps;
- summary, coverage counters, and terminal error.

Statuses are:

```text
queued -> planning -> compiling -> validating -> materializing
                                                   |-> completed
                                                   |-> completed_with_gaps
any pre-terminal state ----------------------------|-> failed
any pre-materialization state ---------------------|-> cancelled
```

Status transitions happen through narrow database functions, not arbitrary
table updates. Only one active care-path compilation may exist for the same
file version and compiler version.

### `compiler_steps`

An append-only structured trace. Each row contains:

- run ID and monotonically increasing sequence;
- optional parent step;
- kind: `plan`, `retrieve`, `extract`, `reconcile`, `lower`, `validate`, or
  `materialize`;
- task key, objective, and physical page range where applicable;
- status, timestamps, and duration;
- typed input references and typed result;
- provider request metadata, token usage, and retry count;
- bounded, redacted error information.

This is the compiler thought trace. Hidden chain-of-thought and free-form model
reasoning are neither requested nor stored. The review surface shows decisions,
evidence, tool calls, validations, and refusals.

### `compiler_gaps`

Each omission is independently reviewable:

- run and originating step;
- stable code and severity;
- recommendation identifier;
- explanation;
- missing catalogue capability, resource, or evidence;
- source evidence;
- review status and optional resolution note.

Warnings are not gaps. A warning explains a safe choice the compiler made. A
gap means document intent was not represented.

### `compiler_artifacts`

This relation records generated workspace objects without adding
compiler-specific columns to every artifact table. It has an `artifact_type`,
the artifact's stable compiler key and role, and nullable foreign keys to
`agents` and `flows`. The materialization function requires exactly the foreign
key selected by `artifact_type`; deletion may set that key to null while
retaining the origin record.

Deleting a draft does not delete its run, steps, gaps, or evidence record. The
artifact relation may retain a tombstone key after the target is deleted.

### `compiler_evidence_links`

Each row links one compiler artifact target to one stored document chunk:

- compiler artifact ID;
- target path, such as `flow.nodes.hba1c-request` or
  `agent.system_prompt.monitoring-boundary`;
- chunk ID and cited excerpt;
- recommendation identifier;
- evidence role, such as `requirement`, `threshold`, `timing`, or `exception`.

The chunk's existing layout-item links provide the page and bounding boxes.
Coordinates are not copied into compiler tables.

## Agent harness

### Supervisor

The supervisor receives a compact physical-page map, headings, document
classification, and a bounded retrieval tool. It identifies actionable sections
and delegates non-overlapping, coherent tasks by recommendation structure, not
equal page counts.

It records excluded sections such as references, background, rationale, and
research recommendations. Exclusion is visible in the coverage report.

### Evidence workers

Each worker receives only its assigned pages, nearby structural context, the
relevant retrieved chunks, and the typed recommendation schema. It extracts:

- population and exclusions;
- anchor and timing window;
- event or observation;
- action and completion evidence;
- thresholds with operator and unit;
- failure, expiry, and escalation requirements;
- exact citations.

Workers emit an intermediate representation, not flows. Every clinical claim
must carry at least one citation from the frozen version.

### Reconciler

The reconciler deduplicates overlapping recommendations, identifies conflicts,
and proposes care-path units. It may connect requirements from separate
sections only when both are cited. Ambiguity becomes a gap rather than an
assumption.

### Deterministic lowerer

The lowerer resolves every intermediate operation to a registered component or
emits a gap. It supplies catalogue defaults, validates required fields, wires
real outcomes, resolves existing workspace resources, and assigns stable node
keys.

Generated agents are produced only where conversation is required. Their
system prompt and first message translate cited policy into conversational
behavior, with explicit scope and escalation boundaries. They may not add
clinical policy absent from the source. All generated agents remain drafts.

The first implementation uses the existing `intelligence` flow node for
structured extraction after a call or document. It does not add one
`structured_output_id` column to `agents`; a future direct agent-output contract
would need a many-to-many design.

## Validation

Validation has three layers.

### Catalogue validation

- Every component is active and belongs to `care_path`.
- Every required configuration value exists and matches its catalogue field.
- Every transition names real nodes and a real source outcome.
- Every generated agent reference resolves to an agent created in the run or an
  allowed published workspace agent.
- Every referenced schema, tool, integration, and template is allowed by the
  frozen input snapshot.

### Graph validation

The existing release validator proves only that a trigger has an outgoing
transition. The compiler must additionally reject:

- unreachable non-trigger nodes;
- transitions from nonexistent or incompatible outcomes;
- reachable closed cycles with no terminal exit;
- trigger branches that cannot reach work or a terminal outcome;
- duplicate stable node or transition identities.

Bounded catalogue loop components remain legal because their limits are
explicit configuration.

### Compiled clinical-path validation

For compiler-generated flows:

- every `outreach.request` `declined`, `expired`, and `failed` branch must reach
  `escalate.notify`;
- `intelligence.empty`, `intelligence.failed`, `care_path.record.failed`,
  `care_path.complete.not_found`, and `care_path.complete.failed` may not
  silently terminate in a generated clinical path;
- every extracted requirement marked `escalation_required` must lower to a path
  that reaches `escalate.notify`;
- every `escalate.notify` supplies a catalogue-valid recipient, urgency, and
  note;
- timing uses a supported anchor and explicit interval or window;
- thresholds retain operator and unit;
- an unsupported recommendation becomes a gap, never an approximate node.

These checks apply before materialization and again on publish. Rechecking at
publish prevents a human edit from bypassing compiler safety.

## Transactional materialization

A service-role database function accepts only a validated, run-bound compiler
program. In one transaction it:

1. locks the run and confirms it is in `materializing`;
2. confirms the frozen version, extraction, and catalogue digest;
3. validates artifact keys and tenant ownership;
4. inserts all draft agents;
5. resolves compiler agent keys to database IDs;
6. inserts all draft flows;
7. inserts artifact and evidence links;
8. inserts final gaps and coverage counts;
9. marks the run `completed` or `completed_with_gaps`.

Any error rolls back all workspace artifacts. The worker then marks the run
`failed` in a separate transaction, retaining its trace and safe diagnostic.

The browser cannot call the materialization function directly. It starts or
cancels an authorized run through the control plane; the document worker owns
provider access and service-role writes.

## Review surface

The Documents right pane remains the compiler control surface:

1. Workspace Intelligence recommends the Care path compiler.
2. The user chooses **Compile into workflow**.
3. The pane shows structured progress from compiler steps.
4. Completion shows generated flows, generated agents, source coverage, gaps,
   warnings, and failures.
5. Selecting a node or prompt section highlights its linked source passage.
6. Selecting evidence in the document opens the generated artifact target.
7. The user edits the ordinary drafts in their existing editors.
8. Publishing uses the normal permission and validation paths.

The UI never labels `escalate.notify` as a delivered notification. It says that
trackable escalation work will be created.

## Failure, retry, and cancellation

- Model/provider failures are retryable without repeating completed immutable
  steps.
- Invalid model output is rejected at the tool boundary and may receive one
  bounded correction attempt.
- A changed active document version does not mutate a running job.
- A changed catalogue digest before materialization fails the run and asks for
  recompilation against the new catalogue.
- Cancellation stops new model work. Materialization itself is short and
  transactional, so it is not interrupted halfway.
- Partial worker success remains in the trace but creates no artifact until the
  complete linked program validates.

## Tenant and data boundaries

- Every compiler row carries `org_id` and uses organization-scoped RLS.
- Authenticated users may read runs for their organizations and start a run if
  they can edit workspace drafts.
- Only the service role may claim jobs, resolve provider secrets, append worker
  steps, or materialize artifacts.
- Prompts contain only the minimum page ranges and chunks required by a task.
- Logs contain identifiers and bounded diagnostics, not document text or model
  prompts.
- There are no live patients or calls in the NG28 acceptance test.

## NG28 acceptance slice

The first vertical slice runs the supervisor over the whole uploaded NG28
version, but materializes only one clearly bounded pathway: HbA1c monitoring.
This deliberately exercises the complete architecture without claiming that
all 131 pages can be translated in the first iteration.

Acceptance requires:

1. The run freezes NG28 Version 1 and its active extraction.
2. Supervisor selections and exclusions cite physical pages.
3. Workers extract cited monitoring cadence and completion evidence.
4. The lowerer uses only current catalogue components.
5. At least one valid draft care-path flow and every required draft agent are
   created transactionally.
6. The flow contains real failure and expiry routes to `escalate.notify`.
7. Every generated node and clinical prompt section links to a source chunk and
   can highlight its PDF layout items.
8. Unsupported NG28 actions are stored as gaps.
9. No draft is published, enrolled, or executed.
10. A retry is idempotent and does not duplicate artifacts.

## Delivery order

1. Compiler ledger, RLS, and state-transition tests.
2. Artifact and evidence provenance plus transactional materialization tests.
3. Stronger graph and compiled-care-path validation.
4. Production harness using the existing AISDK/MiniMax provider boundary.
5. NG28 supervisor, worker, reconciliation, and lowering acceptance tests.
6. Control-plane start, status, cancel, and result endpoints.
7. Documents-pane progress, review, gaps, artifact links, and source highlighting.
8. VPS deployment followed by a signed-in NG28 browser test.

## Non-goals for the first slice

- Publishing generated agents or flows.
- Enrolling patients or executing generated care paths.
- Compiling all of NG28.
- Generating new catalogue components, tools, integrations, or schemas.
- Proving notification delivery beyond creating trackable escalation work.
- Persisting model chain-of-thought.
- Automatically propagating a revised guideline to existing care-path
  enrolments.
