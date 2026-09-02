-- Escalate a failed call instead of leaving the caller in silence.
--
-- An exception flow, in n8n's sense: its own flow, on its own trigger, that
-- many flows can point at. Not a field on each flow, because escalating to
-- support is one destination shared by all of them — and a field copied into
-- twenty flows is twenty places to update when the support number changes.
--
-- It needs no new resolution machinery. `number_flows` already keys on
-- `(phone_number_id, trigger_event)` and the bridge's `resolve_for_event`
-- already takes the trigger as an argument, so binding a `call.failed` flow to
-- a number is the same row shape as binding the `call.answered` one.
--
-- The four causes are each something that has happened or been observed on a
-- real call, not a taxonomy of everything that could go wrong:
--
--   engine_failed  a relay was published on Sarvam's retired `bulbul:v2`; the
--                  call connected, transcribed, thought, and the caller heard
--                  nothing at all.
--   provider_lost  a provider dropping mid-call, which pre-flight already
--                  reports as an ErrorFrame before the call.
--   no_audio       1 September, 11:34 — forty-two seconds with no VAD event,
--                  no frame, no error, until the caller gave up. The Primer
--                  watchdog detects this and today only logs it.
--   crashed        1 September, 12:53 — a Hindi greeting panicked the sentence
--                  splitter, the TTS task died, the line went silent and the
--                  caller hung up after eight seconds.
--
-- A cause nobody has seen is a branch nobody can test, so this list grows from
-- evidence rather than from imagination.

insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action,
  outcomes, fields, suspends, default_timeout_seconds,
  sort_order, is_active, is_addable
) values (
  'trigger.call_failed',
  'trigger',
  'Call failed',
  'The call could not be served. Escalate rather than leave the caller in silence.',
  null,
  '[{"id": "engine_failed", "label": "The engine would not start"},
    {"id": "provider_lost", "label": "A provider dropped mid-call"},
    {"id": "no_audio",      "label": "The caller went silent to us"},
    {"id": "crashed",       "label": "Something crashed"}]'::jsonb,
  '[]'::jsonb,
  false,
  null,
  -1,
  true,
  -- Triggers arrive with the flow rather than from the palette.
  false
)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  outcomes = excluded.outcomes,
  is_active = excluded.is_active,
  is_addable = excluded.is_addable;

-- Where a call escalates when its own number names no `call.failed` flow.
--
-- A number that has not been given an exception flow is the normal case, not a
-- misconfiguration, so the organisation carries the fallback. Null means the
-- call ends the way it does today: silence, then the carrier hangs up.
alter table public.organizations
  add column if not exists escalation_number text;

comment on column public.organizations.escalation_number is
  'Number a failed call is transferred to when no call.failed flow is bound to the DID. Null means no escalation — the caller is left with whatever the failure did to the line.';
