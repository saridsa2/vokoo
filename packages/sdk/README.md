# @vokoo/sdk

Write functions an agent can call.

```ts
import { defineTool } from "@vokoo/sdk"

export default defineTool({
  id: "c9f84c8d-0bdc-4d8a-a393-6f0d1c75bdcf",
  name: "check_slots",
  description: "Find open appointment slots for a doctor on a date.",
  input: {
    doctor: { type: "string", required: true, description: "Surname, as the caller said it." },
    date:   { type: "string", required: true },
  },
  timeoutSeconds: 10,
  async handler({ doctor, date }, ctx) {
    const r = await ctx.fetch(`https://clinic.example/slots?doctor=${doctor}&date=${date}`)
    return { slots: (await r.json()).available }
  },
})
```

## The three fields that are not obvious

**`id`** is a UUID you write, and the server never assigns. Sync matches on it,
so renaming the tool is an update rather than a delete and an insert — which
would orphan every call record that named it and detach it from the skills it
was granted to. `vokoo new` generates it so you never type one.

Because the id is yours rather than the server's, two mistakes become possible
that otherwise could not: the same id on two tools, and the same name on two
tools. `assertPushable` refuses both before anything is sent.

**`description`** is prompt text. It is what the model reads when deciding
whether to call this rather than something else, so write it for that reader.
A tool with no description is one the model chooses by name alone, which is why
an empty one is refused.

**`input`** compiles to a JSON Schema with three readers that must agree: the
model is given it as a function declaration's `parameters`, the dispatcher
validates arguments against it, and the composer renders a config form from it.
When they disagree the model is shown one contract, calls it correctly, and the
executor rejects the call — so `defineTool` refuses anything ambiguous rather
than guessing. An array needs an item type. An enum has to match its field's
type. Argument names have to be addressable.

## What runs when

Everything is checked as the module loads, so a mistake is a build failure
rather than a live call ending in `finish_call(note: "Internal error checking
slots.")`.

## Context

`handler(args, ctx)` receives the call it is running for:

| | |
| --- | --- |
| `ctx.callId` | the call, or `null` under `vokoo run` |
| `ctx.orgId` | the organisation |
| `ctx.variables` | what the flow's `var` nodes have accumulated |
| `ctx.secrets` | resolved per invocation, never built into the bundle |
| `ctx.fetch` | outbound HTTP, wrapped so a call is attributable in the logs |

## Schemas

A named shape, declared the same way and compiled by the same `compileSchema`:

```ts
import { defineSchema } from "@vokoo/sdk"

export default defineSchema({
  id: "99d60285-21ad-40d5-8be0-222ddab5de20",
  name: "clinic_lead",
  description: "What a clinic wants in its CRM after a call.",
  fields: {
    patient_name: { type: "string", description: "As the caller said it." },
    intent:       { type: "string", required: true, enum: ["book", "cancel", "enquiry"] },
  },
})
```

`vokoo new --schema clinic_lead` scaffolds one into `schemas/`, and `vokoo push`
sends it with the tools. A schema ships a **declaration** — there is no code, so
nothing is stripped, checksummed or executed.

It exists because more than one thing wants the same shape: a tool declares what
it takes, an intelligence node fills one in from a call, a webhook sends one to
a CRM. Written separately they drift, and the drift is invisible until a payload
is rejected by something nobody told the shape had changed.

## Tests

```bash
node --test src/*.test.ts
```

No dependencies and no build step: Node 22 strips the types. Imports name the
real `.ts` file, because Node resolves what it is given rather than rewriting
`.js` to `.ts` the way a bundler would.

Design: `docs/specs/2026-09-01-functions-sdk.md`.
