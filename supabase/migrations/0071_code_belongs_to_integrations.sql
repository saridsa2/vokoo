-- The code node belongs to Integrations, and only there.
--
-- `vokoo_bridge` answers the phone, and it is the same process that runs
-- post-call flows — so an evaluator linked into it shares an address space with
-- the media path. The carrier's contract makes that sharp: if the bridge's
-- WebSocket errors or closes, the platform ends the call. Author-written code
-- running while somebody is on the line is not a slow node, it is a dropped
-- caller.
--
-- Nobody is waiting on an integration. That is where n8n's shape belongs and
-- where the JavaScript evaluator is reachable.
--
-- This is one of two independent gates, deliberately. The catalogue stops the
-- calls palette offering the node; `expression.rs` stops the live-call runner
-- evaluating a script at all, whatever a graph asks for. A rule enforced in one
-- place is a rule the next screen forgets.
update catalogue_node_types
   set families = '{post_call}'::text[],
       description = 'Run a snippet and use what it returns. Integrations only — nobody is waiting.'
 where id = 'code';

-- `condition`, `var` and `loop` stay on both boards: a call flow has to branch,
-- and an operand row compares two values rather than running a program.
