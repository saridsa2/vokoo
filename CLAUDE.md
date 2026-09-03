# Where This Project Is — 1 September 2026

## Two engines answer the phone

Both shapes have carried real calls. A relay booked an appointment end to end on
1 September: `today` and `check_slots` ran, `book_appointment` returned a
reference, `finish_call` reported the outcome and the flow left the agent node.

**Sarvam beat ElevenLabs on this line, at both ends, measured on real calls.**

| | Sarvam | ElevenLabs | Deepgram |
|---|---|---|---|
| the name "Satya" | **exact** | — | invented a different name |
| reference `VY-2780-1100` | read clearly | broke up at the end | — |
| first audio | **0.051–0.203s** | 0.16s flash / 0.22–0.43s multilingual | — |

`bulbul` is trained on Indian speech, where reference codes and digit strings
are everywhere; ElevenLabs' models are trained for English narration and
interpret `VY-2780-1100` rather than spelling it. `eleven_v3` and
`eleven_v3_conversational` are both **403 on the streaming endpoint** — pre-flight
caught that before a call did.

ElevenLabs earns its place on an English line with English voices. This one is
Hindi. The engine model makes that two fields and no deploy, which is the point
of it.

## The phone works

Dial **+91 80408 02529**. It resolves the number to a flow, runs the flow, and
hands the caller to a Gemini Live agent. Verified on a real call: 27 seconds,
1329 media packets.

```
[flow] Open right now? -> open
flow reached agent node Reception (timeout 600s)
realtime mode — provider=gemini model=models/gemini-2.5-flash-native-audio-latest
session established
```

## A second way in: WhatsApp, through Asterisk

The phone is no longer the only wire. Asterisk 22 runs on the same VPS, takes
WhatsApp Business calls over SIP/TLS on 5061, and hands the audio to the bridge
over **AudioSocket** on `127.0.0.1:9092`. `docs/whatsapp-calling.md` is the
record; the short version is that `handle_call` now takes an `Incoming` —
a KooKoo WebSocket or an Asterisk TCP stream — and everything after the
handshake is one implementation.

Proven on a local call, not a WhatsApp one: the flow resolved, the agent node
was reached, **the Sarvam relay built and spoke**, and `VAD server: → Speaking
(confidence=1.000)` held for 71 seconds off audio arriving over the socket. This
file's "no relay has answered a real call" still stands — a Local channel is not
a caller — but the relay is no longer unexercised end to end.

**The lesson worth carrying:** AudioSocket is a *clocked* stream. The first
version wrote a frame only when the pipeline produced one, which is what the
WebSocket transport does, and every call ended after two seconds with
`app_audiosocket.c: Reached timeout after 2000 ms of no activity`. Silence has
to be sent. A 20 ms interval writes a frame every tick — queued audio if there
is any, 320 zero bytes if not. The same mistake is available to anyone adding a
third transport: **ask whether the wire is clocked before mirroring one that
isn't.**

## The four processes

| | Language | Where | State |
|---|---|---|---|
| console | TypeScript | `vokoo-console/`, localhost:3000 | running |
| control plane | Rust | `vokoo-console/server/` → `vokoo-cp-api` :8081 | running |
| database | PostgreSQL | self-hosted Supabase in Docker on the VPS | running |
| media bridge | **Rust** | `/opt/vokoo/rustvani`, bin `vokoo_bridge` → `vokoo-bridge` :8080 | running |

**The bridge is Rust and only Rust.** A Python through-layer existed and was
deleted on 30 August. Do not write Python for the call path.

## What I added to rustvani

`src/vokoo/` — flow execution, the only VoKoo-specific code in that crate:

- `graph.rs` — DID → published flow over PostgREST, plus the node registry.
  Every failure returns `None`, which falls back to the number's agent.
- `control.rs` — KooKoo call control (Conference, IVRTransfer, Hold,
  PauseMonitor, Disconnect). Key resolved from the vault per call.
- `runner.rs` — walks the graph. Opening hours in the business's timezone.

Also changed: `RealtimeEvent::ToolCall` added in `services/realtime/mod.rs`,
Gemini declares `finish_call(outcome, note)` and both transcriptions,
`vokoo_bridge.rs` resolves the flow before building the pipeline and continues
the flow when the agent reports an outcome.

## Config lives in the database, including the model

Numbers, flows, agents and **engines** live in the database, and change without
a deploy.

An **engine** is the chain a call runs through — `engines` table, `agents.engine_id`.
Edited on the composer's own board: `engine-detail-screen.tsx` mounts
`RecoveredEditorHost` with `shapeIsFixed`, which switches off the palette,
delete and edge drawing. The four `engine.*` node types are `is_addable: false`,
so the flow palette never offers them.

Two shapes, both built by the bridge:

- `realtime` — one model that hears and speaks (Gemini Live, OpenAI Realtime)
- `cascading` — a relay: `stt` → `llm` → `tts`, a different provider at each step

`src/vokoo/engine.rs` turns a row into processors. Every step resolves its own
key from the vault per call per org, so nothing in the call path reads a
provider key from `bridge.env` any more — including Gemini, which now takes the
organisation's vault key and falls back to `LLM_API_KEY` only when a call never
reached a flow.

**This section used to say the model id lived in three places that could drift.**
It no longer does: the bridge reads `engines.config`, and `catalogue_models` still
maps a friendly id to the provider's, so a provider rename is one `UPDATE`.
`LIVE_MODEL` / `LIVE_VOICE` / `PIPELINE_MODE` / `REALTIME_PROVIDER` remain, but
only as the answer for a call that never reached an agent node.

What an engine can be built from is a catalogue, not a literal:
`catalogue_engine_stages` — one row per `(stage, provider)`, carrying the
vendor to bill, the module in rustvani that implements it, and the models and
voices that step offers. A row there is a claim that
`src/services/<stage>/<provider>.rs` exists **and that the feature is in
`default` in Cargo.toml**. On 1 September `stt-gnani`, `tts-sarvam` and
`tts-piper` were not, so three catalogued providers were absent from the binary;
they are in `default` now.

**Ask the provider which models exist** rather than guessing:
`GET /v1beta/models` and filter on `bidiGenerateContent`.

## The agent editor has two tabs

It had eight. Voice, Transcriber, Analysis, Monitors, Compliance and Advanced
were each a panel of settings that the console wrote to `agents` and the call
path never read — verified against `bridge/src` and `server/src`. The bridge
takes four things from an agent: `name`, `system_prompt`, its skills, and
`engine_id`. Plus `first_message` since 1 September, which used to be
`GREETING_PROMPT` in `bridge.env` — one line for every agent on every number.

They were deleted rather than left implying they did something. What they
configured belongs to an engine, which the bridge does read.

## Pre-flight and discovery

Two mechanisms, and neither replaces the other. A relay was published on Sarvam's
`bulbul:v2` months after Sarvam retired it; the call connected, transcribed and
thought, and the caller heard silence.

- `POST /engine/preflight` **builds and runs the real processors** for 2.5s and
  reports what each provider said. An earlier version only constructed the
  handlers, passed the deprecated model, and was worthless — a cheaper imitation
  is a second implementation that can disagree with the first.
- `POST /catalogue/refresh` asks each provider what it offers and rewrites
  `catalogue_engine_stages`. Hand-typed lists are what put the retired model
  there. Runs every `CATALOGUE_REFRESH_HOURS` (12) inside the bridge, because
  it needs a provider key and the bridge is the only process allowed to read one.

Discovery only covers providers that publish a list — Sarvam publishes none,
which is exactly the provider that broke. Pre-flight covers every provider.

Both live in the bridge and are reached through the control plane, which gates
on the caller's organisation and forwards with `BRIDGE_INTERNAL_TOKEN`.

## Two security holes, found and closed on 1 September

Both were `SECURITY DEFINER` functions granted to `anon` — the key in the console
bundle, served to every browser. Verified against the live instance, not reasoned
about.

- **`resolve_vendor_secret`** returned HTTP 200 and the **decrypted** provider key
  for any org id. The Gemini and KooKoo keys were readable by anyone who could
  reach the host. Migration 0046.
- **`compose_agent_tools`** returned 2,009 bytes of any agent's tool schemas.
  Migration 0047.

The other thirteen definer functions granted to `anon` were swept and guard
properly. **The exposed keys have not been rotated.**

## A failed call escalates to a person

Three times on 1 September a caller was left listening to nothing: a relay on a
model Sarvam had retired, a sentence splitter that panicked on Devanagari, and a
menu key with nowhere to go. The bridge knew; the caller did not.

An **exception flow** is the answer, in n8n's sense of an error workflow: its own
graph on a `trigger.call_failed`, bound to a number the same way the answering
flow is, so many numbers can point at one. It needed no new machinery —
`number_flows` already keys on `(phone_number_id, trigger_event)` and
`resolve_for_event` already takes the trigger. Falls back to
`organizations.escalation_number` (set to **6309248884**), and a number with
neither gets today's silence, because inventing a destination is worse than
admitting there is none.

**It does not rescue the pipeline.** By then the broken thing is broken. What
makes it work is in the carrier's docs: *after the media stream ends the call is
still live*, and KooKoo asks what to do next on `event=Stream`. So escalating is
queuing a handover and letting the socket close — the same path a working
`kookoo.transfer` uses. Nothing has to survive the failure.

| Cause | Raised by | When it was seen |
|---|---|---|
| `engine_failed` | `build_relay` returns `Err` | the retired `bulbul:v2` |
| `provider_lost` | pipeline ends with an error, no agent outcome yet | — |
| `no_audio` | the Primer watchdog, at 20s | the 42-second hang |
| `crashed` | **nothing yet** — see below | the Devanagari TTS panic |

Twenty seconds is safe to act on because input frames arrive around fifty a
second whether or not anyone is speaking — silence is still frames — so it
cannot fire on a quiet caller, only a broken path.

`crashed` is declared and never raised. The TTS panic died in a spawned sub-task
that never reached the pipeline's result, and the input watchdog cannot see it
because *input* kept flowing; it was output that stopped. Detecting it needs an
output-side stall watch. The branch stays unwired rather than claiming a cause
nothing can detect.

**A bug the testing caught:** the fallback looked the number up with
`eq.918040802529` while the console stores `+918040802529`, so every escalation
without a bound flow would have found nowhere to go. It goes through
`graph::spellings` now, like everything else that resolves a DID. The number
itself goes through `control::dialable` — `0` plus ten digits, the shape
KooKoo's own `<dial>` example uses.

## What a call costs

**The counting already existed and was switched off.** rustvani carries a
`BillingCollector` trait, a `SessionBilling` accumulator with a background
drain, a `BillingStorage` back-end, a `PostgresBillingStorage`, and per-provider
instrumentation in openai, sarvam, deepgram and gnani. `db-postgres` is in
`default`, so all of it has been compiled into every binary this project has
shipped — receiving `None` at every call site, because nothing ever handed a
handler a collector. Survey before building, again.

What was actually missing was price, and somewhere to write.

- `src/vokoo/billing.rs` — a `BillingStorage` over **PostgREST**, not the
  upstream Postgres one, which needs a `tokio_postgres::Client`: the database
  is in Docker with no port on the host, and publishing one would be a
  `docker-compose.yml` override an upgrade reverts plus a second way in for a
  process that already has one.
- `catalogue_vendor_rates` — what a vendor charges, per unit of the thing it
  meters. No two are the same: OpenAI bills input and output tokens separately,
  Sarvam and ElevenLabs bill characters, transcription bills audio duration,
  the carrier bills the call. So the unit is part of the rate.
- `billing_usage` → `billing_priced_usage` → `call_costs` → `engine_costs`, and
  routes for the last two plus the rate card.

**Every rate is deliberately null.** Writing prices from memory into a table
that produces invoices is the one thing this must not do. Until a figure is
read off a vendor's own page and entered, `call_costs.unpriced_items` counts
the unpriced quantities and `unpriced_vendors` names who to go and price —
because a call nobody has priced and a call that cost nothing are different
facts, and reporting the second as the first is how a wrong invoice goes out.

### What is measured, and what is not

| | stt | llm | tts | carrier |
|---|---|---|---|---|
| relay (cascading) | **yes** | **yes** | **yes** | no |
| realtime (Gemini, OpenAI) | — | **no** | — | no |

`src/services/realtime/*.rs` contains no `BillingCollector` at all, so **a
realtime call currently records nothing**. Nothing emits `call_second` either,
so the carrier's own charge is unmeasured on every call. Both rates exist in the
card and both are waiting on a producer. Said plainly here because a cost report
that silently omits a whole engine shape is worse than one that admits it.

Piper reports nothing on purpose: it synthesises on our own hardware and has no
vendor invoice to attribute.

### Three things the testing caught

- **PostgREST rejects a bulk insert whose objects disagree on keys**, with a 400
  naming nothing. Transcription, thinking and synthesis events naturally have
  different fields, and all three go up in one checkpoint on every call — so the
  ledger would have failed to write, always. Every row now carries every column
  with nulls, and a test asserts the key sets match.
- **A Postgres view runs as its owner and bypasses the RLS of its tables**
  unless `security_invoker` is set. All four views were created that way and
  granted to `authenticated` — every organisation's costs, readable by any
  signed-in user. This is the same shape as `resolve_vendor_secret`, and it does
  not announce itself: a view says `SECURITY DEFINER` nowhere, it is simply the
  default. Migration 0056. **Any view over a table with RLS needs that line.**
- **ElevenLabs TTS was the one handler with no billing hook**, because it was
  written here. An ElevenLabs engine would have read as costing nothing.

## Realtime has an engine builder now

`build_relay` turned an engine row into processors; realtime had no
counterpart. A realtime session was constructed **inline in the WebSocket
handler** — one `if provider == "openai" { .. } else { .. }` branch each,
repeating the vault lookup, the environment fallback and the connect — while
pre-flight built a *different* session in `realtime_probe`, which knew only
Gemini. An OpenAI engine therefore failed pre-flight whatever its state, and the
two builders could disagree about a Gemini one in either direction.

That is the fault this file already records against the first pre-flight — "a
cheaper imitation is a second implementation that can disagree with the first".
It was fixed for relays and left standing for realtime.

`build_realtime(engine, ctx, RealtimeRequest { .. })` in `engine.rs` is now the
only way a realtime session is made, and both callers use it. 86 inline lines
left the binary. The Gemini half of the tool adapter — `gemini_declaration` and
`gemini_outcome` — moved beside `declare`, so both halves of one adapter finally
sit in one file.

**It found a bug on its first run.** Pre-flight had been failing
`Gemini Live (native audio)` with

    The requested combination of response modalities (TEXT) is not supported
    by the model. models/gemini-3.1-flash-live-preview

because the probe passed `transcribe_only: true`, which asks for a TEXT-only
session. An engine that has carried real calls was being reported broken for a
reason no caller could reach. A probe now opens exactly what a call opens; it
sends no audio and closes at once, so there is nothing to keep quiet. All four
engines pre-flight green.

### OpenAI Live can call tools now

Migration 0045 withdrew it on a rule that still holds and a fact that no longer
does. All three halves are implemented against OpenAI's own documentation:

- **declaring** — `session.tools[]` with `session.tool_choice`, **flat**:
  `{type, name, description, parameters}`. Not the nested
  `{type:"function", function:{..}}` chat completions takes; same vendor, two
  APIs, and each rejects the other's shape.
- **receiving** — `response.done` carries the call as an output item with
  `type:"function_call"`, `name`, `call_id`, and `arguments` as a JSON
  **string**. That arm used to be `"response.done" => TurnComplete` and the
  payload went in the bin. Arguments that do not parse are dropped rather than
  dispatched: a tool run on `{}` is a lookup against nothing that reads as an
  answer.
- **answering** — `conversation.item.create` with
  `{type:"function_call_output", call_id, output}` where `output` is the
  serialised string, then a **separate** `response.create`. Without it the model
  holds the answer and never speaks — the same trap `send_text` already had.

Four tests pin those shapes. `catalogue_engine_stages` has `realtime:openai`
active and `supports_tools = true` again (0057).

### Usage is recorded, and deliberately not priced

`response.done` also carries `usage`, out of the same discarded payload. Totals
are stored; the modality split is logged and not, because
`BillingEvent::LlmUsage` carries two numbers and realtime meters five things —
audio and text tokens in each direction, plus cached input at a reduced rate.

**The realtime rate rows say `DO NOT PRICE YET`** for that reason. Multiplying an
audio call's totals by a text rate is wrong by roughly an order of magnitude,
which is the confidently wrong invoice the rate card was shaped to prevent.
Pricing needs `input_audio_token` / `input_text_token` / `input_cached_token`
units and an event that can carry them. Sanity check from the docs: user audio
is 1 token per 100 ms, assistant audio 1 per 50 ms.

### Discovery was writing realtime models where nothing read them

The composer's realtime node reads `catalogue_models`, and `build_realtime`
resolves an id through the same table — while discovery wrote every stage's list
onto `catalogue_engine_stages.models`. For realtime that was dead data:
`realtime:gemini` carried five entries nothing consulted while the console
offered the two rows in `catalogue_models`, free to disagree indefinitely.
Realtime discovery now writes to `catalogue_models`.

Asking the provider found nine OpenAI realtime models and five Gemini ones,
including `gpt-realtime-2.1` — none of which had to be typed from memory. Two
filters came out of reading the results: **`gpt-realtime-whisper` matched
"realtime"** and would have sat in the dropdown as a conversational model, and
Gemini declares `bidiGenerateContent` on its live *transcriber* too.

**And it broke a working engine, which pre-flight caught.** The upsert wrote the
friendly id into `provider_model_id`, and Gemini serves `bidiGenerateContent`
only under `models/gemini-…` — so `Gemini Live (native audio)` went from ok to
"not found for API version v1beta" in one refresh. Discovery now carries the
provider's own id alongside the friendly one. The lesson is narrower than "be
careful": **a discovered list must not overwrite a hand-maintained mapping**, and
the only reason this was a five-minute fix rather than a dead line is that
pre-flight builds what a call builds.

### What OpenAI Live still needs

- **`response.function_call_arguments.delta` is ignored.** The complete call in
  `response.done` is enough to dispatch on, and is what is used. Streaming the
  arguments would let a slow tool start sooner; nothing needs it yet.
- **One voice is catalogued.** `alloy`, the value the handler defaults to and
  therefore the only one known to work. OpenAI publishes no voices endpoint, so
  discovery cannot help and pre-flight is the only check — offering an
  unverified name would put a call one dropdown away from failing.
- **It has never answered a real call.** Everything above is tested, pre-flighted
  and unexercised by a caller.

## The dashboard is the present tense, and it is pushed

`/dashboard` is the landing route. Four numbers, what is on the line, and who
can take a call.

**The live band is half of it. The other half is history, in charts.** The
first version had neither charts nor history, the user said so, and it was
written down here as a rule forbidding them — the exact inversion of what was
meant. Recorded because the mistake is instructive: "no X" said about a screen
under construction is a complaint about an absence, not a prohibition, and the
way to tell them apart is to ask.

Three charts, from `calls` through `/api/v1/dashboard/history`: **calls a day**,
**time on the phone**, and **when the phone rings** — the last one bucketed by
hour of the day, which is the staffing question. Recharts was already a
dependency.

Aggregated in the control plane rather than in SQL. A view over `calls` would
need `security_invoker = true` or it runs as its owner and hands every
organisation's calls to any signed-in user — the fault migration 0056 already
found here once, and a view announces it nowhere. Counting a few hundred rows in
Rust cannot have that bug at all.

**Every day in the window is returned, including the empty ones.** A chart drawn
only from days that had calls draws a straight line through a quiet weekend and
reports business as steady.

**Chart colour is `var(--color-fg-brand-primary)`, never a hex.** This system is
achromatic: the accent is ink on light and eggshell on dark, so a literal would
give a chart invisible in one of the two modes. Recharts takes `var()` for every
colour prop. Its default tooltip is a rounded white card — another project's
styling, like the borrowed editor's eight radii — so it is restyled square.

**History is a plain GET, refetched when the day's count moves** — which is to
say, when a call ends, which is exactly what the stream announces. Same event,
both halves, still nothing on a timer.

**Server-Sent Events end to end. Nothing polls.**

```
console  ←  /api/v1/dashboard/stream   gated on the org, adds the day's counts
         ←  /events/live               bridge, x-vokoo-internal
         ←  ARI + the bridge's own registries
```

Every registry announces rather than waiting to be asked: a call starting, being
attributed, gaining a human or ending, and Asterisk saying an endpoint moved.
The day's figures are recomputed when a bridge frame arrives, which is exactly
when they can have changed — a call ending is the same event that moves both
numbers, so one push carries both.

A frame is a whole snapshot, never a delta: a reconnecting browser has not seen
the previous ones, and a snapshot cannot be applied to the wrong state.
`broadcast` rather than `watch`, so a lagging subscriber is told to re-read.

**`EventSource` cannot send headers**, and every route here needs
`authorization` and `x-org-id`. The alternative was the access token in a query
string, which is where a bearer token must never be — it is written into every
proxy log between the browser and the server and stays there. `use-event-stream.ts`
reads the stream with `fetch` and does the four lines of framing itself.

One thing ticks locally: a live call's timer, from a clock in the browser rather
than a request. Measured from when the frame landed rather than from an absolute
start time, so a browser whose clock disagrees still counts the right seconds.

### The plausible wrong source, measured before building on it

`calls where ended_at is null` reads like "live now" and is not. The table has
three rows still marked `in-progress` from calls that died on 2 September and on
the morning of the 3rd, so that query counts every crash this line has ever had —
and the number only grows.

| Fact | Read from | Not from |
|---|---|---|
| calls up right now | `live::LiveCalls`, registered in `handle_call` | `calls`, per above |
| a person is on this call | the same registry, set at the escalation | — |
| agent online / offline | `GET /ari/endpoints` | `agent_extensions.status`, which is employment |
| answered today | `calls`, counted in the control plane | the bridge, which keeps no history |

`LiveCalls` sits in `handle_call` because that is the one place **every** call
passes through on either wire. `stasis::Switchboard` holds only what Asterisk is
bridging, so a KooKoo call on the direct WebSocket is invisible there. Entries
are held by a `Drop` guard, so an early return, a `?` and a panic all remove the
call without any of them having to remember.

Presence is refreshed when Asterisk says something moved, never on a clock —
`PeerStatusChange`, `ContactStatusChange` and `EndpointStateChange` all become
one `AriEvent::EndpointChanged`, which is a prompt to re-read rather than a
payload to interpret. Asterisk emits more than one of them per registration, so
`Presence::replace` announces only when something actually differs.

### Two facts that look like one

**Every live call has an AI on it, including the escalated ones** — the AI stays
in the bridge muted, taking notes. So "with a person" is a subset of "live", not
a column beside it, and the labels say so.

**An agent's `status` is not their availability.** Active/suspended is
employment; online/offline is a SIP registration living in Asterisk's memory.
A suspended agent whose registration has not expired is genuinely still
reachable for a few minutes, so the roster shows both rather than picking one.

### `resource.select` applied to the list and nothing else

`agent-extensions` leaves `sip_password` out of its column list because SIP
digest auth needs the plaintext and it cannot be hashed. Only the list route
honoured that — `get_resource` selected `*` and create and update returned `*`,
so the password came back on every detail load. All four use the resource's own
list now. Every other resource selects `*`, so nothing else changed. Verified
against the live instance: the detail response carries nine columns and not that
one.

### Team is two screens, not one

`Manage → Team` provisions — add, suspend, rotate — and `/team/{id}` is where the
last two live. The roster with presence is on the dashboard, because who is on
duty is a fact about the line rather than about the roster.

**"Today" is the viewer's browser timezone**, labelled on screen. UTC would reset
the day at half past five in the morning for an Indian clinic, and there is no
`organizations.timezone` to consult — worth adding the day two people in
different places need to agree on the number.

**Unverified: the push half in a browser.** Nine tests cover the registries, ARI
was read against the real switch, and the first frame arrives on connect. Nobody
has yet watched a row flip from off duty to on duty without a refresh.

## The console shows what exists

Nine navigation items across two sections became two, on the same test the
eight agent tabs were cut by: does anything write what this reads?

Nothing wrote `issues`, `monitors`, `notifiers`, `boards` or `chats` — no code
in the bridge or the control plane touches any of them, and all five were empty.
`session-logs` had no table at all and its own code comment said so. `Test
Suites` had no writer, and the Evals screen's own "LLM evals" tab rendered a
box reading *Not built yet*.

**Evals → Runs, moved to Observe.** The screen described itself as judging a
call "two ways: what the agent said, and what its tools did" and kept neither
promise: one half was unbuilt, and the working half is not a judgement — nothing
scores anything. It records that `check_slots` ran, took 56 ms and returned
`ok`. `/evals` redirects to `/runs`, carrying the query, because every tool's
page links there with `?tool=`.

The tables all stay. Only menu items and one placeholder tab went, so any of it
is one line to bring back — and `boards` is the one to expect soonest, now that
`engine_costs` exists to fill it.

### Tool arguments and results *are* recorded — this file said twice that they were not

`call_events.detail` has held them all along:

```json
{"args":   {"doctor": "cardiologist", "slot": "2026-09-03T16:00", "patient_name": "सात्या"},
 "result": {"booking_id": "VY-2780-1600", "booked": true},
 "invocation": "live"}
```

30 tool executions across 14 calls. Which settles the reference-number
question that was left open as unverifiable: the tool issued **`VY-2780-1600`**
and the agent spoke `VY-2780-160`. **The model dropped the trailing zero** —
confirmed, not inferred. The fix stands as written: `book_appointment` should
return a spoken form beside the raw reference, because reading digits back is
something a model does unreliably and a tool cannot get wrong.

The lesson is about the audit, not the bug. Two claims were made here today
about data not existing, and both were made without looking. The screen that
would have answered it in ten seconds was in the navigation the whole time,
under a name that described something else.

## Tools are code, and the SDK is better than its gaps

`docs/tools-sdk.md` is the study. `packages/sdk/README.md` says how to write a
tool and `docs/specs/2026-09-01-functions-sdk.md` says why it is shaped that
way — both good, neither stale. What the study adds is the thing this project
keeps rediscovering: **which parts of a good contract are wired to nothing.**

Built: `defineTool`, both schema directions, the whole CLI
(`login logout whoami init new pull push dev run logs`), `tool_versions` with
checksums, the dispatcher, and 30 live executions recorded with their arguments
and results.

**`ctx.secrets` is always `{}`.** The SDK declares it, the README documents it
as "resolved per invocation", `run` types and forwards it, and the dispatcher
passes an empty object. Nothing has ever put anything in it. So **no tool that
needs a credential can work** — which is every integration with anything.

Not hard to close: credentials are in `vendor_credentials`, the vault decrypts
through `resolve_vendor_secret`, and since 0046 only `service_role` may call it
— which the dispatcher holds and the `run` isolate deliberately does not. The
dispatcher is the right place. **This is the first thing to build before any
integration work**, because a canvas that draws a CRM tool which cannot
authenticate is worse than no canvas.

### A composer canvas should generate code, not interpret a graph

The spec already forbids the console editing a *pushed* tool, for a good reason:
"a pushed tool's authority is a repository; editing it here would make the
console a second author, and the next `vokoo push` would overwrite what was
typed without saying so."

That does not block a canvas — it names the design. A pushed tool's authority is
a repo; a composer tool's authority is **the graph**, and its code is a build
artifact. Two authorities, never for the same tool. `tools.kind` already
separates them and carries no constraint, so no migration is needed.

First version: three node types — `tool.input`, `http.request`, `tool.output` —
with `{{ input.field }}` templating and **no expression language**, because
input → request → return needs no branching. Plus a `family` column on
`catalogue_node_types` so the palette can filter, which Integrations will reuse.

`decompileSchema` exists precisely because "a tool made in the console has a
schema on the server and no source anywhere" — the round trip was designed
before it was needed. The eject path is `vokoo pull` writing a stub with the
existing id; `pull` is implemented and whether it does that is unverified.

## Post-call flows run

`call.ended` was a constant in `graph.rs`, a node type in the catalogue and a
bindable row in `number_flows`, and **nothing had ever resolved it** —
`resolve_for_event` was called with `call.answered` and `call.failed` and
nothing else. A post-call flow could be drawn, published and bound to a number,
and would never run. It runs now, from the `Hangup` webhook.

```
trigger.call_ended  →  intelligence  →  http.request
                       shape:  ▾ Lead      url, credential
                       model:  ▾ MiniMax
```

**The shape is n8n's**, arrived at by studying it: a node says *what*, and what
it points at says *how*. n8n attaches that as a sub-node because a workflow
carries its own configuration. We point at a row — `structured_outputs` for the
shape, a connected vendor for the model — which is what the agent node already
does with `agent_id`. Same shielding, no sub-node machinery on the canvas.

**Nobody is waiting**, which inverts every constraint the call path works
under. A tool has 2 seconds; this has 60. What it does not have is a second
chance from the carrier, so the *order* matters more than the speed: the
reading is written to `calls.analysis` **before** anything is sent. A restart
loses a delivery and never the data — most of what a durable queue buys, for
none of the machinery. The queue can arrive the first time an outage costs
something.

`refused` (4xx) and `unavailable` (5xx) are separate outcomes because they
retry differently. Retrying a 400 is a bug that looks like resilience.
Delivery is at-least-once, so the call id goes out as an `Idempotency-Key` —
without one a retry is a second lead in somebody's CRM.

### Retention is the business's, not ours

`organizations.retention_days`. A clinic and a travel agency answer differently
and both are right, so it is a column and not a policy. Null keeps everything,
which is what happens today — and **nothing has ever been deleted**: there is no
retention anywhere, on calls, transcripts, recordings, events or billing.

It covers a call's *content*. The row itself stays, because that is what
billing counts. One thing to fix before a sweeper is written:
**`billing_sessions.transcript_json` holds a second copy of the transcript**,
added on 1 September, so a policy applied to `calls` alone would leave it
behind. Billing does not need it.

### `calls.recording_url` is no longer empty

Not because no recording existed — `<start-record/>` has been in the answering
XML from the beginning, and the carrier hands the URL over on `Hangup`. Nothing
read that event, so nothing stored it. It is stored now, whether or not a
post-call flow exists, because the URL expires at the carrier and the moment it
is offered is the only moment it can be kept.

### What is proven, and what is not

Proven with a synthetic `Hangup` against a real call row: the flow resolves and
walks, the trigger branches on `caller_hung_up`, the intelligence node refuses
correctly when no key is connected, the flow follows its `failed` branch, and
the webhook classifies a 405 as `refused` rather than something to retry.

**An extraction has run.** MiniMax filled a six-field shape from a seven-line
transcript, correctly — `patient_name: "Satya"`, `intent: "book"` matching the
enum, a usable summary.

### The shape is enforced by a forced tool call, and getting there took three tries

Each failure was measured, not reasoned about:

1. **OpenAI-compatible `json_object`.** MiniMax-M2 is a reasoning model and
   replied with a `<think>` block. The obvious next move was to strip tags and
   balance braces — a parser that is wrong in a new way every time a model
   changes.
2. **OpenAI's `json_schema`.** Refused the schema outright: *"In context=(),
   'additionalProperties' is required to be supplied and to be false."* Its
   dialect needs `additionalProperties: false` everywhere, and `strict: true`
   additionally makes every property required — which would turn every optional
   field in somebody's shape into a mandatory one.
3. **Anthropic's `output_config.format`.** MiniMax serves the Messages API
   *shape* at `https://api.minimax.io/anthropic/v1` but does not implement this
   field: the request is accepted, the field ignored, and the model answers
   *"Based on the phone call, here is the information:"* in prose.

**A forced tool call gets the guarantee from a mechanism both implement.** One
tool whose `input_schema` is the shape, `tool_choice` requiring it, and the
arguments come back as a JSON object *by construction* — there is no text to
parse, so there is nothing to strip, balance or repair. It works unchanged
against Anthropic proper.

`host()` therefore knows two providers and both take the same request. OpenAI is
deliberately absent: supporting it means translating a shape into its dialect,
which is worth doing when somebody wants OpenAI and not worth doing to have a
second way to do this.

**A schema constrains types, not semantics.** `appointment_at` was described as
"ISO 8601 if an appointment was agreed" and came back as `"day after tomorrow
4 PM"` — a string, which is what the schema asked for. Whoever writes a shape
should know the description is guidance and the type is the contract.

## Post-call flows are buildable in the console

Three gaps stood between the runner working and anyone using it, and the first
was not about post-call at all.

**Flows could not be created.** The workspace listed them, the composer edited
them, and nothing made one — the single flow that existed was inserted by hand.
`Create Flow` was a button that did nothing, which is why nobody had noticed.

It now asks the one question that decides everything else: **when does this
run.** Three things follow from the answer and none can be changed casually
afterwards — which trigger node the graph opens with, which nodes the palette
offers, and which `number_flows(phone_number_id, trigger_event)` row binds it.
The new graph carries the trigger and nothing else: a starter full of nodes
somebody did not ask for is a graph they must read before they can begin, and
the palette is the better teacher now that it only offers what belongs.

**`shape_id` rendered as a box to paste a UUID into.** The same problem the code
had already solved for `agent` and written down: *"a node that names an agent
should offer the agents… getting that wrong is invisible until a call reaches
the node."* One more `valueType`, one shared picker.

**There was nowhere to define a shape.** `structured_outputs` had a table, a
route and columns, and no navigation entry — so SQL was the only way. It has a
screen now, under **Build** rather than Observe, because a shape is authored
rather than watched.

The screen edits **fields, not raw JSON**: name, type, description, required —
deliberately the vocabulary the tools SDK already uses for a tool's inputs,
because they compile to the same JSON Schema and are read by the same kind of
model. It will not express nesting; a flat object is what a CRM row is, and the
day that is not enough the answer is a real schema editor rather than a
half-nested one.

Verified by creating both through the API exactly as the screens do.

## The composer is two boards

`Composer > Calls` and `Composer > Integrations`, over one `flows` table, split
by what a flow responds to. Not one list with a filter: a flow answered while
somebody is listening and a flow that runs after they have gone share a canvas
and almost nothing else — different palettes, different triggers, different
bindings.

**Which is what removed the question from the create dialog.** The board you
opened already answers "when does this run", so the dialog asks for a name and
nothing else. A radio button there would let somebody make an integration from
the calls board and then wonder why the palette refuses a transfer.

The board's back link follows the family too, so an integration returns to
Integrations — landing on the calls list would look like it had been filtered
out.

## Schemas are declarable in code, like tools

`defineSchema` in the SDK, `vokoo new --schema`, and `vokoo push` sends them
beside the tools. Deliberately the same shape as `defineTool` — an authored
UUID, a name, a description written for its reader, and fields compiled by the
**same `compileSchema`** a tool's input goes through. One vocabulary, one
compiler, one set of refusals.

The difference that matters: a tool ships **code** that must be stripped of
types, checksummed and executed; a schema ships a **declaration**. So there is
no `tool_versions` row, no checksum over a body, and nothing whose behaviour
could drift from its description.

`push_schemas` (0060) mirrors `push_functions`: same membership guard, same
authored-id rule, and `created`/`updated`/`unchanged` so the tenth push of the
day shows only what moved. Verified in that order against the live instance.

The console's screen is now **Schemas**, not Shapes, and it lists both — the
ones written there, and the read-only ones a pushed tool declares. A tool's
schema is shown and not edited, for the reason the SDK spec already gives: its
authority is a repository, and editing it here would make the console a second
author whose work the next push silently overwrites.

**Why one registry rather than a field on each node**: a shape is wanted by more
than one thing. A tool declares what it takes, an intelligence node fills one in,
a webhook sends one on. Written separately they drift, and the drift is
invisible until a payload is rejected by something nobody told.

## Locked, and why it is a column rather than a habit

Anything pushed from the CLI is **locked** unless the source says
`locked: false`. A locked tool or schema is refused for editing in the console.

The SDK spec already stated the rule — *"the source is shown and not edited; a
pushed tool's authority is a repository"* — and nothing enforced it. A console
edit to a pushed tool was accepted and then silently discarded by the next
push, which is the worst shape a failure takes: it looks like it worked.

Enforced by a trigger, not by the console, because a rule the UI merely honours
is one the next screen forgets. The push says who it is with a
transaction-local `vokoo.pushing` setting rather than by being recognised as a
role — several things run as the same definer.

**Testing it found the hole.** `set_config(…, true)` is transaction-local, and
a script that pushed and then attempted a console-style edit *in one
transaction* had the edit accepted. In production they are separate requests,
so it never fired — which is luck, not design. `end_push()` now closes the
window at the end of the push body (0064).

`locked: false` is a real choice, not an escape hatch: a developer scaffolds a
schema and wants the team refining field descriptions where they can see the
calls.

## `origin` is not `locked`, and conflating them left a hole

`locked` says whether the console may edit a thing. **`origin` says whose it
is.** The first version had only the lock, and the trigger deliberately allowed
`locked` itself to be written — a push has to be able to release a row whose
source now says `locked: false`. Which also let the console unlock a
CLI-pushed schema, edit it, and lose the edit on the next push regardless. The
lock was a suggestion.

With origin the rule is sayable:

| | |
|---|---|
| `console` | the console may lock and unlock it. Locking is somebody saying "this is settled"; unlocking is the same person changing their mind. |
| `push` | the console may **not** unlock it. Its authority is a repository — release it at the source with `locked: false`, or delete the file to take it over. |

Verified across every branch: locking and unlocking a console-made schema are
allowed; unlocking a pushed one is refused with the message that says where to
go; editing a pushed one is refused; and a push carrying `locked: false`
releases it so the team can edit it.

On screen: a lock **icon** on the card rather than a word, because a column of
"locked" reads as noise. And the Unlock button is **absent** on a pushed
schema rather than disabled — offering a control the database will refuse is
worse than offering none.

## A tool may name a schema, by id

Two columns on `tools`, always both:

| | |
|---|---|
| `schema_id` | the reference — what the author said |
| `schema` | the snapshot — what was pushed, and what the model is shown |

The reference is a plain id so that **a tool written in a file and a tool drawn
on a canvas produce the identical thing**. The alternative considered was
resolving a TypeScript import at push time and inlining the result, which works
until a tool has no TypeScript — at which point the composer needs a second way
to say the same thing and the registry has two dialects.

The rule that came out of it, and it generalises: **the authoring format must
never be load-bearing.** Anything the push has to parse in order to understand a
relationship is a thing a canvas cannot produce.

The snapshot stays because a pushed tool's contract has to be concrete. Keeping
both is what makes drift *visible*: the schema editor lists the tools that named
it and says their snapshots were taken at push time — a question neither column
answers alone. `on delete set null`, so deleting a schema never takes a working
tool off a live line.

## The schema editor shows what the model is shown

`/structured-outputs/{id}` — fields on the left, the compiled JSON on the right,
recomputed as you type. The same two-column shape as the tool editor.

The right pane is why it is a screen and not a dialog. **The compiled schema is
what the model actually receives**; the rows are only how you write it. Whether
`required` landed where you meant is a question about the JSON, and until it was
visible beside the fields the answer arrived when a call failed.

`toSchema` there follows the same rules as the SDK's `compileSchema` on purpose
— a preview that disagreed with what the push produces would be describing a
schema nothing runs.

## The reader is the workspace's

MiniMax is the **workspace intelligence provider** —
`organizations.intelligence_provider` and `intelligence_model`, defaulting to
`minimax` / `MiniMax-M2`.

It was `provider` and `model` text fields on every intelligence node, so an
organisation with four post-call flows carried four copies of one decision, and
changing what reads your calls meant opening four boards and hoping you found
them all. The same mistake as putting the schema on the node, which the registry
already fixed.

**No per-node override**, deliberately. One can be added the day somebody wants
a stronger model for one flow; having it now costs the property that there is a
single answer to "what reads our calls". The node keeps `shape_id` and
`instruction`, which are genuinely its own.

The provider must serve the Anthropic Messages API — `anthropic` or `minimax` —
because the shape is enforced by a forced tool call rather than by parsing. A
provider outside that list fails with a message saying so.

**Not yet settable in the console.** The columns exist and the bridge reads
them; nothing writes them but SQL. That is the next small piece, and Configure
is where it belongs — it is a choice about what the workspace runs on, not
something authored.

## The post-call flow is live on the number

`CRM Push` is published and bound to `+918040802529` for `call.ended`, beside
`Vayuveda main line` on `call.answered`. Two rows in `number_flows`, one number.
The graph is two nodes — `trigger.call_ended → intelligence` reading into the
`Clinic lead` schema. No `http.request`: the webhook node was already proven
against a live endpoint, and pointing it somewhere real would send a clinic's
caller data to a third party to prove a thing already proven. The reading lands
in `calls.analysis`.

Replaying a finished call is the way to test it without dialling — the bridge
takes the same path a real hangup does:

```bash
curl -s "localhost:8080/kookoo?event=Hangup&sid=<provider_call_id>&called_number=918040802529&disconnect_reason=user_disconnected"
```

**A reader with no clock invents a year.** The first real reading of the 1
September call returned `2024-09-03T16:00:00` — the caller said "परसों, तीन
सितंबर" and never said a year, so the model supplied one. This is the same fault
the `today` tool exists to fix on the live call, arriving one layer along, and it
is worse here: nobody hears a CRM field read back. `intelligence.rs` now opens
the message with the call's `started_at` and says dates are relative to it. The
same transcript then read `2026-09-03T16:00:00+00:00`, and filled a sixth field
it had skipped.

**Anything a model writes into a record needs the facts the transcript omits.**
The date was the first; the caller's number and the business's timezone are the
next two nobody has needed yet.

## The composer had a second copy of the node catalogue

Every complaint about the post-call nodes on the canvas — a field labelled
"Shape to fill", a credential as a text box, a schema shown as a UUID, an
outcome that "ends the call" after the call ended — came out of one fact:

**`docs/flow-node-catalogue.json` is a checked-in snapshot of
`catalogue_node_types`, imported by `architecture-model.ts` at build time, and
it was being edited by hand.** Nothing compared the two. A migration to the
table changed nothing anybody could see.

The drift it was hiding, all of it found by writing the comparison:

| | |
|---|---|
| `intelligence` fields | table 2, console 4 — `provider` and `model`, which stopped being read when that node took its model from the workspace |
| node types | table 19, console **24** |
| `outcomes_from` | absent from the snapshot, so a digit menu's author-written branches were invisible to the console's own outcome resolver |
| `kookoo.pause_recording` | withdrawn in the table, still in the palette |

The four `engine.*` types account for four of the five extra: this file said
they were catalogue rows with `is_addable: false`, and **they were not rows at
all** — the engine board drew four nodes the database had never heard of.
Migration 0069 puts them in, copied from the snapshot rather than rewritten so
the first sync is a no-op for them.

`npm run catalogue:sync` regenerates the file from the table;
`npm run catalogue:check` exits 1 when they disagree and is what to run after
any migration that touches the catalogue. It goes over ssh and psql because it
runs without a browser session.

**The snapshot stays** — `NodeType` is a TypeScript union built from its keys,
and a union cannot come from a fetch. What changed is that it is now a build
artifact of the table instead of a second copy of it. A control-plane route was
written for this and removed again: nothing but the sync would have read it, and
the sync has no session.

It carries every row now, including inactive ones. Dropping a withdrawn type
from the file would not hide the node, it would stop any board already using it
from rendering — so `is_active` travels with the row and the palette is what
respects it. `is_addable` and `is_active` are separate facts: the first is "the
palette never offers this" (a trigger, an engine stage), the second is "this is
withdrawn".

### What the inspector could not draw

`ConfigFieldEditor` had no `select` at all. `getFieldOptions` read `[id, label]`
tuples and returned `[]` on every field in the catalogue, because no row has
ever carried that shape — it was written against an imagined one. So a fixed set
of answers had nowhere to go and became a text box.

- **`select`** — `method` is now the three verbs `webhook.rs` actually branches
  on. It matches PUT and PATCH and falls through to POST, so offering GET would
  have sent a POST and said it sent a GET.
- **`vendor`** — the connected providers. `connectedVendors` was already in the
  editor's context and the engine board already filled it; the flow board never
  did, which is why a credential was a dropdown on one screen and a text box on
  the other. The value shown is the vendor id, because the id is what the bridge
  resolves.
- **`textarea`** — `instruction` and `body` are prose and JSON.
- A `.config-input select` rule did not exist either, so every list in the
  inspector — agent, schema, engine provider, model, voice — had been rendering
  as an unstyled native select next to styled inputs.

**`help` was shown only as a placeholder**, which disappears at the first
keystroke — exactly when a sentence explaining what to type is still worth
reading. It is printed under the field now, and the placeholder no longer
repeats it.

### Two more the same pass turned up

**A card chip printed the raw id.** `nodeConfigSummary` is a pure function with
no access to the name lists, so it rendered `Schema to fill:
5a000000-0000-4000-8000-000000000001`. It takes a lookup now and reads
`Schema to fill: Clinic lead`, falling back to `unknown (5a000000)` when the row
is gone — wrong visibly rather than invisibly.

**`flow-diagram.ts` computed edge labels from `NODE_TYPES[...].outcomes`**
rather than `outcomeForNode`. For a node with `outcomes_from` the lookup misses
and falls through to the raw outcome id, so a menu's edges read "1", "2", "#"
where the author wrote "English", "Hindi". The canvas recomputes labels on every
render and hid it on screen, but the wrong label is what landed in the `Diagram`
and went back out through `diagramToFlowGraph`.

## Expressions, and who is allowed to run one

`src/vokoo/expression.rs`. n8n's model, because it is the reason n8n's nodes
compose: a parameter is either a literal or an expression, expressions are
written `{{ … }}` against a few named roots, and **one** evaluator sits behind
all of them. IF, Set, Loop and every HTTP field draw on the same machinery, so
learning it once is learning all of them.

| | |
|---|---|
| `$json` | the previous node's output |
| `$('Process call')` | a named node's output |
| `$call` | caller, transcript, duration, recording, started_at |
| `$vars` | what a `var` node has set |

**A leading `=` marks a field as an expression** — n8n's own encoding. One
character, no migration, and every config written before today stays a literal
by construction. A value that is *entirely* one `{{ }}` keeps its type, so
`={{ $json.score }}` is the number 8 and not `"8"`; that is what lets an
expression fill a JSON body without quoting every number.

### The engine never answers the phone

`vokoo_bridge` answers the phone **and** runs integrations in the same process,
so an evaluator linked into it shares an address space with the media path —
and the carrier ends the call if the bridge's socket errors. Author-written code
must not run while somebody is on the line.

Two independent gates, because a rule enforced in one place is one the next
screen forgets:

- **The catalogue.** `code` is `families = {post_call}`, so the Calls palette
  never offers it (0071). It had been on both boards.
- **The runner.** `Scope.evaluation` is `Paths` or `Script`. `runner.rs` builds
  the first, `postcall.rs` the second, and both go through the same `resolve`.
  `={{ $json.score * 2 }}` is `16` on an integration and `null` on a call — not
  refused, *not executed*. There is no second implementation to drift, which is
  the fault this file already records against the first pre-flight.

Boa is the engine: pure Rust, so no C toolchain enters the build of the binary
that answers the phone. Three properties it is configured for, each with a test:

- **`spawn_blocking`, not a plain call.** The engine is synchronous CPU work and
  an integration runs on the same tokio runtime carrying live audio. On a worker
  thread it would block that worker; the blocking pool is a separate one.
- **Loop and recursion limits.** `while (true) {}` returns null and the flow
  carries on. Straight-line code cannot run forever, so between the two there is
  no program that never finishes.
- **The scope is `JSON.parse`d inside the engine**, never pasted into the
  program. Pasting would make anything a caller says executable: a transcript
  containing `"); throw new Error('run'); ("` stays a string.

### Proven on a real call

A webhook wired after `Process call`, replayed against the 1 September call,
sent:

```json
{"patient":"सात्या","doctor":"cardiologist","caller":"+919949879837",
 "seconds":90,"named_node":"book","computed":83}
```

— `$json`, `$call`, `$('Process call')` and real JS (`$json.summary.length`) in
one body, the number unquoted so the JSON parses. The node was removed
afterwards: it pointed at a listener on the VPS itself, because demonstrating a
mechanism is not a reason to send a clinic's caller data anywhere.

`webhook.rs::fill` is gone — it was this, without the roots or the language, and
keeping it would have been the second implementation again. The URL resolves too
now, so `=https://crm/leads/{{ $json.patient_id }}` is a path a flow can build.

### `cargo test` was dead again

Not from this work. `gemini_check.rs` and `live_latency_bench.rs` built
`GeminiLiveConfig` field by field and were never updated when it gained four,
and **a test target is all-or-nothing** — so the whole crate's tests had stopped
running, exactly as they did after the ElevenLabs vendoring. Both spread
`..Default::default()` now, so the next field added cannot repeat it.
**396 tests pass.**

## Set gathers, the webhook sends

`var` was "Set a value" — one name, one value, which reads as a scratch
variable. What a flow needs before it sends anything is to *shape* a payload:
take several values from earlier steps, give each the name the receiving system
expects, hand the result on. n8n's Set node, and the reason it exists —
**gathering is a different job from sending**.

So `var` is now **Set values**, holding a list of `{name, value}` rows
(`assignments`, the same shape `branches` has on the keypad node, for the same
reason: how many there are is the author's decision). `src/vokoo/setvalues.rs`
resolves each row against the scope and its output *is* the object it builds.

The consequence is the point: **a webhook after it needs no body at all**, since
an empty body already means "send the previous step's output". What is being
sent stops being buried in a textarea and becomes a node you can read.

Proven end to end on the 1 September call, with the webhook's body left blank:

```
[set] 6 value(s) from 'Set lead'
BODY {"contactName":"सात्या","phone":"+919949879837","seconds":90,
      "source":"phone","speciality":"cardiology","whenISO":"2026-09-03T16:00:00"}
```

`patient_name` → `contactName`, `doctor` → `speciality`. The reading's names on
one side, the CRM's on the other, meeting in one node.

### A node says what it produces

`catalogue_node_types.output` (0073): `none` | `call` | `schema` |
`assignments` | `opaque`. The expression picker walks backwards from the node
being edited and asks.

The first version filtered the board for `intelligence` nodes, which was a
special case wearing a general shape and got three things wrong at once: a Set
node produced the payload and was invisible; nodes on an unrelated branch were
offered as if they had run; and the one producing node appeared **twice**, as
`$json` and again under its own name, because nothing knew they were the same
node. Walking fixes all three, and adding a node type now costs a catalogue row
rather than a console change.

`opaque` is deliberate for `http.request` and `code`: they produce something
whose shape is not knowable until it runs, and a guessed list would be paths
that resolve to empty.

Two more duplications the walk itself then showed, both fixed:

- **A trigger's output is the call**, so `$('Call ended')` listed the same ten
  fields `$call` already offers. Nodes whose output is `call` are skipped in the
  named list.
- **The picker rendered under every expression field at once** — six copies in a
  Set node, longer than the inspector. It now appears only under the field being
  edited, with `onMouseDown` prevented on the chips so clicking one does not
  blur the field and take the panel away before the click lands.

### What the console can author now

A Fixed | Expression switch on every field that can hold either, which is the
whole of the encoding — flipping to expression prepends `=`, flipping back
strips it, and what was typed is carried over rather than thrown away. Excluded:
`branches` and `assignments` (lists of rows, each carrying its own switch), and
`agent` / `structured_output` / `engine_*`, whose values must be real ids for
pre-flight and the palette to work.

**`CALL_FACTS` in the console is a second copy of a contract `postcall.rs`
owns.** The panel first offered the `calls` table's own columns — `to_number`,
`duration_seconds` — none of which exist at runtime, so an expression would have
saved, published and resolved to empty. It is one table now, name beside column,
rather than a list of names in one place and a translation in another.

**`$vars` is declared and nothing writes it.** With Set's values reachable as
its output and by node name, a separate variable namespace is a second way to
say the same thing. The resolver supports it and is tested; said here rather
than left to look implemented, like `crashed`.

## The config pane switches on which canvas it is

The editor was borrowed from another project — an architecture diagramming tool
— which is why it is one generic inspector for every board. Four canvases mount
it and they are not the same: **Engines**, **Call composer**, **Integrations**,
and Tools when it exists.

What a field may hold is not a property of the field. `language` is a string on
an engine step and a string on a flow node; what differs is whether anything
precedes it.

| board | the pane offers | because |
|---|---|---|
| Engines | pickers and literals | an engine is a chain of processors — nothing precedes a step |
| Call composer | literals | `runner.rs` builds no `Scope` and records no node output |
| Integrations | expressions, picker, sample call | `postcall.rs` carries a `Scope` |
| Tools | later — roots are the tool's input, not a call | not built |

`BoardContext` is **passed by the screen that mounts the canvas**, not sniffed
from the graph. Sniffing is what caused the bug this found: `familyOf` read

    if (trigger?.type.startsWith("engine.")) return "engine"

and an engine board has no trigger node at all, so the branch could never fire
and **every engine board reported itself as a call board**. Corrected to look at
its own nodes; the context no longer depends on it either way.

**What that bug was about to cost:** a Fixed | Expression toggle had just been
added to every text field on every board. On an engine board and on the call
composer that is an expression which saves, publishes, and resolves to empty on
a real call — the same fault as offering `$call.to_number`, and the one this
file keeps recording: it looks like it worked. Verified after the fix: zero
toggles on the engine board, zero across all seven nodes of the answering flow,
present on the integration.

`boardTakesExpressions` is one function and `call` is one line in it. It becomes
true the day `runner.rs` carries a scope, and not before.

### The engine canvas is for configuring, not authoring

Stated plainly because the code kept forgetting it: an engine board has no
trigger and never will — the canvas exists so a chain can be configured, not
drawn. Two things still spoke to it as if it were a flow:

- **The port's tooltip and screen-reader label** said "Nothing is wired to
  'audio', so the call ends here" while the visible row said "to the caller".
  The visible text had been fixed for a fixed shape and the other two had not,
  so the accessible name made a claim about a flow on a canvas that is not one.
- **The connector dot was still drawn.** `startEdge` refuses on `shapeIsFixed`,
  so it was an affordance for something that cannot happen. It is not rendered
  there now.

Verified after: the realtime board shows one card reading `audio → to the
caller` with no handle, and the relay board still draws its three steps and the
edges between them.

**An aside worth re-checking:** `Hindi relay (Sarvam)` is published on
`bulbul:v2`, which this file records as the model Sarvam retired and the cause
of a silent call. Pre-flight is **green on all three steps** today, having run
the real processors — so either the account above is stale or something changed
at the provider. Not rewritten here, because which of those is true is unknown.

A value already stored with a leading `=` still renders as an expression on a
board that no longer offers them — showing it as a literal would present it as
something the runner will not read as one.

### What else the borrowed editor brought

Measured, not guessed. **This app has no `/api/*` routes at all**, and the
editor calls four: `/api/workspace`, `/api/diagrams/{id}`,
`/api/diagrams/{id}/activity/stream` and `/api/agent/review`. The last is 498
lines of an AI assistant that edits your diagram — `AgentPanel`,
`AgentProposalCard`, `parseSseEvent`, `buildNextMoveResponse` — plus 205 lines
of starter *architecture* templates. Roughly 700 of 3,990 lines that can only
404, in the same class as the nine navigation items already cut. Not removed
yet; recorded so the next session does not mistake it for working code.

## Right-click on an Integrations node opens a three-way split

n8n's node view, on the Integrations board only: **Input | Parameters |
Output**, full screen. The middle pane is the same `ConfigEditor` the small
panel uses — the panes around it are what is new, not the fields. Engines and
the call composer keep the panel beside the node.

**The layout was never the work.** n8n's node view is a window onto execution
data; copy it without that and you have three empty boxes and a Test button that
does nothing. So the enabling piece came first.

### The dry run

`POST /flow/dryrun {flow_id, ucid}` in the bridge, reached through the control
plane at `/api/v1/flows/{id}/dry-run` — gated on the caller's organisation and
forwarded with `BRIDGE_INTERNAL_TOKEN`, like pre-flight, because reading a
transcript needs a provider key and the bridge is the only process allowed one.

It walks a flow against a **finished call** and returns every node's input,
output, outcome and duration. Crucially it is **the same walk a real hangup
takes**, not a second one: `postcall::walk` is shared, and `dry` decides exactly
two things —

- the reading is **not** written to the call (a test that changes the record it
  tests against is not a test), and
- the request is **not** sent. Everything up to it happens, so what the pane
  reports is what would actually go: the URL resolved, the body filled in, the
  credential found.

That is the fault this file already records against the first pre-flight — *"a
cheaper imitation is a second implementation that can disagree with the first"* —
avoided rather than repeated.

`graph::load_flow` fetches a flow by id **including drafts**, deliberately: a
call must never reach a draft, which is why `load` filters on `status`, but
testing before publishing is the whole point of being able to test.

Proven on the 1 September call: `ok`, 6074 ms, five fields read out of a
twelve-line Hindi transcript, with the trigger's ten call facts in the Input
pane.

### The Input pane *is* the picker

The first version had two: a chip list under every expression field, and an
Input pane beside it. Same paths, twice, with the inline one pushing the
parameters off screen — which is why the node view kept looking wrong however
many details were fixed.

n8n has one. You read what arrived on the left and put it into a parameter in
the middle; there is no second list under the field, because the data browser
already is the list. The inline picker is gone. Clicking a name in Input inserts
`{{ $json.name }}` at the caret of whichever parameter last had focus — kept on
a ref through `InsertTarget`, and deliberately **not** cleared on blur, since
clicking the value is what blurs the field.

Three things follow from taking n8n's arrangement rather than approximating it:

- **A trigger gets two panes, not three.** Nothing precedes it, so an Input pane
  there would be permanently empty — and an empty pane reads as one that failed
  to load. `data-panes` switches the grid.
- **The panes fill on open, not on a button.** Most of what makes n8n's node
  view feel right is that the data is already there. The walk is held on the
  board rather than in the dialog, so opening a second node reuses it: a walk
  reads a transcript with a model, and repeating it per node would be seconds
  and a bill for the same answer.
- **`$json` is the previous step, whatever that step is.** On the webhook it is
  the Set node's four values; on the Set node it is the reading's six fields.
  Verified by opening each.

Proven on all four nodes: the trigger shows two panes, the rest three, Input
populates on open, clicking a value inserts it, and the webhook — left with no
URL on purpose — reports `failed / not an http url` having sent nothing.

**A note on how this was tested.** Dispatching synthetic `click` events reported
the insert as broken; a real mouse click showed it working. The test was wrong,
not the code. Synthetic events do not reproduce the focus and click sequence
this depends on.

### Two bugs in the picker, and both were mine

**Deleting a value and picking another put the deleted text back.** `claim()`
built the insert function over `body` as it was at the render that registered
it. Clear the field afterwards and the stored closure still held the old text,
so the next insert wrote `old + {{ … }}` and the deletion appeared to undo
itself. The element's `value` is read at insert time now, never captured.

**Drag could never start, because of a line added to make clicking work.**
`onMouseDown={event => event.preventDefault()}` held the field's focus through
the click — and **preventing mousedown's default also cancels the browser's
native drag**. The element was `draggable` and inert. Removed; clicking still
works, because the insert target survives the blur rather than depending on it.

Both passed a test and both were broken. The tests dispatched `DragEvent` and
`click` directly, which skips the mousedown a real drag needs and the focus
sequence a real click produces. **Synthetic events verify that a handler is
wired, not that the interaction works** — twice now this has reported working
code as broken and broken code as working, so an interaction gets a real mouse
event or it is not tested.

### The node's type was printed four times in one dialog

"Process call" appeared as the node's **name**, as the type **badge** beside it,
as the **description** under it, and again as **PROCESS CALL DETAILS** over the
parameters. Four printings of one word, three of them saying nothing.

- `flowToDiagram` set every node's `description` to its type's label, so a node
  arrived already describing itself as what it is. It is empty now, with a
  placeholder — a stored graph has no description field yet, and when it does it
  belongs there.
- The badge is dropped when it repeats the name.
- `ConfigEditor`'s `${label} details` heading is gone. The panel and the dialog
  both name the node directly above it.

### Two small ones, both project rules I broke

**The disclosure chevrons were text glyphs** — `▾` and `▸` typed literally. Icons
in this project come from `@/components/icons`, the Font Awesome duotone shim,
and this file already imports from it and wraps it in a local `Icon` map.
`chevronDown` and `chevronRight` are in that map now.

**Scrollbars are hidden application-wide**, in `globals.css`. A `scrollbar-hide`
utility already existed but was opt-in per element, so every pane that scrolled
had to remember it. Scrolling is untouched — the track is gone, not the
behaviour: verified that a pane which overflows still scrolls with the track at
zero width.

### Four bits of chrome, and what each was actually caused by

- **A spinner while a test runs.** `faSpinnerThird` added to the icon shim as
  `Spinner`, spun with **`fa-spin`** — Font Awesome's own class, not
  hand-written keyframes. Every FA animation has honoured
  `prefers-reduced-motion` since v6, so the rotation *and its media query* were
  both reimplementations that would have drifted from the library. Speed comes
  from `--fa-animation-duration`, since the default 2s reads sluggish. The class
  goes on the `<svg>`, which is why the editor's `Icon` wrapper now forwards a
  className. The full set is at docs.fontawesome.com/web/style/animate — beat,
  fade, bounce, shake, flip, and several spins. A walk reads a transcript with a model and takes eight seconds or
  more; a button that only greys out looks like one that did not take the click.
  The spin stops under `prefers-reduced-motion` and the icon stays.
- **The pane dividers did not line up.** `.ndv-pane-head` had a `min-height`,
  and the Output head carries a button — so its rule sat five pixels below the
  other two. A fixed height makes the three read as one line across the dialog.
- **An extra divider under Parameters.** `.inspector-scroll` carries a
  `border-top` so the small panel can separate its fixed header from its
  scrolling body. In the node view the pane head already does that, so it drew a
  second line a few pixels lower that aligned with nothing.
- **The group header was 49px around 17px of text**, from two causes:
  `.ndv-browser button` was written for the field rows and also matched the
  group's own toggle, overriding its padding; and `align-items: baseline` gave
  an inline-flex icon a descent, so the caret span measured 31px around an 11px
  glyph. Scoped to `.ndv-browser dl button` and centred — 27px now.

The last one generalises: **an unscoped descendant selector inside a component
will match the component's own controls**, and the symptom is a box larger than
anything in it.

### The Input pane names the node

`▾ Set lead $json` — the node's name first, the root second: "Set lead" is what
you look for, `$json` is how you write it. Each group collapses, and `$call`
starts collapsed, because ten rows of call facts pushed the previous step's
output — the thing actually being wired — off the top of the pane. The root is
a chip on the header (`all 4`), draggable like everything else.

### A slice by marker deleted five components

Replacing `DataBrowser` by cutting from its name to the next comment took
`JsonTree`, `NodeInspector`, `ConfigEditor`, `ConfigFieldEditor` and
`ExpressionInput` with it — everything between. There is no git here, so the
file was recovered from `sourcesContent` in `.next/**/*.js.map`, which carries
the original TSX of the last compile.

Two habits from it: replace a function by finding **its own closing brace**, not
a marker further down; and `.next` source maps are a real undo of last resort
in a repo with no history — which is an argument for the repo having some.

### A value is dragged, not clicked

Clicking a field in the Input pane inserts it, and that was the only way at
first — which nobody guesses. n8n's affordance is drag, so this is drag:

- Every value carries `application/x-vokoo-path`, plus `text/plain` so a drop
  somewhere that is not a parameter still produces the expression.
- While one is in flight, `body[data-dragging-value]` outlines **every field
  that can take it**. Without that a drag has no target — the pointer is
  carrying something and nothing on screen looks willing to receive it.
- **Dropping on a field that is still Fixed switches it to Expression** and
  keeps what was typed. Requiring the switch first would make the drop fail for
  the reason least likely to be guessed.
- Inside an expression field the drop lands at the pointer, not at the end:
  appending to a JSON body somebody is halfway through writing is not what they
  meant by dropping it there.

The root is draggable too — `$json` whole, not only its fields. "Send everything
the previous step produced" is the common case, it is what a Set node is *for*,
and a list of only the leaves made it look impossible. The webhook's Body help
now says an empty value already does this.

The description moved to the header beside the name, borderless until touched,
so the header reads as a title and Parameters is only the node's own settings.

### Delivered, for real, to a third party

The whole chain end to end on 2 September, against the 1 September call:

```
Call ended -> caller_hung_up | Process call -> ok | Set lead -> ok
[webhook] https://webhook.site/… accepted it (200 OK)
```

and webhook.site received exactly what the dry run had predicted:

```
user-agent: vokoo-postcall/1
idempotency-key: 00e44897-8c66-44df-b51d-bfaaf1f4bedc
{"contactName":"सात्या","phone":"+919949879837","source":"phone","speciality":"cardiologist"}
```

Which is the first time a reading has left the machine: transcript → model →
schema → renamed for a receiver → HTTP. **The URL is still on the published
flow**, so a real call to +91 80408 02529 now delivers a caller's name and
number to webhook.site. Remove it when the testing is done.

### A full-screen modal has no business inside a canvas that moves

The node view was unusable on the first pass: clicking almost anywhere on it
closed it. Two causes, and the second is the one worth remembering.

- **`handleBoardPointerDown` closes the inspector** unless the click lands on
  `[data-board-node], button, input, textarea`. Harmless while the panel was
  small and mostly inputs; a full-screen dialog is nearly all padding. `select`
  and `dialog` are in that list now.
- **`.board-world` carries a `transform`, and a transformed ancestor becomes the
  containing block for `position: fixed`.** Rendered inside it, the dialog
  *looked* centred while its hit area was somewhere else entirely —
  `elementFromPoint` at the middle of the dialog returned the board. Every click
  fell through to the board and closed the panel being clicked.

It renders through `createPortal` to `document.body` now. The lesson generalises
past this bug: anything that must be positioned against the viewport cannot live
inside a pannable, zoomable canvas.

Two smaller things the same pass fixed: the Parameters pane inherited the
panel's two-column grid, which in a third of a screen put one field's label
beside another field's control; and a trigger rendered an empty
`CALL ENDED DETAILS` heading, which reads as a section that failed to load
rather than one with nothing in it — it says what it does instead.

### Three things it found

- **`load_call` selected neither `to_number` nor `recording_url`**, so a dry run
  reported `did` and the recording as null where a real run gets them from the
  carrier's webhook. Widened.
- **Nothing persists why a call ended.** `calls.ended_reason` is empty on every
  row, so a replay always derives `we_ended` and the trigger cannot branch the
  way the real call did. A one-line fix in the `Hangup` handler, not yet made.
- **A forced tool call is not a guarantee that the tool is called.** This file
  says the arguments come back "as a JSON object *by construction*". That is
  true of the shape *when the tool is called*; MiniMax sometimes answers in
  prose instead — observed once in seven runs, with the handler reporting
  exactly that. Five consecutive runs then succeeded at 8–12 s. Worth one retry
  on that specific error, since nobody is waiting; not yet built.

## The schema's field descriptions are the instruction

A Hindi call kept returning `patient_name: "सात्या"`, and no amount of prompting
changed it. The model was obeying its instructions exactly — the field said:

    "The caller name, exactly as they said it."

It was said in Hindi. `summary` named no language at all, which is why it came
back English on one run and Devanagari on the next: nothing was deciding.

Rewritten to *"in Latin script… transliterate it… write Satya, not the
Devanagari"* and *"one sentence in English, whatever language the call was in"*,
three consecutive runs returned `Satya` and an English summary.

**This is where the fix belongs, not in the node's Extra instruction.** A schema
is pointed at by every flow that needs it, so a rule written there holds
everywhere; the same rule in a node holds in one place and is invisible from the
others. This file already said "a schema constrains types, not semantics" —
the corollary is that the descriptions are the semantics, and they are read by a
model, so they should be written the way you would brief one.

### The lock told everyone to go to a repository that does not exist

Editing it was refused with

    Clinic lead is authored elsewhere and locked — edit it where it is
    written, or push it with locked: false

and `Clinic lead` is `origin = console`. It was written here, and by the rule
`origin` exists for, it can be unlocked here — the answer was a button on the
screen the reader was already looking at. `refuse_locked_edit` raised the
push-origin message unconditionally.

Fixed in 0074: a pushed row still says edit it at the source, a console row now
says *"it was written here, so it can be unlocked here"*. The lock was working;
the sentence was what made it look permanent.

## Square is a token decision, not a component one

`vokoo-brand.css` squared `--radius-lg` and `--radius-md` — every control — and
**deliberately left `--radius-xl` / `-2xl` / `-3xl` alone**, on the reasoning
that controls are square but cards and panels are not.

That produced exactly the split its own comment warns about: square inputs
inside rounded cards, inside rounded tables, beside a square canvas. Those three
tokens are 34 + 11 uses across the app, so squaring them is one place and every
card, panel and table follows. Verified: zero rounded elements left on the
schemas screen or the call-logs table.

`--radius-full` is untouched — 72 uses, and they are avatars, status dots and
pills where the radius *is* the shape. **The exception is `rounded-full` written
directly on a control**, which the token cannot reach: the sidebar collapser on
the divider was one, and is `rounded-none` now. The rule to apply when one turns
up: a button is never a shape, however small it is.

**Chasing components would have been the wrong move**, and the file says so:
"chasing the wrappers by class instead would miss any component added later,
which is how half a UI ends up square and half rounded."

## The canvas is square, like the rest of the app

`vokoo-brand.css` already decided this and wrote down why: `--radius-lg`,
`--radius-md`, `--radius-xs` and `--radius-sm` are `0` because **controls are
square**, and the comment there warns that chasing wrappers by class "is how
half a UI ends up square and half rounded".

The recovered editor's stylesheet predates that and honoured none of it. It was
using eight radii:

    999px ×38   8px ×17   6px ×13   12px ×7   10px ×6   14px ×5   9px ×2   24px ×2

which is not a system — it is the other project's defaults, the same origin as
the AI-agent panel and the dead `/api` routes. **116 rules squared.**

**Twelve kept round, deliberately**: `.node-outcome-point`, `.collab-avatar`,
`.collab-presence-dot`, `.node-agent-pulse`, `.node-build-pip`,
`.node-human-online`, `.mc-dot` and the rest of the dots and pips. There the
radius *is* the shape — a squared dot is a different symbol, not a flatter one.
That is the line: radius as decoration goes, radius as geometry stays.

**A node card's border is now its own colour**, the same `--node-color` its icon
uses, and the style says whether it is selected: **dashed at rest, solid when
selected**. It had been a flat grey on every card, so the icon was the only
thing distinguishing one kind of node from another, and selection was signalled
by a purple that belonged to no node. The selection halo takes the node's colour
too, through `color-mix` — the rule beside it was already doing that for the
edge-brush source.

### The purple was never ours

Forty values across the editor's stylesheet were purple — `#b997ff` twenty
times, plus `#7c3aed`, `#6b46c1`, `#d9c9ff`, `#ede9fe` and a wash. **This app's
accent is not purple.** `vokoo-brand.css` grades warm grey to black:
`--color-brand-500: #44403b`, `--color-brand-600: #000000`. The purple was the
borrowed project showing through, the same as the eight radii and the dead
`/api` routes.

*(That file also makes this note's own "brand-500 is mint #00cc8f" line stale —
the ramp was changed to ink since it was written.)*

Replaced with the brand ramp, and the line drawn deliberately: **an element that
belongs to a node takes that node's colour** — its icon, its card border, its
dialog header. Everything else takes the brand. Colouring *everything* by node
would be too much, and an edge label is the clearest case: it joins two nodes,
so picking one of them and calling it the answer says something untrue. Those
are neutral.

**The node's colour runs the whole dialog**, not just its header. It was a
`border-left` on the header, so it stopped where the panes began and read as a
decoration on the title rather than as the dialog belonging to a node. The
custom property is set once on `.ndv-frame`; the header tints from it and the
frame draws the edge.

The node view's header was rebuilt in the same pass. It had been squeezed to
8px of padding while chasing height, which pinned the title to the top edge; it
is 18/16 now, the name sizes to its content with `field-sizing` so the type tag
sits beside it rather than being pushed to the far edge by a full-width input,
and the node's colour appears as a 4px left rule as well as the tint — a wash
alone is easy to miss, an edge is not.

## condition, loop and code run

The three the palette offered and the runner did not implement. A flow could be
drawn with any of them, published, and would log "not something a post-call flow
can run" on a real call.

**`condition` is a row, not a language** — the shape settled on 1 September and
never built: left operand, operator, right operand, either side a literal or an
expression. `src/vokoo/compare.rs` holds the whole operator table in one place,
used by `condition` and by `loop`.

That shape is why `condition` may stay on the **calls** board while `code` may
not: comparing two values needs no evaluator, so on a live call each side
resolves as a path and the comparison itself is Rust. The same row on an
integration resolves through the scripted scope, so its operands may compute.
One row, one meaning, two amounts of power on either side of it.

Two decisions inside the comparison, both tested:

- **A number equals its own text.** `$call.duration_secs` is a number and
  anything typed into the row is a string; making `90` and `"90"` disagree would
  be right and useless.
- **A missing path degrades one operand.** `{{ $json.nam }}` is null, the
  comparison is false, the flow takes its other branch. On a live call that is
  the difference between a wrong turn and a dropped caller — which is the whole
  argument for a row over a language.

**`loop` is bounded by both count and clock.** A comparison that never stops
holding and a body that is merely slow are different failures with the same
symptom, so `max_iterations` and `max_seconds` are separate, and running out
takes `exhausted` rather than quietly taking `done`.

**`code` goes through the same resolver every expression uses** — the source is
wrapped as one `{{ }}` — so there is no second evaluator to disagree with the
first, and `expression.rs` still refuses to run it on a call board whatever a
graph asks for.

Proven against the 1 September call: `condition` branched `true` on
`intent == "book"`; `code` returned `{"day": 4, "minutes": 2, "who": "SATYA"}`
from real JavaScript (`toUpperCase`, `Math.round`, `new Date`); `loop` went
round three times and stopped itself at its own limit. **41 tests pass.**

### What else is worth taking from n8n

Ranked by whether something here needs it. **Switch** first and nearly free —
`condition` gives true/false, but a post-call flow wants "intent is book →
CRM, cancel → release the slot, enquiry → nothing", and `outcomes_from` already
does per-node branches for the DTMF menu. Then **Stop and Error** (fail a flow
deliberately, feeding the escalation path that only bridge faults can reach
today), then **Execute Flow** for reuse, then **Wait**, which is the expensive
one because it needs durable scheduling that nothing here has.

**Not worth taking:** Split Out, Aggregate, Split In Batches, Merge-by-index.
They exist to serve n8n's items array, which this deliberately does not have,
and importing them would drag that model in sideways.

## The nav shows which page you are on, in colour

Sarvam's console ships an `icon-*-active.svg` per destination: flat `#B3B3B3`
at rest, and when selected a **two-colour** icon with its own pair —
`#B12060`/`#FFCB79`, `#6EA335`/`#E3F1D8`. Warm and saturated: marigold,
magenta, indigo, leaf.

We need no second set of files for it, because **our icons are already Font
Awesome duotone**. `--fa-primary-color` and `--fa-secondary-color` on the
selected item's icon is the same mechanism rather than an imitation of it.
`nav-accent.ts` holds one pair per href.

**One pair per *section*, not per destination.** The first version gave all
fourteen items their own colour, which made the colour say *which page* — and
the nav already says that, by highlighting the row and the label. A colour per
section says something the nav does not: what kind of work this is. Agents,
Tools and Schemas share Build's magenta; moving to Observe turns blue.

**The selected icon beats once**, with `fa-beat` and
`--fa-animation-iteration-count: 1`. A selected item stays selected, so an
infinite animation would be permanent movement in the corner of the eye; a
single beat marks the arrival and stops. `--fa-beat-scale` is dialled to 1.12
because the default 1.25 visibly jumps the row at 20px.

**The shim was dropping `style`.** `IconProps` accepted `className`, `size` and
`strokeWidth` and nothing else, so the prop vanished silently — the worst shape
for a style prop, since the call site looks right and the icon does not change.
It forwards now, typed as `CSSProperties` rather than a custom-property record:
icons are passed around as plain `ComponentType` in several screens, and a
narrower `style` than React's own makes them unassignable there.

## Lists paginate

`resource-list-screen.tsx` is behind every list in the console — calls, agents,
tools, engines, runs — so pagination is one place, not per screen.

Ten rows a page, and the size is the interesting part: at twenty-five **nothing
in this console would ever show a second page** (fourteen calls, a handful of
agents). A page size no dataset reaches is pagination that exists only in the
code.

The footer says which rows, not only how many: on page three "60 of 412" leaves
the reader working out what they are looking at. The pager itself appears only
above one page — a pager over a single page is a control that cannot do
anything.

**`indus.sarvam.ai/` broke `npm run build`.** A copied site dump inside the
project put unresolved imports in the TypeScript program, and the build runs the
type check. It is in `tsconfig.exclude` now.

## Picking up post-call authoring — the file map

Written so the next session does not re-survey. Everything below was verified on
2 September, not remembered.

### It is more finished than a scan would suggest

**The binding UI already exists.** `phone-number-detail-screen.tsx` binds a flow
per trigger event and *already offers `call.ended`* — "After the call ends. Runs
once the call is over. Nobody is listening." An earlier note in this file said
the screen only bound the answering flow. It was wrong: no number had a
`call.ended` row, and that was read as "cannot" rather than "has not".

So a post-call flow can be drawn, published **and bound** today. What has never
happened is a real call ending on a number with one bound.

### Where each piece lives

| | |
|---|---|
| runs the flow | `bridge/src/vokoo/postcall.rs`, spawned from the `Hangup` branch of `kookoo_webhook` |
| reads the call | `bridge/src/vokoo/intelligence.rs` — forced tool call; the provider is the **workspace's**, `host()` knows anthropic and minimax |
| sends it on | `bridge/src/vokoo/webhook.rs` — `{{ }}` substitution, 4xx/5xx split |
| resolves the flow | `graph::resolve_for_event(base, key, did, TRIGGER_ENDED)` |
| binds it to a number | `number_flows(phone_number_id, trigger_event)` — the UI is the phone number screen |
| which nodes a board offers | `catalogue_node_types.families` (`{call}` / `{post_call}` / both), filtered by `addableFor()` in `architecture-model.ts`; the board's family comes from `familyOf(diagram)`, read off its trigger node |
| the two post-call nodes | `intelligence` and `http.request`, `families = {post_call}` |
| the schema a node fills | `structured_outputs`, chosen through the `structured_output` valueType in the inspector |

### What is verified, and what is not

Verified with a synthetic `Hangup` against a real call row: the flow resolves and
walks, the trigger branches on `caller_hung_up`, MiniMax filled a six-field
shape correctly from a seven-line transcript, the reading landed in
`calls.analysis`, and the webhook classified a 405 as `refused` rather than
something to retry.

**Never done: a real call.** Nothing has bound a `call.ended` flow to
`+918040802529` and hung up. That is the next move, and it needs no code —
open the number, pick a flow under "After the call ends", call, hang up, and
read `[post-call]` in the journal.

### Two things that will bite

**`http.request` has no credential UI beyond a vendor name.** `secret_vendor`
names a connected provider and sends it as a bearer token. A CRM needing a
different header shape has nowhere to say so.

**The webhook target is unvalidated.** Any URL is accepted, including one
inside the network. Nothing stops a flow author pointing it at `localhost`.

## Known broken or missing

- ~~`finish_call` has never fired on a real call.~~ **It has.** The trace for
  the call at 31 Aug 08:11 reads: `Open right now?` (business_hours → open),
  `Reception` (agent → wants_human), `Hand to the front desk` (kookoo.transfer
  → ok), `Handed over` (kookoo.release → __end__). The agent reported an
  outcome, the flow left the agent node, and the transfer ran.
- **A call hung with no log line at all.** 1 September, 11:34:26–11:35:08. The
  agent asked a question, the caller answered "yes", and for 42 seconds nothing
  was logged — no VAD transition, no audio frame, no error — until the caller
  hung up. Every other turn logs `VAD server: → Speaking` within milliseconds, so
  caller audio stopped reaching the VAD rather than being misheard. Root cause
  unknown. Two oddities in the preceding turn, neither explaining it: two
  `check_slots` calls executed in parallel, and the turn timing logged out of
  order (`t4 TTS 1st` before the assistant text and before `send_flush`).
  **A watchdog now records this.** `Primer` sits immediately after
  `transport.input()` and warns when no `InputAudioRaw` has arrived for 10s,
  reporting how many audio frames reached it. Compare that count with
  `media_packets_in` in `CALL_SUMMARY`: if the packet count kept rising while the
  frame count did not, the audio stopped *inside* the bridge; if both stopped,
  the carrier stopped sending. It logs and nothing more — a bridge that hung up
  on a quiet line would be a worse failure than the one it is diagnosing.
  The hang has not recurred since, so the warning is still unseen in the wild.
- **Names and reference numbers should not depend on the model.** A name spoken
  alone gives a transcriber almost nothing; spell-back or matching a patient list
  is the durable answer. Likewise `book_appointment` should return a spoken form
  ("V-Y, two seven eight zero, eleven hundred") beside the raw reference, so
  clarity does not depend on which TTS is fitted.
- **`check_slots` accepts any string as a doctor.** On 1 September the model
  invented "Cardiologist A" and "Cardiologist B", the tool hashed the string into
  plausible availability, and an appointment was booked against a person who does
  not exist. There is no `list_doctors` tool, so the prompt's "find out which
  doctor" has no source of truth.
- **`Conference` has never been exercised.** Untested end to end.
- **No relay has answered a real call.** The cascading path builds and compiles;
  what is unverified is audio through it. Sarvam and OpenAI keys are not
  connected, so the engine builder says so before the call rather than after.
- ~~Only an OpenAI-compatible relay can call tools.~~ **An engine that cannot
  call tools is not supported.** Migration 0045 withdraws `realtime:openai` and
  `llm:sarvam` from the catalogue — `OpenAIRealtimeConfig` has no functions
  field and `openai.rs` inherits the trait's refusing default;
  `SarvamLLMHandler` carries no `FunctionRegistry`. `build_relay` refuses one,
  and the realtime path refuses OpenAI when the agent has tools, so a row
  written before that migration fails loudly instead of answering a call it
  cannot serve.
- **Latency is unmeasured.** Transcription was only enabled after the last call.
- `condition`, `loop`, `code` fail at runtime — no expression language decided.
  The shape agreed on 1 September, following n8n: an IF/Switch row is
  **structured** (left operand, operator, right operand) where either side may
  be a literal or an expression, rather than the node's whole surface being a
  language. A typo then degrades one operand instead of failing the node on a
  live call. `var` and a general `switch` come with it.
- A second agent node in one flow ends the call.
- ~~`calls` table has never had a row.~~ It has 9, with 27 `call_events` rows.
  Still empty on those calls: `transcript`, `recording_url`, `cost`, and every
  `call_events.duration_ms`.
- Tools reach the prompt; nothing executes one.
- **A menu wired *after* an agent node cannot be asked.** The stream is open by
  then and `<collectdtmf>` is answered between streams. Both walks log a warning
  and take the node's `timeout` branch rather than stranding the caller, but the
  composer does not stop you drawing it.
- **`cargo test` was dead from the ElevenLabs vendoring until 1 September** —
  the crate's own tests came with the subset and could not compile, and a test
  target is all-or-nothing, so all 365 tests were silently not running. Removed;
  see `docs/vendor-overrides.md`. A re-copy brings them back.
- **Everything the phone runs on is uncommitted *on the VPS*.** `git status` in
  `/opt/vokoo/rustvani` shows `src/vokoo/`, `src/bin/`, `src/services/realtime/`
  and `src/serializers/kookoo.rs` as untracked, plus modifications to
  `Cargo.toml`, `src/lib.rs`, `src/services/mod.rs`, `src/services/llm/openai.rs`,
  `src/serializers/mod.rs` and `src/transport/output.rs`. A `git checkout` or a
  rustvani upgrade takes all of it.

  **The repo now has a copy of every one of them** — `bridge/` mirrors the VPS
  byte for byte, verified by checksum in both directions on 2 September. Eight
  files were VPS-only until then, and two of them were the ones that matter
  most: `Cargo.toml` and `Cargo.lock`. Without those the repo held the source of
  the bridge and no way to build it — the `default` feature list (`stt-gnani`,
  `tts-sarvam`, `tts-piper`, `tts-elevenlabs`) and `boa_engine` lived nowhere
  else, and `cargo add` had been run on the server.

  **The check, when you want to know whether they have drifted:** md5 each file
  under `bridge/src` against `/opt/vokoo/rustvani/src`, both directions. Editing
  locally and `scp`-ing up keeps them equal; editing on the server does not.
  Re-run on 2 September: every file matches except
  `src/services/tts/elevenlabs/client.rs`, which is in the repo and **not on the
  VPS** — an orphan of the ElevenLabs vendoring, since the crate builds from
  `elevenlabs_api/`. It compiles nowhere and is safe to delete once somebody
  confirms that.
- ~~`vokoo-console` has **no git commits**.~~ **Wrong, and it was wrong here for
  a while.** The repo is at `/Users/.../Projects/vokoo`, branch
  `console-and-canvas`, remote `github.com/saridsa2/vokoo`, with a real history.
  Worth naming because it was believed twice: once by this file, and once by a
  session whose environment reported "is a git repository: false" and which
  recovered a clobbered file from a Next.js source map when `git checkout` would
  have done it. **Check `git rev-parse --is-inside-work-tree` rather than trust
  either.**

## Useful commands

```bash
ssh vokoo
journalctl -u vokoo-bridge -f -o cat          # watch a call

# Would this engine work? Builds and runs the real processors for 2.5s.
TOKEN=$(grep ^BRIDGE_INTERNAL_TOKEN= /opt/vokoo/rustvani/bridge.env | cut -d= -f2-)
curl -s -X POST localhost:8080/engine/preflight -H 'Content-Type: application/json' \
  -H "x-vokoo-internal: $TOKEN" -d '{"engine_id":"<uuid>"}'

# Ask every connected provider what it currently offers.
curl -s -X POST localhost:8080/catalogue/refresh -H 'Content-Type: application/json' \
  -H "x-vokoo-internal: $TOKEN" -d '{"org_id":"<uuid>"}'

# Did the running process get the last build? This has bitten once already.
stat -c %y /opt/vokoo/rustvani/target/release/vokoo_bridge
systemctl show vokoo-bridge -p ActiveEnterTimestamp --value
cd /opt/vokoo/rustvani && cargo build --release --bin vokoo_bridge
./target/release/flow_check 918040802529      # dry-run a flow, no call
./target/release/gemini_check                 # prove the model connects
docker exec -it supabase-db psql -U postgres
```

Three reference documents exist as artifacts: the **Flow Vocabulary** (flow,
node, outcome, transition; the five node types), the **Composer Spec**, and the
**Project Map**.

## The carrier is documented — read it before guessing

`docs/kookoo-platform.md` is the KooKoo/Ozonetel protocol: the XML verbs, the
WebSocket event shapes, the audio format, the platform limits and a long table
of failures somebody hit before us. Saved 1 September from a skill written for a
Node SDK — **the second half of that file builds a different product on a
different stack, and is not ours.** The protocol half is the best account of the
carrier we have, and it agrees with `src/serializers/kookoo.rs` where the two
overlap.

Three things in it that were news:

- **Three concurrent calls per extension.** A fourth caller gets SIP 486 Busy and
  the bridge never sees the call. We have never hit it because we have never had
  four callers at once.
- **If the bridge's WebSocket errors or closes, the platform ends the call.** A
  panic is not a silent bot, it is a hung-up caller — which is an argument for
  catching around anything on the call path rather than letting it unwind.
- **The carrier hands over a recording**, and `<start-record/>` is what starts
  it. `calls.recording_url` is empty because nothing asks, not because nothing
  exists.

## The caller picks the language on the keypad — built 1 September

`kookoo.collect_digits` is a flow node. It plays a prompt through the carrier,
collects one key, and leaves by the branch for that key.

**Its branches are not declared by its type.** "Press 1 for English, 2 for
Hindi" has three branches in one flow and five in the next, so the catalogue
cannot name them: `catalogue_node_types.outcomes_from` points at the config
field holding them, and `outcomesForNode(node)` in the console is now the single
source of truth for a node's ports — replacing `NODE_TYPES[type].outcomes`
everywhere, including edge geometry, which is computed from outcome count and
not measured from the DOM. n8n's Switch node settled the design.

Why the keypad rather than a tool: **both Sarvam services take their language
when the socket opens** (`SarvamSttConfig.language`, `SarvamTtsConfig.language`),
so a tool firing mid-call leaves the ear and the mouth in the old language while
the model writes in the new one. Choosing before the agent node means each
branch reaches its own agent with its own engine, and every socket opens in the
right language. Nothing reconnects.

### The webhook walks the flow now, and must not run it

`<collectdtmf>` is answered *between* streams, so the menu has to be decided on
the `NewCall` webhook — before the socket the flow used to be walked in. The
socket handler still walks the same flow for real, which means **anything the
webhook ran would run twice**, and half of `run_immediate` dials, transfers or
hangs up.

So `FlowRunner::preview()` stops at the first node it is not explicitly allowed
to evaluate. `PREVIEWABLE` is a **whitelist** — `business_hours` plus any
`trigger.*` — so a node type added later is refused by default rather than
silently executed twice. Leaving triggers out of it stopped every preview on the
first node of every flow and no menu was ever reached; the symptom was a menu
flow answering with `<stream>`.

Answers live in `Keypresses`, keyed by ucid, **read rather than taken** — the
flow is walked at least twice per call and a menu whose answer was consumed on
the first walk would be asked again on the second.

### What is proven and what is not

Proven without a call: the runner branches on a key, `flow_check <did> 2` walks
past a menu, `NewCall` returns `<collectdtmf>` with the prompt, and a callback
carrying a key returns `<stream>`. The console draws one port per branch.

**Not proven: what the carrier actually posts back.** `docs/kookoo-platform.md`
documents the verb and not the callback — neither the event name nor the
parameter carrying the digits. So the URL carries our own `vokoo_menu` marker,
the handler matches on that rather than an event name, `collected_key` scans a
list of likely parameter names for a single keypad character, and every
parameter is logged. **The first real call replaces that guess with a fact** —
look for `no key found in the callback` and read the logged params.

## Superseded: the plan before it was built

The goal is a caller choosing a language, and the prompt, voice and transcriber
following that choice. It cannot be a mid-call tool: **both Sarvam services take
their language when the socket opens** (`SarvamSttConfig.language`,
`SarvamTtsConfig.language`), so a tool firing mid-call would leave the ear and
the mouth in the old language while the model wrote in the new one.

DTMF avoids that entirely by choosing *before* the agent node, and the carrier
offers two ways to collect it. They are not interchangeable:

| | `<collectdtmf>` | the in-stream DTMF event |
|---|---|---|
| when | **between** streams, before the pipeline exists | **during** the stream |
| reaches | the bridge's `/kookoo`, as an HTTP callback | the bridge, as `InputDTMFFrame` |
| good for | **choosing a language**, a menu, routing | a PIN or account number mid-conversation |

`<collectdtmf>` is the one for language, because the flow branches while no
pipeline is up: each branch then reaches its own agent node with its own engine,
and every socket opens in the right language. Nothing reconnects.

State of the parts: the serializer **already parses** the in-stream event into
`InputDTMFFrame` with a typed `KeypadEntry`, and has a test for it — and nothing
consumes that frame. There is no `<collectdtmf>` handling in the control plane
and no node type for it; the catalogue has `agent`, `business_hours`,
`condition`, the KooKoo actions, and nothing that asks a question and waits.

So the work is: a `kookoo.collect_digits` node (prompt, digit count, timeout,
one outcome per digit), the control-plane route the carrier posts digits back
to, and the runner branching on the outcome. The engines and agents it branches
into already exist.

# Vendor Files We Edit

Some fixes have nowhere to live but a file somebody else ships. Those are listed
in `docs/vendor-overrides.md` with what they do and how to tell whether they are
still applied — **an upgrade reverts them silently**.

The one that matters most: `functions/main/index.ts` gives the `run` function an
empty environment. Without it, every tool a customer pushes can read
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` and `JWT_SECRET`. Measured, not
assumed. After a Supabase upgrade, check it before anything else:

```bash
ssh vokoo 'grep -c "VOKOO OVERRIDE" /opt/supabase/supabase/docker/volumes/functions/main/index.ts'
```

# Survey Before Building

**On 30 August 2026 the user said: "I feel so cheated."** He was right to.

I spent hours extending a Python media bridge while `/opt/vokoo/rustvani` sat
unused on the same server — 159 files, 44,000 lines, containing
`src/bin/vokoo_bridge.rs`, `src/serializers/kookoo.rs` and
`src/services/realtime/gemini.rs`. The KooKoo protocol and a Gemini Live client
were already written, in Rust, which is what he believed we were using. (They
are not upstream rustvani — `src/services/realtime/` and
`src/serializers/kookoo.rs` are untracked additions to it, written 29 August.
`GeminiLiveSession` implements rustvani's `RealtimeSession` trait and runs as a
`FrameProcessor`; the wire protocol is the `gemini-live` crate from crates.io.) I
reimplemented both in Python, worse. I had listed that directory on screen
several times and never opened it.

He was also right earlier the same day that a spec I wrote was bent toward what
I had already built, and that I stopped on a bug after six guesses instead of
running one minimal test that would have identified it in two minutes.

**The rule**: before writing a component, look for it. Read the directory
listings you have already produced. Open the thing whose name matches the
problem. `ls` on a repo costs one tool call; discovering the duplicate after the
fact costs the user their trust and a day of work.

**Corollaries**:
- State the stack in play before extending it. If work is going into Python and
  the user believes it is Rust, say so on the first file, not the fifth.
- When a fix fails twice, stop guessing and build the smallest reproduction.
- A specification written by the implementer bends toward the implementation.
  Say so, and welcome an independent one.

# Writing Rules

Applies to **UI copy, code comments, commit messages, and replies to the user**.

- **NEVER** use these words: `honest`, `honestly`, `straight`, `straightforward`, `simply`, `just`, `clearly`, `obviously`, `basically`, `actually`, `of course`, `needless to say`.
- **Reason**: they either flatter the writer ("honest") or dismiss the reader's difficulty ("simply", "obviously"). A sentence that needs "honestly" to be believed is not improved by it, and "just do X" tells a stuck reader their problem is trivial.
- **Instead**: state the thing. Cut the adverb.
    - ❌ "Honestly, this is straightforward — just set the flag."
    - ✅ "Set the flag."
    - ❌ "The placeholder is honest about not being built."
    - ✅ "The placeholder names the endpoint it will read."
- Exception: `just` is allowed in its temporal sense (`"just now"`, `"just released"`).

# Tool Use Rules

- **NEVER** use `sed`, `awk`, `grep`, `cat`, `head`, or `tail` inside the Bash tool.
- Always prefer the dedicated structured tools:
    - Use `Read` to view files (never `cat`, `head`, or `sed -n`).
    - Use `Grep` for search patterns (never bash `grep`).
    - Use `Edit` or `Write` for file modifications (never `sed -i` or heredocs).
- **Reason**: Dedicated tools automatically bypass manual approval prompts, generate accurate diffs, and prevent shell execution bugs.

## Project Overview

This is **VoKoo** — a voice-AI control plane: a faithful Vapi-style console built on
KooKoo/Ozonetel telephony, with the AI plane running on self-hosted hardware.

The UI is built with:

- **React 19** with TypeScript
- **Tailwind CSS v4.2** for styling
- **React Aria Components** as the foundation for accessibility and behavior

## Key Architecture Principles

### Component Foundation

- All components are built on **React Aria Components** for consistent accessibility and behavior
- Components follow the compound component pattern with sub-components (e.g., `Select.Item`, `Select.ComboBox`)
- TypeScript is used throughout for type safety

### Import Naming Convention

**CRITICAL**: All imports from `react-aria-components` must be prefixed with `Aria*` for clarity and consistency:

```typescript
// ✅ Correct
import { Button as AriaButton, TextField as AriaTextField } from "react-aria-components";
// ❌ Incorrect
import { Button, TextField } from "react-aria-components";
```

This convention:

- Prevents naming conflicts with custom components
- Makes it clear when using base React Aria components
- Maintains consistency across the entire codebase

### File Naming Convention

**IMPORTANT**: All files must be named in **kebab-case** for consistency:

```
✅ Correct:
- date-picker.tsx
- user-profile.tsx
- api-client.ts
- auth-context.tsx

❌ Incorrect:
- DatePicker.tsx
- userProfile.tsx
- apiClient.ts
- AuthContext.tsx
```

This applies to all file types including:

- Component files (.tsx, .jsx)
- TypeScript/JavaScript files (.ts, .js)
- Style files (.css, .scss)
- Test files (.test.ts, .spec.tsx)
- Configuration files (when creating new ones)

## Development Commands

```bash
# UI (Next.js, not Vite — the scaffold's default text is wrong for this project)
npm run dev              # Dev server on http://localhost:3000
npm run build            # Production build (runs the TypeScript check)
npm run start            # Serve the production build

# Rust control-plane API (server/), deployed on the VPS as vokoo-cp-api
cargo build --release --manifest-path server/Cargo.toml
```

`FA_PACKAGE_TOKEN` must be exported before `npm install`, or the Font Awesome kit
package will fail to resolve.

## Project Structure

### Application Architecture

```
src/
├── components/
│   ├── base/              # Core UI components (Button, Input, Select, etc.)
│   ├── application/       # Complex application components
│   ├── foundations/       # Design tokens and foundational elements
│   ├── marketing/         # Marketing-specific components
│   └── shared-assets/     # Reusable assets and illustrations
├── hooks/                 # Custom React hooks
├── pages/                 # Route components
├── providers/             # React context providers
├── styles/               # Global styles and theme
├── types/                # TypeScript type definitions
└── utils/                # Utility functions
```

### Component Patterns

#### 1. Base Components

Located in `components/base/`, these are the building blocks:

- `Button` - All button variants with loading states
- `Input` - Text inputs with validation and icons
- `Select` - Dropdown selections with complex options
- `Checkbox`, `Radio`, `Toggle` - Form controls
- `Avatar`, `Badge`, `Tooltip` - Display components

#### 2. Application Components

Located in `components/application/`, these are complex UI patterns:

- `DatePicker` - Calendar-based date selection
- `Modal` - Overlay dialogs
- `Pagination` - Data navigation
- `Table` - Data display with sorting
- `Tabs` - Content organization

#### 3. Styling Architecture

- Uses a `sortCx` utility for organized style objects
- Follows size variants: `sm`, `md`, `lg`, `xl`
- Color variants: `primary`, `secondary`, `tertiary`, `destructive`, etc.
- Responsive and state-aware styling with Tailwind

#### 4. Component Props Pattern

```typescript
interface CommonProps {
    size?: "sm" | "md" | "lg";
    isDisabled?: boolean;
    isLoading?: boolean;
    // ... other common props
}

interface ButtonProps extends CommonProps, HTMLButtonElement {
    color?: "primary" | "secondary" | "tertiary";
    iconLeading?: FC | ReactNode;
    iconTrailing?: FC | ReactNode;
}
```

## Styling Guidelines

### Tailwind CSS v4.2

- Uses the latest Tailwind CSS v4.2 features
- Custom design tokens defined in theme configuration
- Consistent spacing, colors, and typography scales

### Brand Color — VoKoo

The brand palette is **not** Untitled UI's purple. `src/styles/vokoo-brand.css` overrides
`--color-brand-*` and `--color-neutral-*`. **It is ink, not mint** — the ramp
grades warm grey to black (`brand-500: #44403b`, `brand-600: #000000`); the
earlier Vapi mint (`#00cc8f`) was replaced and this line said otherwise until
2 September. It is imported after
`theme.css` so it wins.

Overriding those two scales re-skins the whole component library, so **never hardcode a
brand colour in a component** — it would not follow the theme. Edit `vokoo-brand.css`
instead of `theme.css`; the latter is vendor code that `untitledui upgrade` may replace.

### Brand Color Customization (vendor default — superseded above)

To change the main brand color across the entire application:

1. **Update Brand Color Variables**: Edit `src/styles/theme.css` and modify the `--color-brand-*` variables
2. **Maintain Color Scale**: Ensure you provide a complete color scale from 25 to 950 with proper contrast ratios
3. **Example Brand Color Scale**:
    ```css
    --color-brand-25: rgb(252 250 255); /* Lightest tint */
    --color-brand-50: rgb(249 245 255);
    --color-brand-100: rgb(244 235 255);
    --color-brand-200: rgb(233 215 254);
    --color-brand-300: rgb(214 187 251);
    --color-brand-400: rgb(182 146 246);
    --color-brand-500: rgb(158 119 237); /* Base brand color */
    --color-brand-600: rgb(127 86 217); /* Primary interactive color */
    --color-brand-700: rgb(105 65 198);
    --color-brand-800: rgb(83 56 158);
    --color-brand-900: rgb(66 48 125);
    --color-brand-950: rgb(44 28 95); /* Darkest shade */
    ```

The color scale automatically adapts to both light and dark modes through the CSS variable system.

### Style Organization

```typescript
export const styles = sortCx({
    common: {
        root: "base-classes-here",
        icon: "icon-classes-here",
    },
    sizes: {
        sm: { root: "small-size-classes" },
        md: { root: "medium-size-classes" },
    },
    colors: {
        primary: { root: "primary-color-classes" },
        secondary: { root: "secondary-color-classes" },
    },
});
```

### Utility Functions

- `cx()` - Class name utility (from `@/utils/cx`)
- `sortCx()` - Organized style objects
- `isReactComponent()` - Component type checking

## Icon Usage

### Font Awesome duotone — via the shim, always

This project uses **Font Awesome duotone** icons, NOT `@untitledui/icons`. Every icon
in the console is duotone (`duotone/solid`) — this is a project-wide rule, not a
per-component choice.

**Import icons ONLY from `@/components/icons`.** Never from `@untitledui/icons`, and
never from `@awesome.me/kit-*` directly in a component.

```typescript
// ✅ Correct
import { ChevronDown, Settings01, SearchLg } from "@/components/icons";

// ❌ Incorrect — reintroduces Untitled UI icons
import { ChevronDown } from "@untitledui/icons";

// ❌ Incorrect — bypasses the shim, so style/opacity are inconsistent
import { faChevronDown } from "@awesome.me/kit-9a13e121e5/icons/duotone/solid";
```

`src/components/icons.tsx` maps Untitled UI's icon names onto Font Awesome
definitions, so vendored components keep working unchanged. It is the single place
the icon set, style and duotone opacities are decided.

**When `npx untitledui add <component>` pulls in a new component**, it will import
from `@untitledui/icons`. Rewrite that one import line to `@/components/icons`. If a
name is missing from the shim, add it there — do not import Font Awesome directly in
the component.

**Adding a new icon** to the shim: pick the Font Awesome name (`/suggest-icon` or
`fa search <query>` can help), add the `fa*` import from the duotone/solid path, and
export it under the name callers use.

### Kit and tokens

- Kit `9a13e121e5` ("PersonalProjects") — Pro, SVG, Full Library, Font Awesome 6.7.2
- Package: `@awesome.me/kit-9a13e121e5`
- `FA_PACKAGE_TOKEN` **must be set in the environment for `npm install`** (locally, on
  the VPS, and in CI). `.npmrc` references the variable rather than storing the token.

### Duotone opacities

Font Awesome's defaults (primary 1.0 / secondary 0.4) assume dark icons on light
backgrounds. This console is dark, so the shim raises the secondary layer to 0.55 and
eases the primary to 0.95 — otherwise the second layer vanishes and icons read as flat
solid shapes. Change those in one place in the shim, never per component.

### Legacy Untitled UI icon reference (do not use)

Kept only to explain what the shim's names originally came from.

```typescript
import { Home01, Settings01, ChevronDown } from "@untitledui/icons";

// Component props - pass as reference
<Button iconLeading={ChevronDown}>Options</Button>

// Standalone usage
<Home01 className="size-5 text-gray-600" />

// As JSX element - MUST include data-icon
<Button iconLeading={<ChevronDown data-icon className="size-4" />}>Options</Button>
```

### Styling

```typescript
// Size: use size-4 (16px), size-5 (20px), size-6 (24px)
<Home01 className="size-5" />

// Color: use semantic text colors
<Home01 className="size-5 text-brand-600" />

// Stroke width (line icons only)
<Home01 className="size-5" strokeWidth={2} />

// Accessibility: decorative icons need aria-hidden
<Home01 className="size-5" aria-hidden="true" />
```

### PRO Icon Styles

```typescript
import { Home01 } from "@untitledui-pro/icons";
// Line
import { Home01 } from "@untitledui-pro/icons/duocolor";
import { Home01 } from "@untitledui-pro/icons/duotone";
import { Home01 } from "@untitledui-pro/icons/solid";
```

## Form Handling

### Form Components

- `Input` - Text inputs with validation
- `Select` - Dropdown selections
- `Checkbox`, `Radio` - Selection controls
- `Textarea` - Multi-line text input
- `Form` - Form wrapper with validation

## Animation and Interactions

### Animation Libraries

- `motion` (Framer Motion) for complex animations
- `tailwindcss-animate` for utility-based animations
- CSS transitions for simple state changes

### CSS Transitions

For default small transition actions (hover states, color changes, etc.), use:

```typescript
className = "transition duration-100 ease-linear";
```

This provides a snappy 100ms linear transition that feels responsive without being jarring.

### Loading States

- Components support `isLoading` prop
- Built-in loading spinners
- Proper disabled states during loading

### Disabled states

All components use `opacity-50` for disabled states instead of individual disabled color tokens:

```typescript
// Correct (v8)
"disabled:cursor-not-allowed disabled:opacity-50"

// Incorrect (v7 pattern, do not use)
"disabled:bg-disabled_subtle disabled:text-disabled disabled:ring-disabled"
```

## Common Patterns

### Compound Components

```typescript
const Select = SelectComponent as typeof SelectComponent & {
    Item: typeof SelectItem;
    ComboBox: typeof ComboBox;
};
Select.Item = SelectItem;
Select.ComboBox = ComboBox;
```

### Conditional Rendering

```typescript
{label && <Label isRequired={isRequired}>{label}</Label>}
{hint && <HintText isInvalid={isInvalid}>{hint}</HintText>}
```

## State Management

### Component State

- Use React Aria's built-in state management
- Local state for component-specific data
- Context for shared component state (theme, router)

### Global State

- Theme context in `src/providers/theme.tsx`
- Router context in `src/providers/router-provider.tsx`

## Key Files and Utilities

### Core Utilities

- `src/utils/cx.ts` - Class name utilities
- `src/utils/is-react-component.ts` - Component type checking
- `src/hooks/` - Custom React hooks

### Style Configuration

- `src/styles/globals.css` - Global styles
- `src/styles/theme.css` - Theme definitions
- `src/styles/typography.css` - Typography styles

## Best Practices for AI Assistance

### When Adding New Components

1. Follow the existing component structure
2. Use React Aria Components as foundation
3. Implement proper TypeScript types
4. Add size and color variants where applicable
5. Include accessibility features
6. Follow the naming conventions
7. Add components to appropriate folders (`base/`, `application/`, etc.)

## Most Used Components Reference

### Button

The Button component is the most frequently used interactive element across the library.

**Import:**

```typescript
import { Button } from "@/components/base/buttons/button";
```

**Common Props:**

- `size`: `"xs" | "sm" | "md" | "lg" | "xl"` - Button size (default: `"sm"`)
- `color`: `"primary" | "secondary" | "tertiary" | "link-gray" | "link-color" | "primary-destructive" | "secondary-destructive" | "tertiary-destructive" | "link-destructive"` - Button color variant (default: `"primary"`)
- `iconLeading`: `FC | ReactNode` - Icon or component to display before text
- `iconTrailing`: `FC | ReactNode` - Icon or component to display after text
- `isDisabled`: `boolean` - Disabled state
- `isLoading`: `boolean` - Loading state with spinner
- `showTextWhileLoading`: `boolean` - Keep text visible during loading
- `children`: `ReactNode` - Button content

**Examples:**

```typescript
// Basic button
<Button size="md">Save</Button>

// With leading icon
<Button iconLeading={Check} color="primary">Save</Button>

// Loading state
<Button isLoading showTextWhileLoading>Submitting...</Button>

// Destructive action
<Button color="primary-destructive" iconLeading={Trash02}>Delete</Button>
```

### Input

Text input component with extensive customization options.

**Import:**

```typescript
import { Input } from "@/components/base/input/input";
import { InputGroup } from "@/components/base/input/input-group";
```

**Common Props:**

- `size`: `"sm" | "md" | "lg"` - Input size (default: `"md"`)
- `label`: `string` - Field label
- `placeholder`: `string` - Placeholder text
- `hint`: `string` - Helper text below input
- `tooltip`: `string` - Tooltip text for help icon
- `icon`: `FC` - Leading icon component
- `isRequired`: `boolean` - Required field indicator
- `isDisabled`: `boolean` - Disabled state
- `isInvalid`: `boolean` - Error state

**Examples:**

```typescript
// Basic input with label
<Input label="Email" placeholder="olivia@untitledui.com" />

// With icon and validation
<Input
  icon={Mail01}
  label="Email"
  isRequired
  isInvalid
  hint="Please enter a valid email"
/>

// Input group with button
<InputGroup label="Website" trailingAddon={<Button>Copy</Button>}>
  <InputBase placeholder="www.untitledui.com" />
</InputGroup>
```

### Select

Dropdown selection component with search and multi-select capabilities.

**Import:**

```typescript
import { MultiSelect } from "@/components/base/select/multi-select";
import { Select } from "@/components/base/select/select";
```

**Common Props:**

- `size`: `"sm" | "md" | "lg"` - Select size (default: `"md"`)
- `label`: `string` - Field label
- `placeholder`: `string` - Placeholder text
- `hint`: `string` - Helper text
- `tooltip`: `string` - Tooltip text
- `items`: `Array` - Data items to display
- `isRequired`: `boolean` - Required field
- `isDisabled`: `boolean` - Disabled state
- `icon`: `FC | ReactNode` - Icon for placeholder

**Item Props:**

- `id`: `string` - Unique identifier
- `supportingText`: `string` - Secondary text
- `icon`: `FC | ReactNode` - Leading icon
- `avatarUrl`: `string` - Avatar image URL
- `isDisabled`: `boolean` - Disabled item

**Examples:**

```typescript
// Basic select
<Select label="Team member" placeholder="Select member" items={users}>
  {(item) => (
    <Select.Item id={item.id} supportingText={item.email}>
      {item.name}
    </Select.Item>
  )}
</Select>

// With search (ComboBox)
<Select.ComboBox label="Search" placeholder="Search users" items={users}>
  {(item) => <Select.Item id={item.id}>{item.name}</Select.Item>}
</Select.ComboBox>

// With avatars
<Select items={users} icon={User01}>
  {(item) => (
    <Select.Item avatarUrl={item.avatar} supportingText={item.role}>
      {item.name}
    </Select.Item>
  )}
</Select>
```

### Checkbox

Checkbox component for boolean selections.

**Import:**

```typescript
import { Checkbox } from "@/components/base/checkbox/checkbox";
```

**Common Props:**

- `size`: `"sm" | "md"` - Checkbox size (default: `"sm"`)
- `label`: `string` - Checkbox label
- `hint`: `string` - Helper text below label
- `isSelected`: `boolean` - Checked state
- `isDisabled`: `boolean` - Disabled state
- `isIndeterminate`: `boolean` - Indeterminate state

**Examples:**

```typescript
// Basic checkbox
<Checkbox label="Remember me" />

// With hint text
<Checkbox
  label="Remember me"
  hint="Save my login details for next time"
/>

// Controlled state
<Checkbox isSelected={checked} onChange={setChecked} />
```

### Badge

Badge components for status indicators and labels.

**Import:**

```typescript
import { Badge, BadgeWithDot, BadgeWithIcon } from "@/components/base/badges/badges";
```

**Common Props:**

- `size`: `"sm" | "md" | "lg"` - Badge size
- `color`: `"gray" | "brand" | "error" | "warning" | "success" | "slate" | "sky" | "blue" | "indigo" | "purple" | "pink" | "rose" | "orange"` - Color theme
- `type`: `"pill-color" | "color" | "modern"` - Badge style variant

**Examples:**

```typescript
// Basic badge
<Badge color="brand" size="md">New</Badge>

// With dot indicator
<BadgeWithDot color="success" type="pill-color">Active</BadgeWithDot>

// With icon
<BadgeWithIcon iconLeading={ArrowUp} color="success">12%</BadgeWithIcon>
```

### Avatar

Avatar component for user profile images.

**Import:**

```typescript
import { Avatar } from "@/components/base/avatar/avatar";
import { AvatarLabelGroup } from "@/components/base/avatar/avatar-label-group";
```

**Common Props:**

- `size`: `"xs" | "sm" | "md" | "lg" | "xl" | "2xl"` - Avatar size (note: `"xxs"` was removed in v8)
- `src`: `string` - Image URL
- `alt`: `string` - Alt text for accessibility
- `initials`: `string` - Text initials when no image
- `icon`: `FC` - Icon when no image
- `status`: `"online" | "offline"` - Status indicator
- `verified`: `boolean` - Verification badge
- `badge`: `ReactNode` - Custom badge element

**Examples:**

```typescript
// Basic avatar
<Avatar src="/avatar.jpg" alt="User Name" size="md" />

// With status
<Avatar src="/avatar.jpg" status="online" />

// With initials fallback
<Avatar initials="OR" size="lg" />

// Label group
<AvatarLabelGroup
  src="/avatar.jpg"
  title="Olivia Rhye"
  subtitle="olivia@untitledui.com"
  size="md"
/>
```

### FeaturedIcon

Decorative icon component with themed backgrounds for emphasis and visual hierarchy.

**Import:**

```typescript
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
```

**Common Props:**

- `icon`: `FC` - Icon component to display (required)
- `size`: `"sm" | "md" | "lg" | "xl"` - Icon container size
- `color`: `"brand" | "gray" | "error" | "warning" | "success"` - Color scheme
- `theme`: `"light" | "gradient" | "dark" | "modern" | "modern-neue" | "outline"` - Visual theme style

**Theme Styles:**

- `light`: Subtle background with colored icon
- `gradient`: Gradient background effect
- `dark`: Solid colored background with white icon
- `modern`: Contemporary gray styling (gray color only)
- `modern-neue`: Alternative modern style (gray color only)
- `outline`: Border style with transparent background

**Examples:**

```typescript
// Basic featured icon
<FeaturedIcon icon={CheckCircle} color="success" theme="light" size="lg" />

// With gradient theme
<FeaturedIcon icon={AlertCircle} color="warning" theme="gradient" size="xl" />

// Dark theme for emphasis
<FeaturedIcon icon={XCircle} color="error" theme="dark" size="md" />

// Outline style
<FeaturedIcon icon={InfoCircle} color="brand" theme="outline" size="lg" />

// Modern styles (IMPORTANT: gray only)
<FeaturedIcon icon={Settings} color="gray" theme="modern" size="lg" />
```

### Link

**Note**: There is no dedicated Link component. Instead, use the Button component with an `href` prop and link-specific color variants.

**Import:**

```typescript
import { Button } from "@/components/base/buttons/button";
```

**Link Colors:**

- `link-gray` - Gray link styling
- `link-color` - Brand color link styling
- `link-destructive` - Destructive link styling

**Examples:**

```typescript
// Basic link
<Button href="/dashboard" color="link-color">View Dashboard</Button>

// With icon
<Button href="/settings" color="link-gray" iconLeading={Settings01}>
  Settings
</Button>

// Destructive link
<Button href="/delete" color="link-destructive" iconLeading={Trash02}>
  Delete Account
</Button>

// External link
<Button href="https://example.com" color="link-color" iconTrailing={ExternalLink01}>
  Visit Site
</Button>
```

### Common Component Patterns

1. **Size Variants**: Most components support `sm`, `md`, `lg` sizes
2. **State Props**: `isDisabled`, `isLoading`, `isInvalid`, `isRequired` are common
3. **Icon Support**: Components accept icons as both components (`Icon`) or elements (`<Icon />`)
4. **Compound Components**: Complex components use dot notation (e.g., `Select.Item`, `Select.ComboBox`)
5. **Accessibility**: All components include proper ARIA attributes and keyboard support

### Icon Usage

When passing icons to components:

```typescript
// As component reference (preferred)
<Button iconLeading={ChevronDown}>Options</Button>

// As element (must include data-icon)
<Button iconLeading={<ChevronDown data-icon className="size-4" />}>Options</Button>
```

## COLORS

MUST use color classes to style elements.

Bad:

- text-gray-900
- text-gray-600
- bg-blue-700

Good:

- text-primary
- text-secondary
- bg-primary

### Text Color

Use text color variables to manage all text fill colors in your designs across light and dark modes.

| Name                       | Usage                                                                                                                                                                |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text-primary               | Primary text such as page headings.                                                                                                                                  |
| text-primary_on-brand      | Primary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. CTA sections).                                         |
| text-secondary             | Secondary text such as labels and section headings.                                                                                                                  |
| text-secondary_hover       | Secondary text when in hover state.                                                                                                                                  |
| text-secondary_on-brand    | Secondary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. CTA sections).                                       |
| text-tertiary              | Tertiary text such as supporting text and paragraph text.                                                                                                            |
| text-tertiary_hover        | Tertiary text when in hover state.                                                                                                                                   |
| text-tertiary_on-brand     | Tertiary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. CTA sections).                                        |
| text-quaternary            | Quaternary text for more subtle and lower-contrast text, such as footer column headings.                                                                             |
| text-quaternary_on-brand   | Quaternary text when used on solid brand color backgrounds. Commonly used for brand theme website sections (e.g. footers).                                           |
| text-white                 | Text that is always white, regardless of the mode.                                                                                                                   |
| text-placeholder           | Default color for placeholder text such as input field placeholders. This can be changed to gray-400, but gray-500 is more accessible because it is higher contrast. |
| text-brand-primary         | Primary brand text useful for headings (e.g. cards in pricing page headers).                                                                                         |
| text-brand-secondary       | Secondary brand text for brand buttons, as well as accented text, highlights, and subheadings (e.g. subheadings in blog post cards).                                 |
| text-brand-secondary_hover | Secondary brand text when in hover state (e.g. brand buttons).                                                                                                       |
| text-brand-tertiary        | Tertiary brand text for lighter accented text and highlights (e.g. numbers in metric cards).                                                                         |
| text-brand-tertiary_alt    | An alternative to tertiary brand text that is lighter in dark mode (e.g. numbers in metric cards).                                                                   |
| text-error-primary         | Default error state semantic text color (e.g. input field error states).                                                                                             |
| text-warning-primary       | Default warning state semantic text color.                                                                                                                           |
| text-success-primary       | Default success state semantic text color.                                                                                                                           |

### Border Color

Use border color variables to manage all stroke colors in your designs across light and dark modes. You can use the same values for `ring-` and `outline-` as well (i.e. `ring-primary` `outline-secondary`).

| Name                 | Usage                                                                                                                                                                                   |
| :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| border-primary       | High contrast borders. These are used for components such as input fields, button groups, and checkboxes.                                                                               |
| border-secondary     | Medium contrast borders. This is the most commonly used border color and is the default for most components (e.g. file uploaders), cards (such as tables), and content dividers.        |
| border-secondary_alt | An alternative to secondary border that uses alpha transparency. This is used exclusively for floating menus such as input dropdowns and notifications to create sharper bottom border. |
| border-tertiary      | Low contrast borders useful for very subtle dividers and borders such as line and bar chart axis dividers.                                                                              |
| border-brand         | Default brand border color. Useful for active states in components such as input fields.                                                                                                |
| border-brand_alt     | An brand border color that switches to gray when in dark mode. Useful for components such as brand-style variants of banners and footers.                                               |
| border-error         | Default error state semantic border color. Useful for error states in components such as input fields and file uploaders.                                                               |
| border-error_subtle  | A more subtle (lower contrast) alternative for error state semantic borders such as error state input fields.                                                                           |

### Foreground Color

Use foreground color variables to manage all non-text foreground elements in your designs across light and dark modes. Can be used via `text-`, `bg-`, `ring-`, `outline-`, `stroke-`, `fill-`, etc.

| Name                   | Usage                                                                                                                                                         |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fg-primary             | Highest contrast non-text foreground elements such as icons.                                                                                                  |
| fg-secondary           | High contrast non-text foreground elements such as icons.                                                                                                     |
| fg-secondary_hover     | Secondary foreground elements when in hover state.                                                                                                            |
| fg-tertiary            | Medium contrast non-text foreground elements such as icons.                                                                                                   |
| fg-tertiary_hover      | Tertiary foreground elements when in hover state.                                                                                                             |
| fg-quaternary          | Low contrast non-text foreground elements such as icons in buttons, help icons and icons used in input fields.                                                |
| fg-quaternary_hover    | Quaternary foreground elements when in hover state, such as help icons.                                                                                       |
| fg-white               | Foreground elements that are always white, regardless of the mode.                                                                                            |
| fg-brand-primary       | Primary brand color non-text foreground elements such as featured icons and progress bars.                                                                    |
| fg-brand-primary_alt   | An alternative for primary brand color non-text foreground elements that switches to gray when in dark mode such as active horizontal tabs.                   |
| fg-brand-secondary     | Secondary brand color non-text foreground elements such as accents and arrows in marketing site sections (e.g. hero header sections).                         |
| fg-brand-secondary_alt | An alternative for secondary brand color non-text foreground elements that switches to gray when in dark mode such as brand buttons.                          |
| fg-error-primary       | Primary error state color for non-text foreground elements such as featured icons.                                                                            |
| fg-error-secondary     | Secondary error state color for non-text foreground elements such as icons in error state input fields and negative metrics item charts and icons.            |
| fg-warning-primary     | Primary warning state color for non-text foreground elements such as featured icons.                                                                          |
| fg-warning-secondary   | Secondary warning state color for non-text foreground elements.                                                                                               |
| fg-success-primary     | Primary success state color for non-text foreground elements such as featured icons.                                                                          |
| fg-success-secondary   | Secondary success state color for non-text foreground elements such as button dots, avatar online indicator dots, and positive metrics item charts and icons. |

### Background Color

Use background color variables to manage all fill colors for elements in your designs across light and dark modes.

| Name                    | Usage                                                                                                                                                                                         |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bg-primary              | The primary background color (white) used across all layouts and components.                                                                                                                  |
| bg-primary_alt          | An alternative primary background color (white) that switches to bg-secondary when in dark mode.                                                                                              |
| bg-primary_hover        | Primary background hover color. This acts as the default hover state background color for components with white backgrounds (e.g. input dropdown menu items).                                 |
| bg-primary-solid        | The primary dark background color used across layouts and components. This switches to bg-secondary when in dark mode and is useful for components such as tooltips and Text editor tooltips. |
| bg-secondary            | The secondary background color used to create contrast against white backgrounds, such as website section backgrounds.                                                                        |
| bg-secondary_alt        | An alternative secondary background color that switches to bg-primary when in dark mode. Useful for components such as border-style horizontal tabs.                                          |
| bg-secondary_hover      | Secondary background hover color. Useful for hover states for components with gray-50 backgrounds such as active states (e.g. navigation items and date pickers).                             |
| bg-secondary_subtle     | An alternative secondary background color that is slightly lighter and more subtle in light mode. This is useful for components such as banners.                                              |
| bg-secondary-solid      | The secondary dark background color used across layouts and components. This is useful for components such as featured icons.                                                                 |
| bg-tertiary             | The tertiary background color used to create contrast against light backgrounds such as toggles.                                                                                              |
| bg-quaternary           | The quaternary background color used to create contrast against light backgrounds, such as sliders and progress bars.                                                                         |
| bg-active               | Default active background color for components such as selected menu items in input dropdowns.                                                                                                |
| bg-overlay              | Default background color for background overlays. These are useful for overlay components such as modals.                                                                                     |
| bg-brand-primary        | The primary brand background color. Useful for components such as check icons.                                                                                                                |
| bg-brand-primary_alt    | An alternative primary brand background color that switches to bg-secondary when in dark mode. Useful for components such as active horizontal tabs.                                          |
| bg-brand-secondary      | The secondary brand background color. Useful for components such as featured icons.                                                                                                           |
| bg-brand-solid          | Default solid (dark) brand background color. Useful for components such as toggles and messages.                                                                                              |
| bg-brand-solid_hover    | Solid brand background color when in hover state. Useful for components such as toggles.                                                                                                      |
| bg-brand-section        | This is the default dark brand color background used for website sections such as CTA sections and testimonials. Switches to bg-secondary when in dark mode.                                  |
| bg-brand-section_subtle | An alternative brand section background color to provide contrast for website sections such as FAQ sections. Switches to bg-primary when in dark mode.                                        |
| bg-error-primary        | Primary error state background color for components such as buttons.                                                                                                                          |
| bg-error-secondary      | Secondary error state background color for components such as featured icons.                                                                                                                 |
| bg-error-solid          | Default solid (dark) error state background color for components such as buttons, featured icons and metric items.                                                                            |
| bg-error-solid_hover    | Default solid (dark) error hover state background color for components such as buttons.                                                                                                       |
| bg-warning-primary      | Primary warning state background color for components.                                                                                                                                        |
| bg-warning-secondary    | Secondary warning state background color for components such as featured icons.                                                                                                               |
| bg-warning-solid        | Default solid (dark) warning state background color for components such as featured icons.                                                                                                    |
| bg-success-primary      | Primary success state background color for components.                                                                                                                                        |
| bg-success-secondary    | Secondary success state background color for components such as featured icons.                                                                                                               |
| bg-success-solid        | Default solid (dark) success state background color for components such as featured icons and metric items.                                                                                   |
