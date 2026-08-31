-- Call flows: what happens when the phone rings.
--
-- Until now a number pointed at one agent, and the whole call was that agent
-- talking until somebody hung up. There was no way to check opening hours, put
-- a caller through to a person, or do anything after the conversation ended —
-- and a composer drawing that would have drawn a single box.
--
-- A flow is a graph. `workflows.graph` has been an empty jsonb column since the
-- schema was written; this is its shape.
--
--   {
--     "version": 1,
--     "start": "<node id>",
--     "nodes": [ { id, type, name, position, config, exits[] } ],
--     "edges": [ { id, from, from_exit, to } ]
--   }
--
-- Four node types and no more:
--
--   agent        Talks to the caller. Finishes as one of its named exits —
--                done, out_of_scope, wants_human, failed, gone_quiet. The agent
--                never transfers anyone; it reports an outcome and the flow
--                decides what that means. That is what lets one agent be used
--                by several flows that escalate differently.
--
--   call_action  A command to the carrier on the live call: conference someone
--                in, hand the call to another application, hang up, pause the
--                recording. Exits are ok and failed.
--
--   branch       A test on something already known — the time, the number
--                dialled, a value a skill collected. One exit per case.
--
--   end          Hangs up, recording why.
--
-- Kept as jsonb rather than as node and edge tables because a flow is always
-- read, written and versioned whole. Rows would buy referential integrity
-- between a node and its edges and cost a join on every read, plus the ability
-- to save a half-valid graph — which the editor needs while someone is still
-- dragging things around.

-- --------------------------------------------------------------- the palette

-- What can be dropped onto the canvas, as data. Adding a carrier action becomes
-- a row rather than a release of the console.
create table if not exists public.catalogue_flow_nodes (
  id            text primary key,
  node_type     text not null,
  label         text not null,
  description   text not null,
  -- The carrier endpoint this maps to, for call_action nodes. Null elsewhere.
  provider_action text,
  -- Exits every node of this kind offers, as [{id, label}].
  exits         jsonb not null default '[]'::jsonb,
  -- Fields the editor asks for, as [{key, label, type, required, hint}].
  fields        jsonb not null default '[]'::jsonb,
  sort_order    integer not null default 0,
  is_active     boolean not null default true
);

alter table public.catalogue_flow_nodes enable row level security;
drop policy if exists catalogue_flow_nodes_read on public.catalogue_flow_nodes;
create policy catalogue_flow_nodes_read on public.catalogue_flow_nodes
  for select to authenticated using (true);
grant select on public.catalogue_flow_nodes to authenticated;

insert into public.catalogue_flow_nodes
  (id, node_type, label, description, provider_action, exits, fields, sort_order)
values
  ('agent', 'agent', 'Agent',
   'Hands the conversation to an agent. It finishes as one of its outcomes and the flow continues from there.',
   null,
   '[{"id":"done","label":"Finished"},
     {"id":"out_of_scope","label":"Not one of its skills"},
     {"id":"wants_human","label":"Asked for a person"},
     {"id":"failed","label":"Something went wrong"},
     {"id":"gone_quiet","label":"Caller went quiet"}]'::jsonb,
   '[{"key":"agent_id","label":"Agent","type":"agent","required":true}]'::jsonb, 0),

  ('business_hours', 'branch', 'Opening hours',
   'Sends the call one way inside opening hours and another way outside them.',
   null,
   '[{"id":"open","label":"Open"},{"id":"closed","label":"Closed"}]'::jsonb,
   '[{"key":"timezone","label":"Time zone","type":"text","required":true,"hint":"e.g. Asia/Kolkata"},
     {"key":"opens","label":"Opens","type":"time","required":true},
     {"key":"closes","label":"Closes","type":"time","required":true},
     {"key":"days","label":"Open on","type":"weekdays","required":true}]'::jsonb, 1),

  ('conference', 'call_action', 'Bring in a person',
   'Dials someone and puts them into the call. The agent can stay on the line and hand over, rather than the caller being dropped into a cold transfer.',
   'Conference',
   '[{"id":"ok","label":"They joined"},{"id":"failed","label":"No answer"}]'::jsonb,
   '[{"key":"phoneno","label":"Number to dial","type":"phone","required":true},
     {"key":"play_ring","label":"Play ringing to the caller","type":"boolean"}]'::jsonb, 2),

  ('ivr_transfer', 'call_action', 'Hand the call away',
   'Passes the call to another application entirely. The flow ends here — nothing after this node runs.',
   'IVRTransfer',
   '[{"id":"ok","label":"Handed over"},{"id":"failed","label":"Transfer failed"}]'::jsonb,
   '[{"key":"app_url","label":"Application URL","type":"url","required":true}]'::jsonb, 3),

  ('hold', 'call_action', 'Hold',
   'Parks the caller with hold music. Use when the agent needs to wait on something slow.',
   'Hold',
   '[{"id":"ok","label":"On hold"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[]'::jsonb, 4),

  ('pause_recording', 'call_action', 'Pause recording',
   'Stops recording before the caller reads out something sensitive. Pausing is not instant, so leave a beat either side.',
   'PauseMonitor',
   '[{"id":"ok","label":"Paused"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[]'::jsonb, 5),

  ('hangup', 'end', 'Hang up',
   'Ends the call and records why, which is what the call log groups by.',
   'Disconnect',
   '[]'::jsonb,
   '[{"key":"reason","label":"Reason","type":"text","required":true,"hint":"booked, transferred, abandoned"}]'::jsonb, 6)
on conflict (id) do update set
  node_type = excluded.node_type, label = excluded.label,
  description = excluded.description, provider_action = excluded.provider_action,
  exits = excluded.exits, fields = excluded.fields, sort_order = excluded.sort_order;

-- ------------------------------------------------------- numbers point at flows

-- A number routes to a flow. `agent_id` stays for now because the bridge still
-- reads it: until the bridge can execute a graph, removing it would take the
-- phone line down. It is the fallback, not the route.
alter table public.phone_numbers add column if not exists flow_id uuid
  references public.workflows(id) on delete set null;

comment on column public.phone_numbers.agent_id is
  'Legacy direct routing, used while the bridge cannot execute a flow. Prefer flow_id.';

-- ----------------------------------------------------------------- validation

-- A graph that fails this cannot answer a call. Checked when a flow is
-- released, not while it is being drawn — half-connected is a normal state for
-- something someone is still working on.
create or replace function public.validate_flow_graph(p_graph jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_ids     text[];
  v_start   text := p_graph->>'start';
  v_node    jsonb;
  v_edge    jsonb;
begin
  if p_graph is null or jsonb_typeof(p_graph->'nodes') <> 'array' then
    raise exception 'the flow has no nodes' using errcode = 'P0004';
  end if;

  select array_agg(n->>'id') into v_ids
  from jsonb_array_elements(p_graph->'nodes') n;

  if v_start is null or not (v_start = any(v_ids)) then
    raise exception 'the flow does not say which node answers the call'
      using errcode = 'P0004';
  end if;

  for v_node in select * from jsonb_array_elements(p_graph->'nodes') loop
    if not exists (select 1 from public.catalogue_flow_nodes
                   where id = v_node->>'kind' and is_active) then
      raise exception 'unknown step "%" in the flow', v_node->>'kind'
        using errcode = 'P0004';
    end if;
  end loop;

  for v_edge in select * from jsonb_array_elements(coalesce(p_graph->'edges', '[]'::jsonb)) loop
    if not ((v_edge->>'from') = any(v_ids)) then
      raise exception 'a connection starts from a step that is not in the flow'
        using errcode = 'P0004';
    end if;
    if not ((v_edge->>'to') = any(v_ids)) then
      raise exception 'a connection leads to a step that is not in the flow'
        using errcode = 'P0004';
    end if;
  end loop;
end;
$$;

grant execute on function public.validate_flow_graph(jsonb) to authenticated;
