# The tools SDK, and what a console-built tool would need

A study of `@vokoo/sdk` — what it is, what is actually built behind it, and what
that means for building tools on a composer canvas.

**This does not replace the existing documents.** `packages/sdk/README.md` is
how to write a tool, and `docs/specs/2026-09-01-functions-sdk.md` is 21KB of why
it is shaped that way. Both are good and neither is out of date. What was
missing is the thing this project keeps discovering the hard way: **which parts
of a well-designed contract are wired to nothing.**

---

## The shape, briefly

One call declares a tool and implements it together:

```ts
export default defineTool({
  id: "c9f84c8d-…",          // a UUID you write; the server never assigns one
  name: "check_slots",        // what the model calls
  description: "…",           // prompt text — what the model reads to decide
  input: { doctor: { type: "string", required: true } },
  timeoutSeconds: 10,
  async handler({ doctor }, ctx) { … },
})
```

Everything is validated as the module loads, so a mistake is a build failure
rather than a live call ending in `finish_call(note: "Internal error")`.

Three properties are load-bearing and worth knowing before generating any of it:

**The id is authored, not assigned.** Sync matches on it, so renaming a tool is
an `UPDATE`. If the server assigned ids, a rename would be a delete and an
insert — orphaning every `call_events` row that named the tool and detaching it
from the skills it was granted to.

**`input` compiles to a JSON Schema with three readers that must agree**: the
model is shown it as a function declaration's `parameters`, the dispatcher
validates arguments against it, and the composer renders a form from it. When
they disagree you get the worst failure available — the model is shown one
contract, calls it correctly, and the executor rejects the call. `compileSchema`
refuses anything ambiguous rather than guessing.

**`decompileSchema` is the inverse, and it exists specifically for
console-made tools** — "a tool made in the console has a schema on the server
and no source anywhere". The round trip was designed for before it was needed.

---

## What is built

Everything, except where noted below.

| | State |
| --- | --- |
| `defineTool`, `compileSchema`, `decompileSchema` | built, tested |
| CLI: `login logout whoami init new pull push dev run logs` | all implemented |
| `tool_versions` — code, checksum, version, snapshot | built; 6 tools pushed |
| Dispatcher (`supabase/functions/tools`) | built; 30 live executions recorded |
| Arguments and results per call | recorded in `call_events.detail` |
| API keys as machine users, `vk_live_…` | built (migration 0032) |

## What is not

### `ctx.secrets` is empty. Always.

The SDK declares it. The README documents it as *"resolved per invocation, never
built into the bundle."* The `run` function types it and forwards it. And the
dispatcher passes:

```ts
ctx: { callId: call_id, orgId: org_id, variables, secrets: {} },
```

**Nothing ever puts anything in it.** A tool that needs a credential — which is
every integration with anything — has no way to get one today.

This is not hard to close, and the pieces are all present: credentials live in
`vendor_credentials`, the vault decrypts them through `resolve_vendor_secret`,
and since migration 0046 only `service_role` may call it — which the dispatcher
holds and the `run` isolate deliberately does not (see
`docs/vendor-overrides.md`). So the dispatcher is exactly the right place to
resolve them, and the empty object is a gap rather than a design.

**Until it is closed, no CRM tool can work, however it is authored.** It is the
first thing to build, before any canvas.

### The console must not edit a pushed tool

Decided in the spec and worth preserving: *"The source is shown and not edited.
A pushed tool's authority is a repository; editing it here would make the
console a second author, and the next `vokoo push` would overwrite what was
typed without saying so."*

This does **not** rule out a composer canvas, and the distinction is the whole
design:

| | authority | generated code is |
| --- | --- | --- |
| pushed tool | a git repository | the source |
| composer tool | **the graph** | a build artifact |

Two authorities, never for the same tool. `tools.kind` already separates them
and has no constraint on its values, so no migration is needed to add one.

### Adoption exists in spec, not in code

The spec names it: a `vokoo pull` that writes a stub carrying the existing id
would let the SDK take over a console-made tool. `pull` is implemented; whether
it writes an adoptable stub for a tool with no source has not been checked.

That is the **eject** path — draw it, outgrow it, pull it into a repo, and from
then on the repo is the authority. Worth confirming before a canvas exists,
because a canvas with no exit is a ceiling.

### Open, from the spec, still open

- **The live budget returns `ok: true` on timeout**, telling the model a tool
  succeeded when it did not.
- **`ToolCallCancellation` is unhandled.** Gemini cancels a tool call when the
  caller interrupts; the side effect still runs — an appointment booked for a
  turn the model abandoned. Matters more as tools do real work.
- **Nothing enforces that a tool the model calls is one the agent's skills
  granted.** `call_live` sends no `agent_id`, so the dispatcher could not check
  even if it wanted to.

That third one grows teeth the moment tools start writing to a CRM.

---

## What this means for a composer canvas

The canvas should **generate the same `defineTool` TypeScript** and store it in
`tool_versions` like any push — a code generator, not a second runtime. That
follows from the SDK rather than working around it:

- One runtime. No graph interpreter to write, secure and keep in step.
- `tool_versions` already versions and checksums whatever is stored.
- The generated code is inspectable, and ejectable via the adoption path above.
- `decompileSchema` already handles the direction a console tool needs.

A first version needs three node types and **no expression language**:

```
tool.input  ──▶  http.request  ──▶  tool.output
```

A CRM lookup is input → request → return, with `{{ input.field }}` templating
into the URL and body. No `condition`, no `loop` — so this is not blocked on the
expression work deferred on 1 September.

It also needs a `family` column on `catalogue_node_types` so the board can
filter its palette: `call` for the existing sixteen, `tool` for these three. The
same switch serves Integrations later.

**Order matters here.** `ctx.secrets` first, because without it the canvas can
draw a CRM tool that cannot authenticate — a screen that produces something
which cannot work is worse than no screen.
