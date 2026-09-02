-- "Schema", not "Schema to fill". The field sits under a heading that already
-- says what the node does; the second half was the sentence, not the name.
update catalogue_node_types
   set fields = '[
         {"key":"shape_id","type":"structured_output","label":"Schema","required":true,
          "help":"Defined once under Build - Schemas, and pointed at by every flow that needs it."},
         {"key":"instruction","type":"textarea","label":"Extra instruction","required":false,
          "help":"Anything the schema''s own field descriptions do not already say. The model and provider are the workspace''s, under Configure."}
       ]'::jsonb
 where id = 'intelligence';

-- The webhook body becomes a `template`, which is a textarea that also lists
-- what there is to reference.
--
-- Nothing about what it sends changes: `fill()` has always substituted
-- `{{ shape.patient_name }}`, and an empty body has always sent the whole
-- reading. Both were undiscoverable — the author had no way to learn that
-- `shape` is where the extraction lands, or what is in it, short of reading
-- `postcall.rs`. A field that can reference things should say which.
update catalogue_node_types
   set fields = jsonb_set(
         fields,
         '{3}',
         '{"key":"body","type":"template","label":"Body","required":false,
           "help":"Leave empty to send the whole reading. Or write JSON and click a value below to reference it."}'::jsonb)
 where id = 'http.request'
   and fields->3->>'key' = 'body';
