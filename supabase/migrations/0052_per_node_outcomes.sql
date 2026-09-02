-- Outcomes a node's author writes, rather than ones its type already knows.
--
-- Every node type until now could name its branches in advance: opening hours
-- leaves by open or closed, a transfer by ok or failed. A menu cannot. "Press 1
-- for English, 2 for Hindi" has three branches in one flow and five in the next,
-- and the catalogue has no way to say so — which is why there is no menu node.
--
-- `outcomes_from` names the config field holding those branches. The composer
-- reads it and draws one port per entry, appending the type's own outcomes
-- underneath as fallbacks, so a menu declares `timeout` here and gets its digits
-- from the node.
--
-- n8n's Switch node settled the design: add a rule, get an output. The
-- alternative was a fixed 0-9 plus timeout on every menu, which would have left
-- six unconnected ports on a three-language flow and had the composer's
-- validator complain about all of them, on every menu, forever.
--
-- NULL on every existing row, and NULL means what those rows already do: take
-- the branches from the type. No behaviour changes until a row sets it.

alter table public.catalogue_node_types
  add column if not exists outcomes_from text;

comment on column public.catalogue_node_types.outcomes_from is
  'Config field holding author-written branches, for a node whose outcomes its type cannot know (a digit menu). NULL means the type''s own outcomes are the whole list.';
