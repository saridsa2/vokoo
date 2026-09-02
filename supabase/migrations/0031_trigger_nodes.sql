-- The trigger as a node.
--
-- A flow already knows which event it handles — `flows.trigger_event` — but the
-- canvas had nowhere to show it, so every board opened on a node that seemed to
-- come from nothing. Drawing a label would have fixed the appearance and
-- nothing else. A node can carry outcomes, and that is the point: *why* the
-- event fired is routing information. A call that ended because the caller hung
-- up is a different call from one we ended, and a post-call handler that cannot
-- tell them apart is a handler that sends the survey to both.
--
-- One row per event rather than one `trigger` row configured by a field,
-- because outcomes are fixed per catalogue row and these two do not share a
-- set. `valid_triggers` then does the binding: a trigger type is valid only in
-- a flow that handles its own event, so `call.answered` cannot open with the
-- ended trigger.
--
-- Triggers are not addable. A flow gets its trigger when it is created, from
-- the event it handles; offering one in the palette would invite a second entry
-- point into a graph the runner starts at exactly one node.

begin;

-- Every existing row keeps the behaviour it has: the palette is what it was,
-- minus whatever sets this to false.
alter table public.catalogue_node_types
  add column if not exists is_addable boolean not null default true;

comment on column public.catalogue_node_types.is_addable is
  'Whether the composer offers this type in the add-node palette. False for triggers, which a flow is created with rather than given.';

insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action,
  outcomes, fields, sort_order, is_active, suspends, default_timeout_seconds,
  valid_triggers, is_addable
) values
(
  'trigger.call_answered',
  'trigger',
  'Call answered',
  'Someone called this number and the call connected. Everything the caller hears starts here.',
  null,
  '[{"id": "started", "label": "Call started"}]'::jsonb,
  '[]'::jsonb,
  -1,
  true,
  false,
  null,
  array['call.answered']::text[],
  false
),
(
  'trigger.call_ended',
  'trigger',
  'Call ended',
  'The call is over. Nobody is listening — this is where the work that happens after a call goes.',
  null,
  -- Who hung up is the carrier''s word and a closed set, so it is an outcome.
  -- Why is free text written by `kookoo.hangup` into `ended_reason`, so it is
  -- a variable a condition reads — a fixed outcome list could never cover it.
  '[{"id": "caller_hung_up", "label": "Caller hung up"},
    {"id": "we_ended", "label": "We ended it"}]'::jsonb,
  '[]'::jsonb,
  -1,
  true,
  false,
  null,
  array['call.ended']::text[],
  false
)
on conflict (id) do update set
  node_type      = excluded.node_type,
  label          = excluded.label,
  description    = excluded.description,
  outcomes       = excluded.outcomes,
  fields         = excluded.fields,
  sort_order     = excluded.sort_order,
  is_active      = excluded.is_active,
  valid_triggers = excluded.valid_triggers,
  is_addable     = excluded.is_addable;

commit;
