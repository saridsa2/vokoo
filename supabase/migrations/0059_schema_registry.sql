-- Named schemas, tracked in one place.
--
-- `structured_outputs` was named for one use — what a post-call flow extracts —
-- and the thing it holds is more general: a named JSON schema. A tool declares
-- one as its input. An intelligence node fills one in. A CRM's payload is one.
-- Tracking them together is what makes a schema pushed from the CLI visible
-- beside one written in the console.
--
-- The table keeps its name. Renaming it would break `resolve`/PostgREST paths
-- and the bridge's reader for no gain — the console's word for it is what
-- needed fixing, and a comment is where a table says what it is.

comment on table public.structured_outputs is
  'Named JSON schemas. An intelligence node fills one in; a webhook sends it on. Shown in the console as "Schemas", beside the read-only schemas that pushed tools declare.';

-- The node's field goes back to naming one of these. The alternative — fields
-- inline on the node — was briefly applied and reverted: it makes every
-- integration carry its own copy of a shape, which is exactly what a registry
-- exists to stop.
update public.catalogue_node_types
   set fields = '[
     {"key": "shape_id", "type": "structured_output", "label": "Schema to fill", "required": true,
      "help": "Defined once under Build → Schemas, and pointed at by every flow that needs it."},
     {"key": "provider", "type": "text", "label": "Provider", "required": false, "default": "minimax"},
     {"key": "model", "type": "text", "label": "Model", "required": false, "default": "MiniMax-M2",
      "help": "Pre-flight is the only check — MiniMax publishes no model list."},
     {"key": "instruction", "type": "text", "label": "Extra instruction", "required": false,
      "help": "Anything the schema''s own field descriptions do not already say."}
   ]'::jsonb
 where id = 'intelligence';
