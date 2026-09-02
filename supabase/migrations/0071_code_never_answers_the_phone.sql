-- The code node leaves the call board.
--
-- `vokoo_bridge` answers the phone, and it is the same process that runs
-- post-call flows — so anything evaluated for a flow shares an address space
-- with the media path. The carrier's own contract makes that sharp: if the
-- bridge's WebSocket errors or closes, the platform ends the call. A slow or
-- looping expression on a live call is not a slow node, it is a dropped caller.
--
-- Nobody is waiting on a post-call flow, which is where arbitrary author-written
-- code belongs. A call flow keeps `condition`, `var` and `loop`: those evaluate
-- a comparison, not a program, and the flow needs to branch.
--
-- This is a narrowing, not a withdrawal — the node stays in the catalogue and
-- any board already using it still renders it. `addableFor()` is what stops the
-- call palette offering it.
update catalogue_node_types
   set families = '{post_call}'::text[],
       description = 'Run a snippet and use what it returns. Post-call only — nobody is waiting.'
 where id = 'code';
