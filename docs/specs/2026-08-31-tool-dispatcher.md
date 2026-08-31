# The tool dispatcher

**Status:** contract. Nothing built.
**Depends on:** a change to the realtime client that does not exist yet — see
"The gap that blocks the live path".

## Why one function and not one per tool

Every tool becomes a Supabase Edge Function invocation, and every invocation
goes through a single dispatcher at `/functions/v1/tools`. `tools.kind` keeps
its meaning — it says how the dispatcher fulfils the call — but there is one
endpoint, one deployment, one warm instance.

One function per tool would deploy independently, which is the only argument
for it. Against: four tools become four cold starts on a call where a caller is
mid-sentence, and the things every tool needs — organisation scoping, the call
context, a timeout, and a `call_events` row — would be copied four times and
drift. A tool invocation that does not appear in the call trace is invisible
exactly when someone is trying to work out why a call went wrong.

## Request

`POST /functions/v1/tools`, service-role key in `Authorization`. The bridge
holds that key; a browser never calls this.

```json
{
  "tool": "book_appointment",
  "args": { "doctor": "Rao", "slot": "2026-09-02T15:00+05:30", "patient_name": "..." },
  "org_id": "d6e07acf-…",
  "call_id": "…",
  "invocation": "live" | "flow",
  "sequence": 7
}
```

- `tool` is `tools.name`, unique per organisation.
- `args` are validated against `tools.schema`, which is already a plain JSON
  Schema — `book_appointment` stores
  `{"type":"object","required":["doctor","slot","patient_name"],…}`. That is
  what Gemini's `parameters` field takes unchanged, so the model, the flow
  node's config form and this validation all read one declaration. If they ever
  diverge, the model calls a tool with arguments the executor rejects.
- `org_id` is not taken from the caller's word for it: the dispatcher checks the
  tool belongs to that organisation before running anything.
- `call_id` is what makes the invocation traceable, and it is how a tool reaches
  the shared state on `calls.variables`.
- `invocation` distinguishes the two callers, because they have different
  tolerances — see below.
- `sequence` is the position in the call's trace, so the `call_events` row this
  writes sits in order with the flow's own steps.

## Response

```json
{
  "ok": true,
  "result": { "booking_id": "…", "confirmed_for": "Thursday at 3pm" },
  "outcome": "booked",
  "speak": "You're booked with Dr Rao on Thursday at 3."
}
```

- `result` goes back to the model as the function response. It is the only
  field the model sees, and it should read as data, not prose.
- `outcome` is optional and names a skill outcome. Present, it lets one call
  both answer the model and move the graph. Absent, only the model is affected.
- `speak` is optional and advisory: a line the agent may use. The model is not
  obliged to say it, and nothing downstream depends on it having been said.

On failure:

```json
{ "ok": false, "error": "no_slot", "message": "That time was taken while we spoke." }
```

`error` is a stable identifier the flow can branch on. `message` is for the
model and the log, and is never parsed.

## Timeouts, and why the two callers differ

A tool call arrives at `services/realtime/mod.rs:292`, inside the audio loop,
**with a caller mid-sentence**. Nothing else in this system runs under that
constraint.

| | `invocation: "live"` | `invocation: "flow"` |
| --- | --- | --- |
| caller | on the line | may have gone |
| dispatcher budget | **2s hard** | 30s |
| on timeout | return `ok:false, error:"timed_out"` so the agent can say something | the node takes its `failed` outcome |
| retry | never — the caller is waiting | at the flow's discretion |

The live budget is a promise to the caller, not a property of the work. A tool
that cannot answer in two seconds should return `ok:false` with an error the
agent can speak, and do its work afterwards from the `call.ended` handler.

## What it writes

One `call_events` row per invocation: `node_id` null for a live call,
`implementation` the tool name, `outcome` the `outcome` field or `ok`/`error`,
`duration_ms` measured, `detail` the args and result. This is what makes a tool
call visible in the same timeline as the flow's own steps.

## The gap that blocks the live path

**The bridge can receive a tool call and has no way to answer one.**
`RealtimeSession` (`services/realtime/mod.rs:72`) declares `send_audio` and
`send_text` and nothing else. `mod.rs:292` receives `RealtimeEvent::ToolCall`
and forwards it as an outcome — which is right for `finish_call`, where the
flow decides and the model needs nothing back, and insufficient for a real tool,
where the model must hear "booked for Thursday" to keep talking.

So the live path needs, before any of this is reachable:

1. `RealtimeSession::send_tool_response(id, result)` on the trait.
2. A Gemini implementation sending `BidiGenerateContentToolResponse` with the
   `id` from the original call.
3. An OpenAI implementation, or an explicit refusal for that provider.
4. `mod.rs` routing a tool call to the dispatcher and the reply back into the
   session, instead of only forwarding it as an outcome.

The `id` on `RealtimeEvent::ToolCall { id, name, args }` already exists and is
currently discarded at `mod.rs:292`, which is the correlation key a response
needs.

**The flow path has no such gap.** A node invoking the dispatcher needs nothing
from the realtime client. That is the shorter route to something working, and it
is also the post-call action the `call.ended` handler lacks.

## Order

1. Dispatcher Edge Function, `invocation: "flow"` only. Provable with `curl`.
2. The `http.request` node type calling it, so a flow can act.
3. `send_tool_response` on the trait and in the Gemini client.
4. Route live tool calls through the dispatcher and answer the model.

Steps 1 and 2 give the `call.ended` handler something to do. Step 3 is a change
to the call path and gets tested on a real call, not asserted.

## Open

- The four existing tools point at `vayuveda.example`. They need real targets
  before any of this does anything useful.
- `skills` needs a stable outcome id beside its prose `completion`, or
  `outcome` in the response above has nothing to name.
- Nothing yet enforces that a tool the model can call is one the agent's skills
  actually granted. The prompt and the tool list agreeing is a property worth
  asserting in the dispatcher, not just assembling correctly upstream.
