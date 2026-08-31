-- A flow node that calls a tool.
--
-- Until now a flow could branch, wait and hand a caller around, but it could not
-- act on anything outside the call. That is most of what a `call.ended` handler
-- exists to do — write the record, send the message, tell the other system —
-- and it is the same gap CLAUDE.md records from the agent's side as "tools reach
-- the prompt; nothing executes one".
--
-- It names a tool rather than a URL. A URL on the node would put a second copy
-- of the endpoint next to `tools.endpoint_url`, and the dispatcher validates
-- arguments against `tools.schema` — a node that bypassed the row would be
-- validated against nothing.
--
-- Arguments come from the call's `variables`. There is no expression language
-- yet, and inventing one here would decide it by accident: the `var` node fills
-- variables, this node spends them, and the dispatcher rejects the call if the
-- tool's required arguments are not among them.

begin;

insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action,
  outcomes, fields, sort_order, is_active, suspends, default_timeout_seconds,
  valid_triggers
) values (
  'tool.call',
  'custom',
  'Call a tool',
  'Run one of this organisation''s tools and take a branch on how it answered.',
  null,
  '[{"id": "ok", "label": "Answered"},
    {"id": "working", "label": "Still working"},
    {"id": "failed", "label": "Could not"}]'::jsonb,
  -- `tool` is the tool''s name, which is unique per organisation. The composer
  -- should offer the organisation''s tools rather than a free text box, but the
  -- stored value is the name either way.
  '[{"name": "tool", "type": "string", "label": "Tool", "required": true,
     "help": "Which tool to run. Its arguments are taken from the call''s variables."}]'::jsonb,
  13,
  true,
  false,
  null,
  array['call.answered', 'call.ended', 'call.never_answered', 'message.received']::text[]
)
on conflict (id) do update set
  label            = excluded.label,
  description      = excluded.description,
  outcomes         = excluded.outcomes,
  fields           = excluded.fields,
  is_active        = excluded.is_active,
  valid_triggers   = excluded.valid_triggers;

commit;
