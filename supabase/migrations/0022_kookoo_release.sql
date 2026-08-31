-- Leaving a call is not the same as ending it.
--
-- `kookoo.hangup` issues Disconnect against the caller's number, which is right
-- at the end of a conversation and wrong immediately after a transfer: the
-- clinic's flow routes `Bring in the front desk -> ok` into a hangup node, so a
-- conference that worked would have connected the caller to the front desk and
-- then dropped them a moment later.
--
-- The distinction the graph was missing is between "this call is over" and "our
-- part in it is over". This is the second: the flow stops, and the carrier
-- leaves the two humans talking.
--
-- Per the vocabulary, a carrier action is a registry row rather than a new
-- primitive — it is a `custom` node like every other KooKoo action.

begin;

insert into public.catalogue_node_types
  (id, node_type, label, description, provider_action, outcomes, fields, sort_order, suspends)
values (
  'kookoo.release',
  'custom',
  'Step back',
  'Ends the flow without hanging up. Use after a transfer, when the caller is '
  || 'now talking to somebody else and the agent has nothing left to do.',
  null,
  '[{"id": "__end__", "label": "Done"}]'::jsonb,
  '[{"name": "reason", "type": "string", "label": "Why", "required": false,
     "help": "Recorded on the call as ended_reason."}]'::jsonb,
  (select coalesce(max(sort_order), 0) + 1 from public.catalogue_node_types),
  false
)
on conflict (id) do update set
  label       = excluded.label,
  description = excluded.description,
  outcomes    = excluded.outcomes,
  fields      = excluded.fields;

commit;
