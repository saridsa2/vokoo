-- The reader is the workspace's, not each node's.
--
-- `provider` and `model` were text fields on every intelligence node, so a
-- workspace with four post-call flows carried four copies of one decision —
-- and changing which model reads your calls meant opening four boards and
-- hoping you found them all. It is the same mistake as putting the schema on
-- the node, which the registry already fixed.
--
-- A workspace reads its calls with one model. That is a fact about the
-- organisation, and it belongs on the organisation.
--
-- No per-node override. One could be added the day somebody wants a stronger
-- model for one flow, and adding it then costs a field; having it now costs the
-- property that there is one answer to "what reads our calls".

alter table public.organizations
  add column if not exists intelligence_provider text not null default 'minimax',
  add column if not exists intelligence_model text not null default 'MiniMax-M2';

comment on column public.organizations.intelligence_provider is
  'Which vendor reads finished calls. Must serve the Anthropic Messages API — anthropic or minimax — because the shape is enforced by a forced tool call and not by parsing.';
comment on column public.organizations.intelligence_model is
  'The model that vendor should use. Pre-flight is the only check for a vendor that publishes no model list, which MiniMax does not.';

-- The node keeps the shape and the instruction, which are its own, and loses
-- the two that were never its to hold.
update public.catalogue_node_types
   set fields = '[
     {"key": "shape_id", "type": "structured_output", "label": "Schema to fill", "required": true,
      "help": "Defined once under Build → Schemas, and pointed at by every flow that needs it."},
     {"key": "instruction", "type": "text", "label": "Extra instruction", "required": false,
      "help": "Anything the schema''s own field descriptions do not already say. The model and provider are the workspace''s, under Configure."}
   ]'::jsonb
 where id = 'intelligence';
