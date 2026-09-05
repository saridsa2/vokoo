# Care paths — the model, and the vocabulary a compiler emits

Written 5 September 2026, at the end of a session that reached the model by
getting it wrong several times first. The wrong turns are recorded here
deliberately: each one is a plausible reading of the same words, and the next
person will make the same one unless the refutation is written down beside it.

Nothing in this document is built. Migration 0110 exists and one column in it is
wrong; see [What is already built, and what is wrong with it](#what-is-already-built-and-what-is-wrong-with-it).

---

## 1. The model, in the owner's words

> "The product is the ability to convert a patient journey to an agentic
> follower. What happens to a patient on chemotherapy, a diabetes patient, a
> postpartum mom, a guy on GLP — these are care paths that are defined in NICE
> guidelines. We take those and convert them into agents that are attached to a
> cohort."

> "One agent per care path, instantiated per patient in the cohort."

> "A care path is a flow. A flow contains a trigger, a flow contains steps, one
> of the steps could be an agent."

> "NICE and ICMR are guidelines. We give them the template — packs — and they
> are free to change it. We help with the customisation."

> "A compiler is also an agent. The compiler is platform level, that's our moat."

Stated as a chain:

```
a published guideline  (NICE NG194, NG28, CG151 …)
        │
        │  the compiler — itself an agent, platform level
        ▼
a care path            = one or more flows, each starting with a trigger
        │
        │  packaged
        ▼
a pack                 = care paths + voice agents + skills + tools
        │
        │  attached to a population
        ▼
a cohort               = one care path, and the patients on it
        │
        │  instantiated per patient, anchored to that patient's own dates
        ▼
a follower             reaches the patient, listens, escalates, records
```

### What each word means here

**Care path** — a flow. Not a new kind of object: a graph on the same canvas,
with a trigger and steps, one of which may be an agent. A condition needing four
triggers is four flows.

**Cohort** — one care path and the patients following it. Defined by its path.
A cohort holding patients on three different paths is the error the schema must
refuse.

**Pack** — what ships. Carries the care paths, the agents that speak them, the
skills they use inside a conversation, and the tools that reach outside it. A
customer takes a pack and changes what their department does differently.

**Compiler** — an agent. Reads a guideline, emits flows in the care-path
vocabulary. Platform level, not per organisation, because it is the moat.

**Follower** — a care-path agent instantiated for one patient. Its dates come
from that patient's own anchors, which is why enrolment carries a date.

---

## 2. Four readings that are wrong, and why

Each was held during the session that produced this document.

**"A care path is a schedule, not a flow."** It is a flow. It has a trigger and
steps like any other. What makes it a care path is its family and its trigger,
not a different shape.

**"A cohort names an agent."** It names a care path. The agents are the agent
steps inside the path's flows, which is why one care path has several without
anybody maintaining a list.

**"Chemotherapy is four care paths because it has four triggers."** That
arithmetic was invented. Read §4: the guidelines have several triggers each and
whether they group under one care path or several is a question this document
does not answer.

**"The compiler should refuse what it cannot convert."** It should *decompose*
into what the system can do. A neutrophil count is not a refusal:

> ask the patient to get bloods done → they upload the report → an agent reads
> the values out of it → the condition on `0.5×10⁹/L` runs → alert the doctor

Every step is a node. None of them is "we measure neutrophils." The same holds
for NG194's face-to-face midwife visit: not declined, but *ask her to attend*,
plus a contact to confirm she did, plus an escalation if she did not.

---

## 3. What the existing catalogue actually looks like

Read from `catalogue_node_types` and `docs/flow-node-catalogue.json`, not
remembered. **A vocabulary invented without reading these will violate all three
conventions**, which is what happened the first time.

### The `id` names the implementing subsystem

Dotted where a subsystem owns it — `kookoo.transfer`, `engine.listening`,
`tool.call`, `http.request`, `trigger.call_answered`, `agent.monitor`. Bare for
flow primitives — `condition`, `loop`, `var`, `code`, `agent`, `intelligence`,
`business_hours`. A namespace that names no subsystem (`contact.*`,
`escalate.*` as a category) is not this convention.

### `node_type` is a separate axis

The coarse canvas kind: `trigger`, `condition`, `loop`, `var`, `code`, `engine`,
and `custom` for almost everything with behaviour. The `id` says what it does;
`node_type` says how the canvas treats it.

### `suspends` means the node waits for the world

True on `agent`, `kookoo.conference`, `kookoo.collect_digits`, `agent.monitor`.
Today it means *wait inside a live call with the socket open* — seconds to
minutes. §5 is how a care path waits for days without changing that meaning.

### Field types the inspector can already render

`agent`, `structured_output`, `vendor`, `phone`, `branches`, `template`,
`weekdays`, `time`, `engine_provider`, `engine_model`, `engine_voice`, `select`,
`number`, `boolean`, `text`, `textarea`, `string`, `assignments`.

A new node should reach for these before inventing one, because
`ConfigFieldEditor` renders exactly this set and a field type it does not know
falls back to a text box — which is how `shape_id` once rendered as a UUID to
paste.

---

## 4. What three real guidelines actually demand

Downloaded and read, not recalled. **The reference `NICE NG151` that appeared on
the marketing site is invented** — CG151 is neutropenic sepsis; there is no
NG151 for chemotherapy.

| | |
|---|---|
| [NG194](https://www.nice.org.uk/guidance/ng194) | Postnatal care, 66 pp, published 2021, updated 9 June 2026 |
| [NG28](https://www.nice.org.uk/guidance/ng28) | Type 2 diabetes in adults: management, 131 pp, updated 18 Feb 2026 |
| [CG151](https://www.nice.org.uk/guidance/cg151) | Neutropenic sepsis in people with cancer, 24 pp |

### NG194 gives four triggers, cleanly

| trigger | recommendation | flow |
|---|---|---|
| transfer of care → **within 36 hours** | 1.1.14 | first midwife contact |
| transfer of care → **between 7 and 14 days** | 1.1.15 | first health visitor contact |
| birth → **at 6 to 8 weeks** | 1.2.7 | GP assessment |
| **a red-flag symptom is reported** | 1.2.4 | escalate without delay |

Two facts fall out of that table and neither was obvious beforehand:

**The anchor is not always enrolment.** Two count from *transfer of care*, one
from *birth*. A patient carries several anchor dates at once.

**Content is shared across contacts.** 1.2.1, 1.2.2 and 1.2.3 all begin *"at
each postnatal contact"* — general health, psychological wellbeing, infection,
pain, bleeding, bladder, bowel, breast, thromboembolism, anaemia, pre-eclampsia.
The four flows differ in when they fire and what they escalate to, and share
what they ask. That is why one care path has several agents.

### The four timing shapes, all from real text

| shape | example |
|---|---|
| deadline | *within 36 hours of transfer of care* (NG194 1.1.14) |
| window | *between 7 and 14 days*; *at 6 to 8 weeks* (NG194 1.1.15, 1.2.7) |
| state-dependent recurrence | *every 3 to 6 months until HbA1c is stable on unchanging therapy, then every 6 months* (NG28 1.5.1) |
| no clock | *seek medical advice without delay if any of these occur* (NG194 1.2.4) |

The third is the awkward one: its period changes with the patient's state, so it
is not an offset from an anchor at all.

### Thresholds are carried verbatim, never paraphrased

CG151: neutrophil count **0.5×10⁹/L or lower** *and* temperature **higher than
38°C**, or other signs consistent with sepsis. A paraphrase of a threshold is a
clinical change, not a wording change.

### Most of a guideline is not a contact

NG28 is 131 pages and the majority — dietary advice, medicine selection,
bariatric referral criteria — implies no patient contact at all. Extraction is
most of the compiler's work, and most of what it reads is discarded.

---

## 5. The proposed vocabulary

Drawn against §3's conventions. **Not built.** Every entry names the existing row
it copies.

### Triggers

`node_type: trigger`, `is_addable: false`, `families: {care_path}`, after
`trigger.call_answered`.

| id | fires when | fields | outcomes |
|---|---|---|---|
| `trigger.due` | an anchor plus an offset or window | `anchor:select`, `offset_days:number`, `window_days:number` | `due` |
| `trigger.recurring` | every N, until a state changes | `every_days:number`, plus `left`/`operator`/`right` as `condition` carries them | `due` |
| `trigger.reported` | the patient says something on a watch list | `watch:branches` — the shape `kookoo.collect_digits` uses for a variable branch set | via `outcomes_from` |
| `trigger.document` | a document arrives | — | `received` |

`anchor` is a `select` and not an assumption, because NG194 counts from transfer
of care and from birth.

### Reaching the patient

`node_type: custom`, `suspends: true`. Namespaced `outreach.*` because
origination is the subsystem, as `kookoo.*` is for in-call control.

| id | | fields |
|---|---|---|
| `outreach.call` | dial the patient and run an agent | `agent_id:agent`, `attempts:number`, `retry_hours:number` |
| `outreach.message` | send on WhatsApp or the app; no answer expected | `template:template`, `channel:select` |
| `outreach.request` | ask them to attend, get a test, or upload a report | `agent_id:agent`, `what:select`, `expires_days:number` |

All three return `reached` / `not_reached` / `declined`, so retries and the
coordinator's list are branches rather than a setting buried somewhere.

### Escalation

| id | | fields |
|---|---|---|
| `escalate.notify` | flag a clinician out of band — the doctor sees the abnormal result | `to:select`, `urgency:select`, `note:template` |
| `kookoo.conference` | bring a person onto a live call — **already exists** | — |

Separate on purpose: one is a notification, the other interrupts a live
conversation, and CG151 needs both.

### Reused unchanged, `families` widened only

`agent`, `condition`, `loop`, `var`, and **`intelligence`** — which already reads
a document into a schema via `shape_id` + `instruction`. Extracting a neutrophil
count from an uploaded report is that node with a different shape, not a new one.

---

## 6. Expiry, and why it removes the durable-wait problem

> "Any outreach request will have an expiry date — after which we will escalate
> and stop."

`catalogue_node_types.default_timeout_seconds` already carries this. The `agent`
node uses 600. An outreach request is the same column at a different scale.

So `outreach.request` suspends, but **bounded**: `fulfilled` when the document or
the attendance comes back inside the window, `expired` when it does not — and
that branch goes to `escalate.notify`.

This removes the problem rather than solving it. The scheduler must already wake
on a clock to fire `trigger.due`; a request running out is the same kind of
event as a patient's day 3 arriving. **One sweep answers both — what is due
today, and what has expired.** Nothing holds a socket open for a week, and no
durable-wait machinery is needed.

It also gives the product its defining property: a care path cannot silently
stall. Every outreach either completes or expires into an escalation, so a
contact that did not happen leaves a row and reaches a person.

**`expires_days` comes from the guideline where one is stated** — NG194's health
visitor window is 7 to 14 days, the GP assessment 6 to 8 weeks. The catalogue
default covers only where the guideline gives none.

---

## 7. What is already built, and what is wrong with it

**Migration 0110** — `patients`, `cohorts`, `cohort_patients`, with RLS.
**0111** — `org_id` on the enrolment, set by trigger from the cohort.
Both applied to the live database. Control-plane resources `patients`, `cohorts`,
`enrolments`; console screens under a `Care` nav section. Commits `98f50bf`,
`e79b92a`.

Verified against the live instance over HTTP with a real session: a cohort
cannot be created without its path; one patient on two cohorts carries two
different start dates; a duplicate enrolment is refused; another org's patient
is refused by trigger; as `authenticated` with no membership and as `anon`, all
three tables return zero rows.

### The one thing that is wrong

`cohorts.flow_id → flows`, `not null`. The column is right in kind — a care path
*is* a flow — and wrong in what it can reach: every flow in the database is
`call.answered` or `call.ended`, so the picker offers inbound answering flows and
post-call integrations, none of which is a care path. **A cohort created through
that screen names something that can never run.**

It is not fixed by repointing the column. It is fixed by §5 existing: a
`care_path` family, its triggers, and the picker filtered to it.

### Correct and unaffected

`patients` is identity only, which holds whatever a care path turns out to be.
`cohort_patients.started_on` is the anchor per patient, which §4 confirms is the
right shape — though §4 also shows a patient may need *several* anchors, and
today there is one.

---

## 8. Open questions

Not guesses. Each changes a migration.

**Does one care path carry several triggers, or is each trigger its own flow?**
`flows.trigger_event` is singular and `number_flows` binds one flow to one
trigger, so the system says one flow, one trigger. If chemotherapy is one care
path with four triggers, that column has to change.

**Where do several anchors live?** NG194 needs transfer-of-care and birth for the
same patient. `cohort_patients.started_on` holds one.

**Does the state-dependent recurrence fit at all?** *Every 3–6 months until
stable, then every 6* is not an offset from an anchor, and `trigger.recurring`
as drawn only approximates it.

**When an outreach expires and escalates, what stops?** That flow, or the
patient's whole care path? A missed bloods request probably should not cancel
their day-21 contact.

**Is the compiler's output a draft a human reviews on the canvas?** The pack
model and "we help with the customisation" both suggest yes, and that is what
the composer is for — but it has not been said.
