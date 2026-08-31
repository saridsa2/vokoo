-- The flow vocabulary, applied.
--
-- Five node types the engine executes, and a registry for everything else. The
-- previous shape made `agent`, `call_action`, `branch` and `end` the node types,
-- which tied the executor to telephony: every new carrier action would have been
-- an engine change, and the engine could never have run anything that was not a
-- phone call.
--
--   node.type            which primitive the engine runs
--                        condition · loop · var · code · custom
--   node.implementation  which registry entry supplies the configuration shape,
--                        the outcomes and the label
--
-- Every node names a registry entry, including the primitives. A bare condition
-- is `{type: condition, implementation: condition}`; opening hours is
-- `{type: condition, implementation: business_hours}` — the same primitive with
-- a friendlier face. That uniformity is what lets the composer render a node it
-- has never seen from the registry alone.

alter table public.workflows rename to flows;
alter table public.catalogue_flow_nodes rename to catalogue_node_types;

-- `node_type` now means the primitive, and the row's id is the implementation.
alter table public.catalogue_node_types add column if not exists suspends boolean not null default false;
alter table public.catalogue_node_types add column if not exists default_timeout_seconds integer;
alter table public.catalogue_node_types rename column exits to outcomes;

comment on column public.catalogue_node_types.node_type is
  'The primitive the engine dispatches on: condition, loop, var, code or custom.';
comment on column public.catalogue_node_types.suspends is
  'True when the node parks the flow and is woken by an event or a timeout. An '
  'agent holds the caller for minutes; a conference spends twenty seconds ringing.';

delete from public.catalogue_node_types;

insert into public.catalogue_node_types
  (id, node_type, label, description, provider_action, suspends, default_timeout_seconds, outcomes, fields, sort_order)
values
  -- ---- primitives the engine knows how to run
  ('condition', 'condition', 'Condition',
   'Chooses a path by testing the flow''s variables. More than two ways out is normal — a call routes by language or department far more often than by yes and no.',
   null, false, null,
   '[{"id":"true","label":"True"},{"id":"false","label":"False"}]'::jsonb,
   '[{"key":"expression","label":"Test","type":"expression","required":true}]'::jsonb, 0),

  ('loop', 'loop', 'Loop',
   'Repeats until a test holds or a bound is reached. Both bounds are required: on a live call an extra pass is dead air, and the caller hangs up.',
   null, false, null,
   '[{"id":"each","label":"Each pass"},{"id":"done","label":"Finished"},{"id":"exhausted","label":"Ran out"}]'::jsonb,
   '[{"key":"while","label":"Repeat while","type":"expression","required":true},
     {"key":"max_iterations","label":"At most","type":"number","required":true},
     {"key":"max_seconds","label":"For no longer than","type":"number","required":true,"hint":"seconds"}]'::jsonb, 1),

  ('var', 'var', 'Set a value',
   'Writes a variable into the flow''s state so a later node can use it.',
   null, false, null,
   '[{"id":"ok","label":"Set"}]'::jsonb,
   '[{"key":"name","label":"Variable","type":"text","required":true},
     {"key":"value","label":"Value","type":"expression","required":true}]'::jsonb, 2),

  ('code', 'code', 'Run an expression',
   'Evaluates a snippet. The escape hatch, so a missing primitive never blocks a flow.',
   null, false, null,
   '[{"id":"ok","label":"Returned"},{"id":"failed","label":"Threw"}]'::jsonb,
   '[{"key":"source","label":"Code","type":"code","required":true}]'::jsonb, 3),

  -- ---- presets over a primitive
  ('business_hours', 'condition', 'Opening hours',
   'Sends the call one way inside opening hours and another way outside them.',
   null, false, null,
   '[{"id":"open","label":"Open"},{"id":"closed","label":"Closed"}]'::jsonb,
   '[{"key":"timezone","label":"Time zone","type":"text","required":true,"hint":"e.g. Asia/Kolkata"},
     {"key":"opens","label":"Opens","type":"time","required":true},
     {"key":"closes","label":"Closes","type":"time","required":true},
     {"key":"days","label":"Open on","type":"weekdays","required":true}]'::jsonb, 4),

  -- ---- custom: everything the domain knows
  ('agent', 'custom', 'Agent',
   'Hands the conversation to an agent. It finishes as one of its outcomes and the flow continues from there. The agent never transfers anyone — it reports what happened and the flow decides what that means.',
   null, true, 600,
   '[{"id":"done","label":"Finished"},
     {"id":"out_of_scope","label":"Not one of its skills"},
     {"id":"wants_human","label":"Asked for a person"},
     {"id":"failed","label":"Something went wrong"},
     {"id":"gone_quiet","label":"Caller went quiet"},
     {"id":"timeout","label":"Ran too long"}]'::jsonb,
   '[{"key":"agent_id","label":"Agent","type":"agent","required":true}]'::jsonb, 5),

  ('kookoo.conference', 'custom', 'Bring in a person',
   'Dials someone and puts them into the call. The agent can stay on the line and hand over, rather than the caller being dropped into a cold transfer.',
   'Conference', true, 45,
   '[{"id":"ok","label":"They joined"},{"id":"failed","label":"No answer"},{"id":"timeout","label":"Rang out"}]'::jsonb,
   '[{"key":"phoneno","label":"Number to dial","type":"phone","required":true},
     {"key":"play_ring","label":"Play ringing to the caller","type":"boolean"}]'::jsonb, 6),

  ('kookoo.transfer', 'custom', 'Hand the call away',
   'Passes the call to another application entirely. The flow ends here — nothing after this node runs.',
   'IVRTransfer', true, 30,
   '[{"id":"ok","label":"Handed over"},{"id":"failed","label":"Transfer failed"}]'::jsonb,
   '[{"key":"app_url","label":"Application URL","type":"url","required":true}]'::jsonb, 7),

  ('kookoo.hold', 'custom', 'Hold',
   'Parks the caller with hold music while something slow happens.',
   'Hold', false, null,
   '[{"id":"ok","label":"On hold"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[]'::jsonb, 8),

  ('kookoo.pause_recording', 'custom', 'Pause recording',
   'Stops recording before the caller reads out something sensitive. Pausing is not instant, so leave a beat either side.',
   'PauseMonitor', false, null,
   '[{"id":"ok","label":"Paused"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[]'::jsonb, 9),

  ('kookoo.hangup', 'custom', 'Hang up',
   'Ends the call and records why, which is what the call log groups by.',
   'Disconnect', false, null,
   '[]'::jsonb,
   '[{"key":"reason","label":"Reason","type":"text","required":true,"hint":"booked, transferred, abandoned"}]'::jsonb, 10);

-- ------------------------------------------------------- the graph, restated

-- nodes[].kind          -> nodes[].type + nodes[].implementation
-- edges                 -> transitions
-- edges[].from_exit     -> transitions[].outcome
-- (new)                 -> variables
update public.flows f
set graph = jsonb_build_object(
  'version', 2,
  'start', f.graph->>'start',
  'variables', coalesce(f.graph->'variables', '[]'::jsonb),
  'nodes', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', n->>'id',
        'type', t.node_type,
        'implementation', n->>'kind',
        'name', n->>'name',
        'position', n->'position',
        'config', coalesce(n->'config', '{}'::jsonb)
      ) order by n->>'id'
    ), '[]'::jsonb)
    from jsonb_array_elements(f.graph->'nodes') n
    join public.catalogue_node_types t on t.id = n->>'kind'
  ),
  'transitions', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e->>'id',
        'from', e->>'from',
        'outcome', e->>'from_exit',
        'to', e->>'to'
      ) order by e->>'id'
    ), '[]'::jsonb)
    from jsonb_array_elements(coalesce(f.graph->'edges', '[]'::jsonb)) e
  )
)
where f.graph ? 'nodes';

-- ----------------------------------------------------------------- validation

drop function if exists public.validate_flow_graph(jsonb);

create or replace function public.validate_flow(p_graph jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_ids  text[];
  v_node jsonb;
  v_tr   jsonb;
  v_def  public.catalogue_node_types;
begin
  if p_graph is null or jsonb_typeof(p_graph->'nodes') <> 'array' then
    raise exception 'the flow has no nodes' using errcode = 'P0004';
  end if;

  select array_agg(n->>'id') into v_ids from jsonb_array_elements(p_graph->'nodes') n;

  if (p_graph->>'start') is null or not ((p_graph->>'start') = any(v_ids)) then
    raise exception 'the flow does not say which node answers the call' using errcode = 'P0004';
  end if;

  for v_node in select * from jsonb_array_elements(p_graph->'nodes') loop
    select * into v_def from public.catalogue_node_types
    where id = v_node->>'implementation' and is_active;

    if v_def.id is null then
      raise exception 'unknown node "%" in the flow', v_node->>'implementation'
        using errcode = 'P0004';
    end if;

    -- The stored primitive has to agree with the registry, or the executor
    -- would dispatch one way while the composer drew another.
    if v_def.node_type <> (v_node->>'type') then
      raise exception '% is a % node, not a %',
        v_def.label, v_def.node_type, v_node->>'type' using errcode = 'P0004';
    end if;

    -- A node that parks the flow with no way to be woken is a call that never
    -- ends. The registry default counts; only an explicit null is a problem.
    if v_def.suspends
       and v_def.default_timeout_seconds is null
       and (v_node->'config'->>'timeout_seconds') is null then
      raise exception '% waits for something and has no timeout', v_def.label
        using errcode = 'P0004';
    end if;
  end loop;

  for v_tr in select * from jsonb_array_elements(coalesce(p_graph->'transitions', '[]'::jsonb)) loop
    if not ((v_tr->>'from') = any(v_ids)) or not ((v_tr->>'to') = any(v_ids)) then
      raise exception 'a transition points at a node that is not in the flow'
        using errcode = 'P0004';
    end if;
  end loop;
end;
$$;

grant execute on function public.validate_flow(jsonb) to authenticated;
