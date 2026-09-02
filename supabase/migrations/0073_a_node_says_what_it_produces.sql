-- What each node type produces, so the expression picker can stop guessing.
--
-- The first version of that picker filtered the board for `intelligence` nodes,
-- which is a special case wearing a general shape: a Set node produces the
-- payload and would have been invisible, and the one intelligence node appeared
-- twice — once as `$json` and once under its own name — because "the previous
-- step" and "a step with a name" were the same node and nothing knew it.
--
-- `output` says where a node's fields come from:
--
--   none      it produces nothing to reference
--   schema    the schema named by `shape_id` — an intelligence node
--   assignments  the names its own rows declare — a Set node
--   call      the call's facts — a trigger
--   opaque    it produces something, but its shape is not knowable until it runs
--
-- The picker walks backwards from the node being edited and asks this. Adding a
-- node type then costs a row, not a console change — which is the whole reason
-- the catalogue exists.
alter table catalogue_node_types
  add column if not exists output text not null default 'none';

update catalogue_node_types set output = 'call'        where id like 'trigger.%';
update catalogue_node_types set output = 'schema'      where id = 'intelligence';
update catalogue_node_types set output = 'assignments' where id = 'var';
-- A webhook answers with a body and a code node returns whatever it returns.
-- Neither shape is knowable from the graph, so they are offered as a root with
-- no fields under it rather than as a list that would be a guess.
update catalogue_node_types set output = 'opaque'      where id in ('http.request', 'code');
