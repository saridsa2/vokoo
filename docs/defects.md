# Defects

Found by driving the running app, not by reading it. Each entry says how it was
observed, so anyone can reproduce it rather than take it on trust — and so a fix
can be checked rather than assumed.

Each entry carries **Root cause** — the line that produces the behaviour, not
the file it lives in — and **Verify**, the check that says a fix worked. An entry
stays here until that check passes.

Every defect is also a GitHub issue; the number is on the entry.

---

## D1 — The sign-in dialog has no accessible name

**Issue:** [#7](https://github.com/saridsa2/vokoo/issues/7)
**Status:** fixed, verified 7 September 2026 — `auth-2.tsx` passes `title`, `standard-dialog.tsx:144` renders `<Heading slot="title">`, and line 178 adds an `aria-label` fallback.
**Found:** 6 September 2026, driving `localhost:3000` in Chrome
**Severity:** accessibility. A screen reader announces an unnamed dialog on the
one screen every user meets first.

React Aria says so itself, three times on every load:

```
A dialog must have a title for accessibility. Either provide an aria-label or
aria-labelledby prop, or render a heading element inside the dialog.

If a Dialog does not contain a <Heading slot="title">, it must have an
aria-label or aria-labelledby attribute for accessibility.
```

The accessibility tree confirms it — the dialog node carries no name:

```
dialog [ref_1]
 heading "Sign in"
 form
  label "Email"
  textbox "you@example.com"
  button "Continue"
```

**Cause.** `standard-dialog.tsx` renders React Aria's `<Dialog>`, and its `title`
prop is optional. `auth-2.tsx` passes no `title`; the sign-in screen renders its
own `<h1>Sign in</h1>` inside `children`. A plain `<h1>` is not a
`<Heading slot="title">`, so React Aria never wires `aria-labelledby`.

The heading is right there on screen. Only the association is missing.

**Root cause.**

Two halves, and either alone would be enough.

`standard-dialog.tsx:142` renders the title as a plain heading:

```tsx
{title && <h2 className="text-lg font-semibold text-primary">{title}</h2>}
```

React Aria wires `aria-labelledby` only from a `<Heading slot="title">`. An
`<h2>` is invisible to it.

And `auth-2.tsx` passes no `title` at all — the sign-in screen renders its own
`<h1>Sign in</h1>` inside `children`, where the component cannot see it.

So the fix belongs in the component: render the title as
`<Heading slot="title">`, and fall back to an `aria-label` when there is none.
Callers then get a named dialog without having to know the rule.

**Fix.** Either give `StandardDialog` an `aria-label` fallback when no `title`
is passed, or have it render its title as `<Heading slot="title">` and have the
sign-in pass one. The second is better: every dialog built on this component
then gets a name by construction rather than by each caller remembering.

**Verify.** Load any page while signed out, read the console. No React Aria
dialog warning, and the accessibility tree shows `dialog "Sign in"`.

---

## D2 — The console sends its bearer token to production over plaintext HTTP

**Issue:** [#8](https://github.com/saridsa2/vokoo/issues/8)
**Status:** open
**Found:** 6 September 2026, while establishing what a local test run touches
**Severity:** the access token is readable in transit; local testing writes to
the live database.

```
.env.local     NEXT_PUBLIC_CONTROLPLANE_API_URL = http://212.38.94.176:8081
api-client.ts  headers.set("authorization", `Bearer ${context.accessToken}`)

curl http://212.38.94.176:8081/health   -> 200
curl https://212.38.94.176:8081/health  -> 000   (no TLS listener)
```

Two problems in one line of configuration.

**The token crosses the network in the clear.** A Supabase access token, sent
on every request, over unencrypted HTTP to a bare IP. Anything between the
laptop and that host can read it — a café network, a corporate proxy, any
intermediate hop. This repo already made the equivalent argument when it
refused to put the token in a query string: *"it is written into every proxy log
between the browser and the server and stays there."* An unencrypted header is
the same exposure with fewer witnesses.

**"Running locally" is the UI only.** The API and the database are production.
Every create, update and delete performed while testing locally mutates live
data. There is no local control plane to point at — `localhost:8081` does not
answer.

That is why the 6 September test run was read-only, and it is a constraint on
every future one until this changes.

**Root cause.**

Configuration, not code. `.env.local` sets
`NEXT_PUBLIC_CONTROLPLANE_API_URL = http://212.38.94.176:8081`, and
`api-client.ts:83` attaches `authorization` to every request. There is no TLS
listener on that port — `https://` to it returns nothing — so `http` is not a
choice made in the config, it is the only thing that answers.

The second half, local testing writing to production, has the same single
cause: there is no other control plane to point at.

**Fix.** Terminate TLS in front of the control plane, the way the console and
the apex already are, and point `NEXT_PUBLIC_CONTROLPLANE_API_URL` at the
hostname rather than the IP. Separately, a local or staging control plane would
remove the second half — testing against production is a different problem from
testing over plaintext, and closing one does not close the other.

**Verify.** `curl https://<control plane host>/health` returns 200, `.env.local`
names it, and the console works unchanged.

---

---

## D3 — The schema editor misrepresents every nested schema, and says it is not doing so

**Issue:** [#9](https://github.com/saridsa2/vokoo/issues/9)
**Status:** fixed, verified 7 September 2026 — The editor renders a tree and the right pane prints the stored contract. `VoKoo Lab Report` shows `panel (object)` → `coding (array)` → `items (object)`.
**Found:** 7 September 2026, opening `WellAll Lab Report` on `/structured-outputs`
**Severity:** the right-hand pane makes a claim about what the model receives
that is false for these schemas.

`schema-detail-screen.tsx` reads a schema into a flat list of rows:

```ts
type: typeof property.type === "string" ? property.type : "string",
```

and its `TYPES` are `string | number | integer | boolean`. A property whose
type is `object` or `array` has no option to select, so the row renders as
**string**.

What is actually stored for `lab-report`:

```
results   array of object — code, value, referenceRange, interpretation, method
facility  object — id, name
specimen  object
```

What the editor shows: `results`, `facility`, `specimen`, all **string**.

The right-hand pane is worse, because it is confident. It is headed *"What the
model is shown — compiled from the fields, and identical to what a push
produces"*, and it renders `toSchema(fields)` — a recompilation of the
flattened rows. So it prints:

```json
"results":  { "type": "array" }      // no items: "send a list", of nothing
"facility": { "type": "object" }     // no properties
```

while the stored schema has all of it. The pane does not show what the model is
shown. It shows what would be stored if somebody saved this screen.

**Nothing is lost today**, because these rows are `origin = 'vendor'` and the
database trigger refuses the write. That is luck rather than design: any nested
schema arriving with `origin = 'console'` would be flattened on the first save.

**Root cause.**

`schema-detail-screen.tsx`, three lines that are individually reasonable:

```ts
const TYPES = ["string", "number", "integer", "boolean"] as const;   // :28
type: typeof property.type === "string" ? property.type : "string",  // :46
const compiled = useMemo(() => toSchema(fields), [fields]);          // :119
```

Line 46 reads the type correctly — `"object"` and `"array"` *are* strings, so
they pass through. It is the `<select>` at line 28 that has no option for them,
so the row falls back to displaying `string`.

Line 119 is the one that does damage. The right-hand pane is not the stored
schema; it is `toSchema` run over the flattened rows. So the pane headed *"what
the model is shown"* is showing a recompilation of a lossy read.

The deeper cause is stated in this repo already: the editor was built for a flat
object because *"a flat object is what a CRM row is, and the day that is not
enough the answer is a real schema editor rather than a half-nested one."* The
clinical schemas are that day, and they were seeded without it.

**Fix.** The screen must render a nested schema as a tree, read-only where it
cannot be edited, and the right pane must print the **stored** schema rather
than a recompilation. This was flagged before the schemas were seeded and not
done.

**Verify.** Open `WellAll Lab Report`. `results` reads as a list of objects with
its five fields, and the right pane matches
`src/lib/clinical-schemas.json` byte for byte.

---

## D4 — 44 of 45 clinical field descriptions are in Chinese

**Issue:** [#10](https://github.com/saridsa2/vokoo/issues/10)
**Status:** fixed, verified 7 September 2026 — 0 of 52 descriptions carry Chinese. `0119`'s `translate_vokoo_clinical_schema` walks the stored jsonb and translates every `description`.
**Found:** 7 September 2026, reading `patientId` on `WellAll Lab Report`
**Severity:** these descriptions are the instruction a model follows. They are
in a language nobody on this line speaks.

On screen:

```
patientId    关联健康档案 Person.id
```

Across the five seeded schemas, **44 of 45 descriptions** contain Chinese:

```
个人健康数据核心 Schema，参考 HL7 FHIR Patient 资源的最小可用字段。
全局唯一 ID（UUID/ULID）。
资源类型，固定为 Person。
```

This repo already established what that costs. A Hindi call kept returning
`patient_name: "सात्या"` because the field said *"exactly as they said it"* —
the model was obeying the description precisely. The conclusion recorded then:
**the descriptions are the semantics, and they are read by a model, so they
should be written the way you would brief one.**

They came from upstream `wellally-schemas`, which is written in Chinese, and
were inlined verbatim.

**Root cause.**

`scripts/inline-clinical-schemas.mjs` copies every `description` verbatim from
`vendor/…/infrastructure/schemas`, which is written in Chinese. The script
resolves references and drops `$defs`; it never looks at prose.

Nothing downstream checks either, which is why 44 of 45 reached a production
table without anyone seeing them. The inliner is the right place for the check —
it already walks every node.

**Fix.** Translate the descriptions in the vendored source and regenerate with
`npm run schemas:inline`, or override them in the inliner. The first is better —
the second puts a second copy of the semantics in a build script.

**Verify.** `node -e` over `src/lib/clinical-schemas.json` finds zero
descriptions matching `[\u4e00-\u9fff]`.

---

## D5 — The seeded schema descriptions cite a namespace the repo has retired

**Issue:** [#11](https://github.com/saridsa2/vokoo/issues/11)
**Status:** fixed, verified 7 September 2026 — Rows read `urn:vokoo:clinical:schema:…`. `0119` rewrites name, description and stored schema under `vokoo.pushing`.
**Found:** 7 September 2026, on the same screen
**Severity:** cosmetic, but it is provenance, which is the one thing that has to
be right.

The rows read *"Clinical contract from
`https://wellall.health/schemas/lab-report/v0.1.0`"*. The vendored source now
says `urn:vokoo:clinical:schema:lab-report:v0.1.0` — renamed in `d8c1fe7`,
after migration `0116` had already been generated.

So a seeded row cites a URI that appears nowhere else in the repository. This
was predicted before the migration landed and shipped anyway.

**Root cause.**

Ordering. The migration's description is built as
`'Clinical contract from ' || k.source`, and `source` was read from the artifact
**at the moment the migration was generated** — before `d8c1fe7` renamed the
namespace to `urn:vokoo:`. The artifact says `urn:vokoo:` today; the seeded rows
still say `https://wellall.health`.

Not a bug in the generator. A generated migration is a snapshot, and this one
was taken on the wrong side of a rename.

*(Checked while tracing this: the migration contains two `$ref` strings, and
both are inside a SQL comment explaining why references are inlined. No seeded
value carries one.)*

**Fix.** Regenerate `0116` from the current artifact as a new migration —
migrations are history and are not edited in place.

**Verify.** No row in `structured_outputs` mentions `wellall.health`.

---

## D6 — A cohort names a call flow as its care path

**Issue:** [#12](https://github.com/saridsa2/vokoo/issues/12)
**Status:** fixed, verified 7 September 2026 — `/cohorts` is empty — `0119` deletes any cohort whose flow is not a `care_path`, which a trigger could not do for an existing row.
**Found:** 7 September 2026, `/cohorts`
**Severity:** the cohort cannot run, and the row now also violates a constraint
that cannot see it.

`Chemotherapy — day care` lists its care path as **`Vayuveda main line`** — the
flow that answers the phone. A `call` flow, reachable only by
`trigger.call_answered`, selected into a column meant for a care path.

The cause was `cohorts.flow_id` referencing `flows` with no family constraint,
so the picker offered every flow in the workspace.

`0118` fixes it going forward — `cohort_uses_care_path_flow()` raises `23514`
unless `flows.family = 'care_path'`. But **a trigger only fires on insert and
update**, so this row survives. Worse, the next update to it fails: correcting
the cohort through the UI now depends on what the console sends.

Meanwhile `/care-paths` is empty, so there is nothing valid to point it at.

**Root cause.**

The original cause is gone. `cohorts-screen.tsx` now builds its picker with
`carePathOptions(flows)`, and `care-path-workspace.ts:21` filters
`flow.family === "care_path"`. `0118` refuses the write in the database as well.

What remains is only the row created before either existed. A trigger fires on
insert and update, so it cannot see a row already sitting there — and the next
update to that row will now fail with `23514`.

**Fix.** Either repoint or delete the row, and have the console's picker filter
on `family = 'care_path'` so it cannot be chosen again. A `not valid` check
constraint would also make the existing row visible rather than silent.

**Verify.** `/cohorts` shows no cohort whose flow is a `call` flow, and the
create dialog offers care paths only.

---

## D7 — The agent list prints a separator around a value that is not there

**Issue:** [#13](https://github.com/saridsa2/vokoo/issues/13)
**Status:** fixed, verified 7 September 2026 — `none@gemini · kookoo`. Moved to `src/lib/agent-display.ts` with `||` and `filter(Boolean)`.
**Found:** 7 September 2026, `/agents`
**Severity:** cosmetic, and a one-line fix.

Every agent's subtitle reads with an empty segment:

```
none@gemini · · kookoo
no transcriber · · kookoo
```

`agents-screen.tsx`:

```tsx
[
    (agent.transcriber_config?.provider as string) ?? "no transcriber",
    agent.model,
    "kookoo",
].join(" · ")
```

`agent.model` is empty for every agent here — an agent takes its model from its
engine, not from a column — and `join` prints the separator regardless. `??`
only catches `null` and `undefined`, so an empty string passes through it.

The first entry reads `none@gemini`, which is the transcriber provider for an
agent whose engine is realtime: there is no separate transcriber, and "none" is
being shown as if it were one.

**Root cause.**

`agents-screen.tsx:539`:

```tsx
[
    (agent.transcriber_config?.provider as string) ?? "no transcriber",
    agent.model,
    "kookoo",
].join(" · ")
```

`agent.model` is an empty string, not null — an agent takes its model from its
engine, so the column is never filled. `??` only catches `null` and `undefined`,
so the empty string survives, and `join` prints its separator around nothing.

**Fix.** Filter before joining — `[a, b, c].filter(Boolean).join(" · ")` — and
decide what `none@gemini` should say for a realtime agent, where the model both
hears and speaks.

**Verify.** No agent subtitle contains `· ·`.

---

## D8 — A flow whose trigger reaches nothing can be published

**Issue:** [#14](https://github.com/saridsa2/vokoo/issues/14)
**Status:** fixed, verified 7 September 2026 — `Lead capture` is draft. `0119` walks `p_graph->'transitions'`; `0120` unpublishes flows that were already inert.
**Found:** 7 September 2026, `/integrations`
**Severity:** an `integration.invoke` can name it, the invocation succeeds, and
nothing happens. A silent no-op is the failure shape this project keeps
recording — it looks like it worked.

On screen:

```
Lead capture      published      1 node · 0 routes      Invoked from another flow
```

One node and no routes. That node is the trigger, so there is nothing after it.
It is `published`, which means `integration.invoke` will accept it as a target —
`validate_flow_release` requires the target be *published*, and it is.

`validate_flow_release` checks a good deal:

- every node belongs to the flow's family
- an integration has exactly one `trigger.integration_invoked`
- that trigger names an enabled input schema in this workspace
- `integration.invoke` names a published integration in this workspace
- `validate_care_path_release` then checks each trigger's own config —
  an anchor and an integer offset for `trigger.due`, a positive interval for
  `trigger.recurring`, at least one observation for `trigger.reported`

**What it never checks is the graph.** No reachability, no terminal, no check
that an entry point leads anywhere. Every rule is about a node in isolation.

This is the same class as the two `validate_*_release` functions being pure
functions over `jsonb`: they are the right place for graph invariants precisely
because they already receive the whole graph. The check costs one traversal.

**Root cause.**

`validate_flow_release` iterates `p_graph->'nodes'` and checks each node against
the catalogue, the family, and its own required config. `validate_care_path_release`
does the same for trigger config.

**Neither ever reads `p_graph->'edges'`.** Every rule is a statement about one
node in isolation, so a graph with no edges at all satisfies all of them.

The traversal belongs there rather than in the console: both functions are pure
functions over the whole graph, so they already have what a walk needs, and a
rule the UI merely honours is one the next screen forgets.

**Fix.** In `validate_flow_release`, walk from each trigger over
`p_graph->'edges'` and refuse a trigger that reaches no terminal. `Lead capture`
should then be unpublishable until it does something.

**Verify.** Publishing a one-node flow raises `P0004`, and `Lead capture` is
either completed or no longer published.

---

## D9 — Retrieval returns the right chunk second, behind a wrong-topic one

**Issue:** [#15](https://github.com/saridsa2/vokoo/issues/15)
**Status:** open
**Severity:** acceptable for a compiler reading several chunks; a real limit for
anyone asking a direct question.

**Found:** 8 September 2026, NG28 uploaded to `/files` (131 pages, 555 KB,
indexed in under 40 seconds). The probe was chosen from the source **before**
upload, and worded so none of the answer's own vocabulary appeared in it:

```
query: what HbA1c target should someone on a medicine that can cause
       hypoglycaemia aim for
```

Ten results. The chunk carrying `48 mmol/mol` and `53 mmol/mol` came back at
**rank 2** (pages 10–14). Rank 1 (pages 14–18) is the continuous-glucose-
monitoring section, which mentions hypoglycaemia repeatedly and answers nothing
that was asked.

**Root cause.**

Chunk size. Measured across the ten results, each is **5,359 to 13,226
characters**, spanning four to six pages:

```
rank 1  pages 14–18    5,879 chars
rank 2  pages 10–14    5,784 chars   <- carries both thresholds
rank 4  pages  1–6    13,226 chars
```

That size is deliberate and it is the reason the *answer* is trustworthy: both
numbers sit in the same chunk as the condition that separates them — whether the
person is on a medicine associated with hypoglycaemia. A chunker that split them
apart would return something that looks right and means the wrong thing, which
is worse than ranking second.

So this is a trade already made on purpose, not an oversight. What it costs is
precision: a chunk spanning five pages carries a dozen unrelated
recommendations, and any one of them can carry the chunk above a better match.

**Fix.** Not "smaller chunks" — that would reintroduce the severing this design
avoids. Either retrieve at two granularities (a small chunk to rank, its parent
to answer), or re-rank the top handful against the query once they are back.
Both keep the large chunk as the unit of meaning.

**Verify.** The same probe returns the chunk containing `48 mmol/mol` at rank 1,
with the hypoglycaemia condition still in it.

---

## D10 — A copyright block is cited as clinical evidence

**Issue:** [#16](https://github.com/saridsa2/vokoo/issues/16)
**Status:** open
**Severity:** cosmetic, and it occupies a citation slot that should carry a
recommendation.

**Found:** 8 September 2026, in Workspace Intelligence's evidence for NG28. Four
of the five citations are real recommendations — 1.5.10, 1.10.1, 1.14.1 and the
title block. The fourth is:

```
"© NICE 2026. All rights reserved. Subject to Notice of rights
 (https://www.nice.org.uk/terms-and- Page 31 of conditions#notice-of-rights).
 131 Type 2 diabetes in adults: management (NG28) Initial medicines See the
 visual summary for..."          Page 31–36
```

**Root cause.**

NICE repeats its rights notice and a running header on **every page**, so the
extracted text carries that boilerplate throughout — it appears inside several
other chunks too, mid-sentence, which is visible in the search results. Nothing
strips repeated page furniture before chunking, so a chunk that happens to begin
on a page boundary opens with the notice, and the citation shows what the chunk
starts with.

It is not only cosmetic: boilerplate repeated on 131 pages is text the embedder
sees in nearly every chunk, which pushes chunks slightly closer together in
vector space and makes them marginally harder to tell apart.

**Fix.** Detect lines that repeat on most pages and drop them during extraction —
a running header and a rights notice are identifiable by recurrence, without
needing a rule about NICE specifically.

**Verify.** No citation begins with a rights notice, and `© NICE` appears in no
chunk body.

## Checked and not defects

Recorded so nobody spends time rediscovering them.

**The mark's canvas renders blank in a screenshot.** Chrome runs no
`requestAnimationFrame` in a backgrounded tab, so the WebGL canvas draws
nothing; it appears the instant the tab takes focus. The asset returns 200 and
three.js mounts — its own `THREE.Clock` deprecation warning is the proof. This
has now caused a wrong diagnosis twice in this project, once reported as a
performance crisis that did not exist. **A screenshot of a background tab is not
evidence about anything animated.**

**Escape does not dismiss the sign-in dialog.** Correct, not a bug: there is
nowhere to be dismissed to until somebody signs in.

**All thirteen console routes return 200** — `/`, `/dashboard`, `/patients`,
`/cohorts`, `/enrolments`, `/agents`, `/tools`, `/schemas`, `/calls`, `/runs`,
`/flows`, `/phone-numbers`, `/team`.

## Not yet tested

The 7 September run was **read-only**, because of D2: the local console talks to
the production control plane, so any create or delete lands on live data. So
nothing that writes has been exercised — the create dialogs on Patients,
Cohorts, Enrolments and Schemas, publishing a flow, or the composer canvas.

Opened and clean on 7 September: `/dashboard`, `/patients`, `/care-paths`,
`/cohorts`, `/enrolments`, `/composer`, `/agents`, `/tools`,
`/structured-outputs`, `/call-logs`, `/settings/organization`. No console
errors on any of them.

Also opened and clean: `/integrations`, `/phone-numbers`, `/team`.

Still unopened: `/skills`, `/runs`.

**8 September — document indexing.** NG28 (131 pages, 555 KB) uploaded to
`/files` and left in the workspace. Indexed in under 40 seconds; Workspace
Intelligence identified it as NICE NG28 including its February 2026 amendment
date and recommended the care path compiler at 95% with five page-ranged
citations. A natural-language probe chosen before upload returned the correct
HbA1c thresholds with their condition intact. Nothing was compiled, which is the
documented non-goal — the compiler is recommended, never invoked.

**A note on route checking.** The first sweep tested invented paths — `/schemas`
and `/calls` — and reported them 200 because a signed-out request redirects
rather than 404ing. Signed in, both are 404s that do not exist. The real
destinations come from `vokoo-nav.ts`: `/structured-outputs` and `/call-logs`.
All seventeen nav hrefs return 200.

`resize_window` reported success but the viewport stayed 1920x848, so the
responsive layouts are **untested rather than passing** — including whether the
sign-in dialog's left half hides correctly below `sm`.
