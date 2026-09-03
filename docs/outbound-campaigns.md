# Outbound campaigns — the design, before any of it is built

Nothing outbound exists today. Every flow, trigger and binding in this system
assumes a call arrives; `resolve_for_event` is keyed on a DID somebody dialled.
This is the shape agreed on 3 September, written down before code so the parts
that are decisions can be argued with rather than discovered.

## What a campaign is

**Flow → campaign → audience.** The flow is authored in the composer and says
what happens on the call. The campaign says who to call, from which number, on
which channel, when, how fast, and how often to retry. The audience is a list of
contacts, each carrying whatever fields that campaign needs.

**There are no campaign types.** No `reminder` / `follow_up` / `lead` enum
deciding behaviour. An appointment reminder and a lead call differ in their
contact fields and their script, both of which are data. A type column would
mean a code path per business use, and the second one nobody anticipated would
not fit it.

## The structural difference from an inbound flow

An inbound flow can assume a human is on the line — somebody dialled, so
somebody is there. **An outbound flow cannot.** Its first branch is what
happened when we dialled.

That makes it a third board family beside `{call}` and `{post_call}`:

| family | trigger | the caller |
|---|---|---|
| `call` | `call.answered` | rang us |
| `post_call` | `call.ended` | gone |
| **`outbound`** | **`call.placed`** | **we rang them, and may have reached a machine** |

Only `answered` reaches a flow at all: busy, no-answer and rejected never open a
media session, so there is nothing for a graph to run on. Those are **dial
results**, handled by the campaign's retry policy — not by a node.

**Answering-machine detection is deliberately not assumed.** Asterisk has
`AMD()`; whether KooKoo exposes anything equivalent is unknown, and a `machine`
branch that never fires is worse than no branch. The trigger ships with one
outcome, `answered`, and gains `machine` when a carrier is shown to report it.

## The script is a template, not a second prompt

A campaign's script uses the expression substrate that already exists, with one
new root: **`$contact`**.

```
Remind {{ $contact.name }} that they see {{ $contact.doctor }}
on {{ $contact.date }} at {{ $contact.time }}.
```

**Not a second system prompt.** On 3 September the WhatsApp agent's base prompt
said "always reply in Hindi" while a section appended below it said to honour
the caller's choice; asked for English, the model resolved the contradiction by
escalating to a human and hanging up. Two prompts arguing is a failure mode this
project has already paid for. A template resolved by `expression.rs` cannot
contradict the agent, because it is not instructions — it is the facts of this
call, filled in.

`$contact` is the contact's `fields` object, whatever the campaign put there.
The flow author sees the keys of the uploaded list, the same way a post-call
flow sees the keys of a schema.

## Data

```
campaigns
  id, org_id, name, status            draft | running | paused | done
  flow_id                             an {outbound} flow
  channel                             pstn | whatsapp
  from_number_id                      which of our numbers places the call
  script                              the template above
  timezone, window_start, window_end  local calling hours
  days                                which weekdays
  max_concurrent                      pacing, and see the ceiling below
  max_attempts, retry_after_seconds
  retry_on                            which dial results are worth retrying

campaign_contacts
  id, org_id, campaign_id
  phone                               e164, unique per campaign
  fields                              jsonb — the merge data, arbitrary
  state                               pending | dialing | done | failed | suppressed
  attempts, last_dial_result, flow_outcome
  last_attempt_at, next_attempt_at
  lease_until                         see "crash safety"
  call_id                             the last call, for the transcript
  consent                             jsonb — WhatsApp permission, see below

suppressions
  org_id, phone, reason, until
```

`last_dial_result` and `flow_outcome` are separate on purpose. "Answered" and
"they confirmed the appointment" are different facts, and a campaign report that
conflates them cannot tell a bad list from a bad script.

**`suppressions` exists from the first migration even while empty.** Do-not-call
is not a feature to add once somebody complains; a table that has to be
back-filled after the fact is a table that was missing when it mattered.

## Crash safety, and the ceiling

**Three concurrent calls per KooKoo extension.** A fourth gets SIP 486 before
the bridge sees it. So a PSTN campaign is inherently slow — five hundred
contacts at three concurrent and ninety seconds a call is about four hours — and
pacing is part of the model rather than a setting somebody tunes later.

The dialer claims work with a **lease**: one statement moves a row to `dialing`
and sets `lease_until`, returning what it claimed. A restart reclaims anything
whose lease has expired. Without it, a bridge that restarts mid-campaign dials
people twice, which for a healthcare list is worse than dialling them not at
all.

## The KooKoo adapter, proven on 3 September

Six calls to a real handset. The mechanics, measured rather than assumed:

```
GET http://in1-cpaas.ozonetel.com/outbound/outbound.php
    api_key, phone_no, caller_id, outbound_version=2,
    url | extra_data, callback_url
->  <response><status>queued</status><message>SID</message></response>
```

**`extra_data` is the inline XML, not metadata.** The docs' own example is
`extra_data=<response><playtext>..</playtext><hangup/></response>`. Passing a
campaign label there cost five calls: KooKoo took the label as the XML to run,
found it invalid, and tore the call down the instant it was answered — no
`NewCall`, `process: none`, `duration: 0`, and nothing in the response saying
why. `url` and `extra_data` are alternatives, never both.

**`outbound_sid` is how an outbound call announces itself.** It appears in the
`NewCall` params beside the usual `sid`:

```json
{"event":"NewCall","called_number":"918040802529","cid":"919949879837",
 "outbound_sid":"34322178840270491","display_caller_id":"918040802529"}
```

That matters because `called_number` on an outbound call is **our own DID**, so
resolving a flow by number finds the *inbound* flow — the first successful test
answered a campaign call with the language menu. The rule is therefore: if
`outbound_sid` is present, resolve the campaign by that id and ignore the
number's binding entirely.

It is also the correlation key back to `campaign_contacts`, and the only one:
`extra_data` cannot carry a label, and the queued response returns the same id.

`display_caller_id` confirmed our own DID is presented, so a patient sees a
number they recognise and can ring back. That was the open question that
decided whether outbound was viable at all.

## TRAI limits are part of the model, not settings

From the carrier's own documentation, and they are not ours to tune:

| | |
|---|---|
| **50 calls a day** | email support for more |
| **No calls 21:00–09:00** | a hard window |
| **DND scrubbed automatically** | KooKoo refuses those numbers |

Fifty a day makes a KooKoo campaign a trickle, which is the argument for the
Asterisk trunk adapter arriving sooner than "when volume demands it". The
blackout window is why `campaigns` carries a timezone: 21:00 is local, and a
dialer working from UTC would ring patients at four in the morning.

DND being handled upstream is a genuine gift — the alternative is licensing a
list and being liable for it — but it means a contact can fail for a reason no
retry will fix, so `suppressions` records it rather than letting the dialer
try again tomorrow.

## Channel adapters, and the order to build in

The campaign, the audience and the dialer are channel-agnostic. Placing a call
is one trait with two implementations — and a third, `mock`, which is what makes
the machine provable before either carrier is understood.

**Build order, chosen so nothing waits on a carrier:**

1. Schema, the `{outbound}` family, the trigger node, the composer board.
2. The dialer: leasing, pacing, windows, retries — against `mock`. Every rule
   above is testable here with no phone involved.
3. The PSTN adapter. KooKoo's outbound REST API is an unknown; read their docs
   rather than guess, the way `docs/kookoo-platform.md` was written.
4. The WhatsApp adapter, which is the larger one — see below.

## WhatsApp outbound is permission-gated, per contact

This is not a detail of the adapter; it is a lifecycle the data model has to
carry. Meta requires call permission **obtained in advance**:

- a permission-request template, **one per user per 24 hours**
- once approved, the call must be placed **within 72 hours**
- permission is permanent, or temporary for **7 days**
- **four consecutive unanswered calls revokes it**

So a WhatsApp contact moves through `none → requested → approved until T →
callable → revoked`, and a campaign on that channel is really two loops: one
asking for permission, one calling those who granted it. The `consent` column
carries that state. A PSTN contact never enters it.

The endpoint also needs **digest auth**, which inbound does not use — Meta
authenticates us for business-initiated calls, where for inbound it simply
sends us an INVITE.

## What is deliberately not decided yet

- **Whether a campaign can span channels** — try WhatsApp, fall back to PSTN.
  The shell supports it; the rules for when to fall back are a product question
  and inventing them now would be inventing a requirement.
- **AMD**, as above.
- **Reporting.** `call_costs` and `engine_costs` already exist and a campaign
  view over them is a small thing once there are campaigns to report on.
