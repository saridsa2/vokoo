-- `var` becomes the node that gathers values, which is what it was for.
--
-- It held one `name` and one `value`, which reads as a scratch variable. What a
-- flow actually needs before it sends anything is to *shape* a payload: pick
-- several values from earlier steps, give each the name the receiving system
-- expects, and hand the result on. n8n's Set node, and the reason it exists —
-- gathering is a different job from sending.
--
-- The consequence is that a webhook's Body goes empty, because empty already
-- means "send the previous step's output". What is being sent stops being
-- buried in a textarea and becomes a node you can read on the canvas.
--
-- `assignments` is a repeating list of rows, the same way `branches` is on the
-- keypad node — and for the same reason: how many there are is the author's
-- decision, so the catalogue cannot name them.
update catalogue_node_types
   set label = 'Set values',
       description = 'Build a set of named values from earlier steps. What this node holds is what the next one receives.',
       fields = '[
         {"key":"assignments","type":"assignments","label":"Values","required":true,
          "help":"A name the receiving system expects, and where its value comes from."}
       ]'::jsonb
 where id = 'var';
