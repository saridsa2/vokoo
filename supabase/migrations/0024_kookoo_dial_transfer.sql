-- Handing the caller to a person, the way this carrier actually supports.
--
-- `kookoo.transfer` was written against a guessed REST endpoint and took an
-- `app_url`. The real mechanism is not a REST call at all: when our media
-- socket closes KooKoo asks the IVR webhook what to do next, and the call is
-- still up at that moment. Answering with `<dial>` bridges the caller to a
-- number. Answering with a goodbye — which is what this bridge did on every
-- call, inherited from the reference SDK's default branch — hangs up on them.
--
-- So the node takes a number, and the outcome only reports whether we had one
-- to queue. Whether the carrier accepts it is not known until it asks us.

begin;

insert into public.catalogue_node_types
  (id, node_type, label, description, provider_action, outcomes, fields, sort_order, is_active, suspends)
values (
  'kookoo.transfer',
  'custom',
  'Hand the call over',
  'Ends the conversation and connects the caller to another number. The agent '
  || 'leaves the call, so it cannot listen in afterwards — use "Bring in a '
  || 'person" if the agent should stay on the line.',
  null,
  '[{"id": "ok",     "label": "Handed over"},
    {"id": "failed", "label": "No number to dial"}]'::jsonb,
  '[{"name": "phoneno", "type": "string", "label": "Number to dial", "required": true,
     "help": "Passed to the carrier exactly as written."},
    {"name": "record", "type": "boolean", "label": "Record the call", "required": false,
     "default": true}]'::jsonb,
  (select coalesce(max(sort_order), 0) + 1 from public.catalogue_node_types),
  true,
  false
)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  outcomes = excluded.outcomes, fields = excluded.fields,
  is_active = true, suspends = false, provider_action = null;

-- Back from retirement, for the case it was actually right for.
--
-- It was written for after a conference, where hanging up would have dropped a
-- caller who had just been put through — wrong, because there the agent should
-- have stayed on the line. After a *cold* transfer it is exactly correct: the
-- flow is finished and the call must not be disconnected, because the carrier
-- is about to dial somebody.
update public.catalogue_node_types
set is_active = true,
    description = 'Ends the flow without hanging up. Use after handing the call '
      || 'over, when the carrier is connecting the caller to somebody else.'
where id = 'kookoo.release';

commit;
