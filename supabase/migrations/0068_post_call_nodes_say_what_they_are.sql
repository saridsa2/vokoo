-- The post-call nodes, corrected where they described themselves badly.
--
-- Three of these are wording; one is a type. The type is the one that matters:
-- a field whose `type` is "text" gets a text box, and a text box for "which
-- credential" or "which HTTP method" is a place to make a typo that nothing
-- catches until a flow runs. Both have a knowable set of answers, so both are
-- a choice rather than a sentence.

-- "Read the call" is what this node does to a transcript; it is not what the
-- node is for. The flow is a post-call flow — everything in it happens after
-- the call — so naming one node for its timing says nothing about it. What it
-- does is turn a conversation into a record.
update catalogue_node_types
   set label = 'Process call',
       description = 'Turn what was said into a filled-in schema, using a model. '
                     'The result is written to the call before anything is sent anywhere.'
 where id = 'intelligence';

-- `secret_vendor` becomes a picker over connected providers, and `method` a
-- fixed list. The list is what `webhook.rs` actually branches on: it matches
-- PUT and PATCH and falls through to POST, so offering GET here would send a
-- POST and say it sent a GET — the exact failure a dropdown is for.
update catalogue_node_types
   set description = 'POST the filled-in schema to another system.',
       fields = '[
         {"key":"url","type":"text","label":"URL","required":true,
          "help":"Where to POST. Use {{ }} to put a field from the schema in the path."},
         {"key":"method","type":"select","label":"Method","required":false,"default":"POST",
          "options":[{"id":"POST","label":"POST"},{"id":"PUT","label":"PUT"},
                     {"id":"PATCH","label":"PATCH"}]},
         {"key":"secret_vendor","type":"vendor","label":"Credential","required":false,
          "help":"A provider you have connected, sent as a bearer token. Never type a key here."},
         {"key":"body","type":"textarea","label":"Body","required":false,
          "help":"Leave empty to send the filled-in schema. Or write JSON with {{ }} to reference its fields."}
       ]'::jsonb
 where id = 'http.request';

-- `instruction` is prose, so it gets room to be prose.
update catalogue_node_types
   set fields = '[
         {"key":"shape_id","type":"structured_output","label":"Schema to fill","required":true,
          "help":"Defined once under Build - Schemas, and pointed at by every flow that needs it."},
         {"key":"instruction","type":"textarea","label":"Extra instruction","required":false,
          "help":"Anything the schema''s own field descriptions do not already say. The model and provider are the workspace''s, under Configure."}
       ]'::jsonb
 where id = 'intelligence';

-- The node this flow already runs carries the old name.
update flows
   set graph = jsonb_set(graph, '{nodes}', (
         select jsonb_agg(
           case when n->>'implementation' = 'intelligence'
                then jsonb_set(n, '{name}', '"Process call"')
                else n end)
           from jsonb_array_elements(graph->'nodes') n))
 where graph->'nodes' @> '[{"implementation":"intelligence"}]'::jsonb;
