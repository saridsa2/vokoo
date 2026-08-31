# Flows as event handlers — Phase 3

**Status:** design, nothing built.
**Supersedes:** the assumption in `docs/ROUTES.md` and the Composer that a number
has one flow.

## The model

A **call is the durable object.** Flows are **handlers bound to events on it** —
siblings, not subflows. They do not nest, do not return to a parent, and share
state through the call rather than a call stack.

This is a choice, not an industry consensus. Twilio Studio has a **Run Subflow**
widget that transfers control from one flow to another and returns variables to
the parent as `{{widgets.subflow_widget.foo}}` — nesting with a return path. We
are deliberately not doing that: a phone call already has one linear timeline,
and a call stack layered over it gives two places to look for where a call
"is". Amazon Connect's disconnect flow is genuinely sibling-shaped, and that is
the shape we are copying.

## The events

Per channel, not once globally. A node that is useless in a 30-second phone
conversation can be load-bearing in a message thread.

**Voice** (`calls`):

| event | inbound | outbound |
| --- | --- | --- |
| `call.answered` — the conversation | yes | yes |
| `call.ended` — post-call work | yes | yes |
| `call.never_answered` — busy, no answer, failed | n/a | yes |

**Message** (`chats`, table exists, 0 rows): `message.received` at minimum.
Not in scope for Phase 3; the schema must not preclude it.

## `call.ended` has two cases, and they are not the same

We had this backwards, and so did the earlier research note. Amazon Connect's
own worked example for a disconnect flow is a **post-call survey**: the agent
hangs up, **the customer stays on the line**, and Get customer input asks them
questions. The documented limit is the opposite of "no caller":

> It's not possible to play an audio prompt to the agent or invoke a flow when
> the customer disconnects. After the customer disconnects, the flow ends and
> the agent starts After Call Work.

So:

- **We ended it** (the agent's `finish_call` leads to hangup) — the caller may
  still be on the line. A survey, a confirmation, "we'll text you the booking"
  are all possible.
- **The caller hung up** — nobody is there. Silent work only.

We can already tell them apart. `calls.ended_reason` is the flow's own account;
`calls.disconnect_reason` is the carrier's. Migration 0020 says in its own
comment that the two disagreeing is informative — this is what it is
informative *about*. A `call.ended` handler must be able to branch on it.

## Schema

`flows` today: `id, org_id, name, description, status, graph, config,
created_at, updated_at, published_at`. No trigger. `config` is `{}` on the one
published row.

`phone_numbers` today: `..., agent_id, flow_id, config, ...`. One number, one
flow — which cannot express a set of sibling handlers.

Changes:

1. `flows.trigger_event text not null default 'call.answered'`, constrained to
   the known events. The trigger belongs to the flow, as in Twilio, where it is
   the flow's start widget.
2. `flows.channel text not null default 'voice'` — so a message handler is
   expressible without another table.
3. Replace the single `phone_numbers.flow_id` pointer with a binding that is
   keyed by event. Either a `number_flows (phone_number_id, trigger_event,
   flow_id)` table, or keep `flow_id` as the answered handler and resolve
   siblings by `(org_id, trigger_event)`. **Prefer the table**: two numbers in
   one organisation will eventually want different post-call behaviour, and the
   implicit form cannot say that.
4. Unique per `(phone_number_id, trigger_event)` — one handler per event per
   number. Ambiguity here is a coin toss at runtime.

`call_events.trigger_event` already exists, `not null default 'call.answered'`,
and all 27 live rows carry that value. Writing a second value is the proof that
Phase 3 works.

## The canvas

The trigger is **drawn**, as Twilio draws it: each flow's canvas opens with a
fixed anchor node naming its event, which you connect from and cannot delete.
"Call answered" and "call ended" are therefore two flows with two canvases —
not two nodes inside one canvas.

The composer screen lists the sibling handlers for a number and opens one.

**The palette is filtered by channel and trigger.** Of the 12 catalogue node
types, the ones that address a caller — `agent`, `kookoo.conference`,
`kookoo.transfer`, `kookoo.hold`, `kookoo.hangup`, `kookoo.release`,
`agent.monitor` — are valid in `call.answered`, and valid in `call.ended` only
while the caller is still on the line. `condition`, `loop`, `var` and `code` are
valid everywhere. `catalogue_node_types` has no column expressing this; it needs
one.

`loop` and `code` stay in the catalogue. They are close to useless on a voice
call and load-bearing in a message thread, which is the reason the palette
filters rather than the catalogue shrinking.

## The gap this exposes

A `call.ended` handler built from today's vocabulary can branch, set a variable
and evaluate an expression. It cannot send an SMS, call a webhook, or write a
record — **there is no node in the catalogue that acts on anything outside the
call.** Compare Twilio, whose library is mostly actions: Say/Play, Gather Input,
Record Voicemail, Send Message, HTTP Request, Run Function, Capture Payments.

An ended handler that cannot act is a canvas nobody opens twice. So Phase 3
carries one new node type: **HTTP request**, targeting a Supabase Edge Function.
It is the smallest useful post-call action and the prototype for tools in
general — CLAUDE.md's "tools reach the prompt; nothing executes one" is the same
gap seen from the agent's side.

## Order

1. Schema: trigger and channel on `flows`, the number-to-flow binding table,
   validity on `catalogue_node_types`.
2. Bridge: `resolve_for_did` resolves per event rather than one flow per number;
   the runner writes the real `trigger_event` into `call_events`.
3. Composer: trigger anchor node, palette filtered by channel and trigger, the
   screen listing sibling handlers.
4. HTTP request node, on an Edge Function.

Steps 1 and 2 are provable — a real call writing a `call.ended` row into
`call_events` is the acceptance test, and nothing before that point is evidence.

## Sources

- Amazon Connect, Set disconnect flow —
  https://docs.aws.amazon.com/connect/latest/adminguide/set-disconnect-flow.html
- Twilio Studio, Widget Library —
  https://www.twilio.com/docs/studio/widget-library
- Twilio Studio, Trigger (Start) widget —
  https://www.twilio.com/docs/studio/widget-library/trigger-start
- Twilio Studio, Subflows — https://www.twilio.com/docs/studio/subflows
