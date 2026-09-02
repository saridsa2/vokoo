-- `condition` and `loop` stop being free-text boxes.
--
-- This project settled the shape on 1 September and never built it: an IF row
-- is **structured** — left operand, operator, right operand — where either side
-- may be a literal or an expression, "rather than the node's whole surface
-- being a language. A typo then degrades one operand instead of failing the
-- node on a live call."
--
-- That reasoning is why `condition` may stay on the calls board while `code`
-- may not. Comparing two values needs no evaluator: on a live call each side
-- resolves as a path and the comparison is Rust. The same row on an
-- integration resolves through the scripted scope, so the operands can compute.
update catalogue_node_types
   set fields = '[
         {"key":"left","type":"text","label":"Value","required":true,
          "help":"Usually an expression — drag a value in from the left."},
         {"key":"operator","type":"select","label":"Is","required":true,"default":"equals",
          "options":[{"id":"equals","label":"equal to"},
                     {"id":"not_equals","label":"not equal to"},
                     {"id":"contains","label":"containing"},
                     {"id":"not_contains","label":"not containing"},
                     {"id":"starts_with","label":"starting with"},
                     {"id":"gt","label":"greater than"},
                     {"id":"gte","label":"at least"},
                     {"id":"lt","label":"less than"},
                     {"id":"lte","label":"at most"},
                     {"id":"is_empty","label":"empty"},
                     {"id":"is_not_empty","label":"not empty"},
                     {"id":"is_true","label":"true"},
                     {"id":"is_false","label":"false"}]},
         {"key":"right","type":"text","label":"Compared with","required":false,
          "help":"Leave empty for the operators that take nothing — empty, true, false."}
       ]'::jsonb,
       description = 'Take one path or the other, by comparing two values.'
 where id = 'condition';

-- The same row decides whether a loop goes round again.
update catalogue_node_types
   set fields = '[
         {"key":"left","type":"text","label":"Repeat while","required":true},
         {"key":"operator","type":"select","label":"Is","required":true,"default":"is_true",
          "options":[{"id":"equals","label":"equal to"},
                     {"id":"not_equals","label":"not equal to"},
                     {"id":"contains","label":"containing"},
                     {"id":"gt","label":"greater than"},
                     {"id":"lt","label":"less than"},
                     {"id":"is_empty","label":"empty"},
                     {"id":"is_not_empty","label":"not empty"},
                     {"id":"is_true","label":"true"},
                     {"id":"is_false","label":"false"}]},
         {"key":"right","type":"text","label":"Compared with","required":false},
         {"key":"max_iterations","type":"number","label":"At most","required":true,"default":10,
          "help":"A loop that never stops is a flow that never finishes. This is the backstop."},
         {"key":"max_seconds","type":"number","label":"For no longer than","required":true,"default":30,
          "hint":"seconds"}
       ]'::jsonb,
       description = 'Send the flow round again while a comparison holds. Bounded, always.'
 where id = 'loop';

-- `code` keeps its single source field but says what it is handed and what it
-- must give back — neither of which the old label said.
update catalogue_node_types
   set fields = '[
         {"key":"source","type":"textarea","label":"JavaScript","required":true,
          "help":"Return a value. $json, $call and $(''Node name'') are in scope. Integrations only — this never runs while a caller is on the line."}
       ]'::jsonb,
       description = 'Run a snippet and use what it returns. Integrations only — nobody is waiting.'
 where id = 'code';

-- Neither produces anything: they route. `$json` passes through them unchanged,
-- so the expression picker must not offer them as a source — an empty root
-- under a node's name is worse than the node not appearing at all.
update catalogue_node_types
   set output = 'none'
 where id in ('condition', 'loop');
