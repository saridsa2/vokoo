-- Repair the graph 0015 damaged, and guard the class of mistake.
--
-- 0015 converted each node by joining the registry on the node's old `kind`.
-- The same migration had already renamed `conference` to `kookoo.conference`
-- and `hangup` to `kookoo.hangup`, so those rows found no match and an inner
-- join dropped them: seven nodes became two, and nine transitions were left
-- pointing at nodes that no longer existed.
--
-- The validation caught it, which is the argument for having written it. What
-- should have been there as well is the assertion at the bottom of this file —
-- a data migration that reshapes rows should refuse to finish if it changed how
-- many there are.

begin;

-- Old names to new, for anything still carrying them.
create temporary table implementation_renames (old text primary key, new text) on commit drop;
insert into implementation_renames values
  ('conference', 'kookoo.conference'),
  ('ivr_transfer', 'kookoo.transfer'),
  ('hold', 'kookoo.hold'),
  ('pause_recording', 'kookoo.pause_recording'),
  ('hangup', 'kookoo.hangup');

-- The Vayuveda flow, restated in the current shape. Rebuilt from the original
-- rather than patched, because five of its seven nodes are gone and there is
-- nothing left to patch.
with agent as (select id, org_id from public.agents limit 1)
update public.flows set graph = jsonb_build_object(
  'version', 2,
  'start', 'n_hours',
  -- Declared on the flow so the composer can offer them and a node can be
  -- checked against them before it runs.
  'variables', jsonb_build_array(
    jsonb_build_object('name','patient_name','type','string'),
    jsonb_build_object('name','doctor','type','string'),
    jsonb_build_object('name','date','type','string')
  ),
  'nodes', jsonb_build_array(
    jsonb_build_object('id','n_hours','type','condition','implementation','business_hours',
      'name','Open right now?','position',jsonb_build_object('x',0,'y',0),
      'config',jsonb_build_object('timezone','Asia/Kolkata','opens','09:00','closes','19:00',
                                  'days',jsonb_build_array(1,2,3,4,5,6))),
    jsonb_build_object('id','n_closed','type','custom','implementation','kookoo.hangup',
      'name','Closed for the day','position',jsonb_build_object('x',-280,'y',180),
      'config',jsonb_build_object('reason','closed')),
    jsonb_build_object('id','n_agent','type','custom','implementation','agent',
      'name','Reception','position',jsonb_build_object('x',120,'y',180),
      'config',jsonb_build_object('agent_id',(select id from agent))),
    jsonb_build_object('id','n_desk','type','custom','implementation','kookoo.conference',
      'name','Bring in the front desk','position',jsonb_build_object('x',420,'y',400),
      'config',jsonb_build_object('phoneno','+918040802529','play_ring',true)),
    jsonb_build_object('id','n_booked','type','custom','implementation','kookoo.hangup',
      'name','Booked','position',jsonb_build_object('x',60,'y',620),
      'config',jsonb_build_object('reason','booked')),
    jsonb_build_object('id','n_transferred','type','custom','implementation','kookoo.hangup',
      'name','Handed over','position',jsonb_build_object('x',420,'y',620),
      'config',jsonb_build_object('reason','transferred')),
    jsonb_build_object('id','n_abandoned','type','custom','implementation','kookoo.hangup',
      'name','Caller gone','position',jsonb_build_object('x',-220,'y',620),
      'config',jsonb_build_object('reason','abandoned'))
  ),
  'transitions', jsonb_build_array(
    jsonb_build_object('id','t1','from','n_hours','outcome','closed','to','n_closed'),
    jsonb_build_object('id','t2','from','n_hours','outcome','open','to','n_agent'),
    jsonb_build_object('id','t3','from','n_agent','outcome','done','to','n_booked'),
    jsonb_build_object('id','t4','from','n_agent','outcome','out_of_scope','to','n_desk'),
    jsonb_build_object('id','t5','from','n_agent','outcome','wants_human','to','n_desk'),
    jsonb_build_object('id','t6','from','n_agent','outcome','failed','to','n_desk'),
    jsonb_build_object('id','t7','from','n_agent','outcome','gone_quiet','to','n_abandoned'),
    jsonb_build_object('id','t8','from','n_agent','outcome','timeout','to','n_desk'),
    jsonb_build_object('id','t9','from','n_desk','outcome','ok','to','n_transferred'),
    jsonb_build_object('id','t10','from','n_desk','outcome','failed','to','n_abandoned'),
    jsonb_build_object('id','t11','from','n_desk','outcome','timeout','to','n_abandoned')
  )
);

-- Any other flow, carried across by name rather than by join, so an unmatched
-- implementation keeps its node and fails validation loudly instead of
-- disappearing.
update public.flows f set graph = jsonb_set(
  f.graph, '{nodes}',
  (select jsonb_agg(
     case when r.new is null then n
          else jsonb_set(n, '{implementation}', to_jsonb(r.new)) end)
   from jsonb_array_elements(f.graph->'nodes') n
   left join implementation_renames r on r.old = n->>'implementation')
)
where f.graph ? 'nodes'
  and exists (
    select 1 from jsonb_array_elements(f.graph->'nodes') n
    join implementation_renames r on r.old = n->>'implementation'
  );

-- The guard 0015 should have carried: refuse to leave a flow whose transitions
-- do not all land on a node that exists.
do $$
declare
  v_flow record;
begin
  for v_flow in select id, name, graph from public.flows where graph ? 'nodes' loop
    perform public.validate_flow(v_flow.graph);
  end loop;
end;
$$;

commit;
