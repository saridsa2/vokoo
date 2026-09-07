# The care path compiler

**Status:** Design. Nothing built.

Second draft. The first one restated the brief and added three inventions
without marking them. This one leads with the constraint that kills most
designs of this thing, and marks every judgement that is mine rather than the
owner's.

## The constraint everything else follows from

**The compiler can only emit what the platform can already raise and run.**

A trigger is not a name. It is a name *and something that raises it*.
`trigger.call_answered` works because the carrier's webhook raises it. A trigger
the compiler invents has no producer, so the flow gets an entry point that can
never fire — a graph that looks complete and is dead.

The same holds for every node type. So the compiler's vocabulary is fixed
**before it reads a word of any guideline**, and the interesting work is not
generating structure. It is faithfully mapping a large messy document onto a
small fixed vocabulary, and **naming everything that would not fit**.

That is the moat, and it is a translation problem, not a generation problem.

### What the vocabulary actually contains today

Three triggers: `trigger.call_answered`, `trigger.call_ended`,
`trigger.call_failed`. All in the `call` family. There is no `care_path` family
and no clock trigger of any kind.

So today the compiler could emit nothing runnable. Every trigger a care path
needs is a thing to be built first, and the list below is that build order, not
a compiler feature list.

## The two kinds of trigger, and why the split matters

*(This cut is mine, not the brief's — the brief listed six trigger kinds as one
category.)*

**Clock.** A date, a window, a recurrence. We know when it fires. A sweeper
raises it. We control the timing, and it is reliable.

**World.** A patient makes contact. A document is uploaded. A state changes.
It arrives from outside, it must be matched to an enrolment before it means
anything, and **it may never arrive at all**.

On a care path a non-arrival is itself clinically significant — a patient who
does not answer a chemotherapy check-in is not the same as one with nothing to
report. So **every world event needs a clock event as its shadow**: the expiry.
That is what turns an absence into an event.

Which means the owner's rule — *any outreach request has an expiry, after which
we escalate and stop* — is not a safety detail bolted on. It is the mechanism
that makes world triggers usable at all, and it collapses "waiting for a
response" and "no response" into one shape: a request, a window, two exits.

## What is not a trigger

**"Patient reports a symptom" is not a trigger.** Nothing knows a symptom was
reported until something has listened. What arrives is a call or a message. The
trigger is *an enrolled patient made contact*; the symptom is a branch found by
the first step.

```
trigger: enrolled patient made contact
    → agent: what is this about?          ← classification happens here
        → symptom  → assess against the guideline's thresholds
        → question → answer, or escalate
        → neither  → escalate
```

Two consequences:

- **The classifier can be wrong.** A model can miss a symptom or invent one. So
  on a clinical path the `neither` branch cannot be "end" — it escalates. A
  missed neutropenic sepsis symptom is not a recoverable error. *(Mine.)*
- **The compiler supplies the list, not the judgement.** It extracts the
  symptoms the guideline names, with their thresholds and citations, into the
  schema the agent fills. What counts as a symptom is the guideline's decision
  and the citation stays attached.

## The output

**One draft flow.** A row in `flows` with `status = 'draft'` and a `graph` jsonb
holding nodes and edges, with N `trigger.*` entry points.

That is the artifact. Everything else is packaging:

- **Provenance rides in the nodes** — source, version, recommendation number,
  quote — because `nodes[]` is jsonb and it survives into `flow_versions.snapshot`
  on publish.
- **A compilation report**, which is the only genuinely new object: the
  recommendations that became nothing, the warnings, the assumptions, the gaps.
  A draft reviewed without the list of what was dropped has not been reviewed.
- **A `packs` row** ties it to the agents, schemas and tools it references.
  `packs` already exists (`0095`) with a version bumped when contents change and
  stamped onto every row the pack creates — its own comment says why: *"without
  it there is no way to tell which of forty clinics got the old prompt."* That
  is the versioning story, already built for another reason.

It goes out as a draft and is published through `publish_flow` like anything
else, so `can_release`, graph validation and the unpublished-agent refusal all
apply without new machinery.

## Architecture

Agentic front end, deterministic back end.

```
guideline
   │  agent: separate actionable recommendations from background
   │  agent: extract thresholds, units, operators, windows, citations
   │  agent: propose triggers, anchors, and a decomposition into operations
   ▼
proposal — a forced tool call against a fixed schema, never prose
   │  compiler: resolve each operation to a catalogue node type, or refuse
   │  compiler: build the graph, wire outcomes, attach provenance
   │  compiler: validate; refuse the pack on any invariant failure
   ▼
draft flow + report  →  human review  →  publish
```

The split is at the proposal because this project already learned that parsing
model output loses. `intelligence.rs` went through `json_object` (a reasoning
model replied with a `<think>` block), OpenAI's `json_schema` (rejected the
schema), and Anthropic's `output_config.format` (accepted, ignored, answered in
prose) before settling on a forced tool call, where the arguments come back as
an object by construction because there is no text to parse.

The agent never emits a graph. It emits a proposal; code builds the graph.

### What it must not author

**It must not generate agents.** Generating an agent means writing a system
prompt, and a system prompt for a chemotherapy check-in is clinical policy —
the one thing the brief says it must not invent. So it references agents, tools
and schemas by id, and declares the ones it needs but cannot find:

```
needs: an agent that can ask about neutropenic symptoms in Hindi — none found
needs: a tool returning the patient's next cycle date — none found
```

A gap is reviewable. A generated prompt is an unreviewable claim.

*(This narrows the brief, which listed "generate or reference the supporting
agents". It is my judgement that generate and the non-goal cannot both stand.)*

## Anchors

`cohort_patients.started_on` is day 0 for that patient — its migration calls it
the load-bearing column, because two patients enrolled a week apart are never at
the same point.

So the compiler emits **offsets from a named anchor** and declares which anchor
the path requires (`treatment_start`, `discharge`, `birth`,
`transfer_of_care`). It never emits an absolute date. A guideline needing an
anchor the enrolment cannot supply is a warning, not an assumption.

## Validation

Refusals, not judgement — each is a check on the graph.

1. Every trigger reaches a terminal.
2. Every world trigger has an expiry with its own branch.
3. Every care path has a reachable escalation. *(Mine — the brief listed
   escalation as an operation. `organizations.escalation_number` exists because
   inventing a destination is worse than admitting there is none.)*
4. Failure and non-response have branches.
5. Thresholds keep unit and operator. Units go through the UCUM vocabulary in
   the clinical schemas; `normalise_unit` refuses an analyte it has no molar
   mass for rather than converting with a guess.
6. Node types and config valid against the **pinned catalogue version**.
   *(Mine. `catalogue_node_types` moves — `0113` renamed a family, `0115` added
   two node types — so a pack compiled yesterday is not obviously valid today
   unless it says which catalogue it was compiled against.)*
7. Every referenced agent, tool and schema exists and is published.
8. Every anchor is one an enrolment supplies.

## When the guideline is revised

*(Mine. Not in the brief, and it may be wrong for a clinical product — see the
open question.)*

NG28 v2.2 lands while patients are mid-path on v2.1.

- A pack pins its guideline version as it pins the catalogue version.
- Recompiling produces a **diff against the previous pack**, node by node, with
  the recommendations that changed. A human reviews the diff, not the whole path.
- Enrolled patients finish on the version they started, unless migrated
  deliberately — the same shape as pinning a call to the flow version chosen at
  call start.

## The review surface

A canvas of boxes is not a review. Reviewable by a clinician means the
recommendation on one side and the nodes it became on the other, with the
citation and the extracted threshold visible **at the point of approval**, plus
the recommendations that became nothing. Warnings that are not visible where the
decision is made have nowhere to land.

## Build order

The compiler is last, not first. Nothing above it can be emitted until these
exist:

1. The `care_path` family.
2. Clock triggers — `trigger.due`, `trigger.recurring` — and the sweeper that
   raises them. This also raises expiries, so it is one mechanism.
3. Contact matching: an inbound call or message → patient → enrolment → care
   path → entry point. Today the bridge resolves a *dialled* number to a flow,
   not a *calling* number to a patient.
4. A document-request node and the upload path that raises its event.
5. A catalogue version to pin.
6. A care-path-invokes-care-path node, or reuse forces a split and the one-flow
   model breaks.

## Open questions

1. **Should a guideline revision propagate to enrolled patients?** I assumed
   not, by analogy with call version pinning. For a *safety* update the opposite
   may be required, and that is a clinical decision, not an engineering one.
2. **Which care path answers** when a patient enrolled on three makes contact?
   The agent asks, most-recent wins, or a triage flow dispatches.
3. **Partial expression.** A recommendation the compiler can express only in
   part — emit the partial nodes with a warning, or emit nothing and name it?
   Partial is more useful and more dangerous.
4. **Where does the compiler run?** It reads a document with a model, so it
   needs a provider key, which means the bridge — the only process allowed one.
   But it is not on the call path and nobody is waiting.
5. **Who may compile?** `can_release` gates publishing. Compiling produces a
   draft, so it may be a lower bar — but it costs model time and reads clinical
   material.
