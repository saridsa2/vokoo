-- A flow has entry points, not one event stamped on its row.
--
-- This is the additive half of the transition. `trigger_event`, `graph.start`
-- and `number_flows` remain because the deployed bridge still reads them. New
-- readers use the trigger nodes in an immutable graph snapshot and the stored
-- family says which capabilities belong on the canvas.

begin;

alter table public.flows
  add column if not exists family text not null default 'call';

update public.flows
   set family = case trigger_event
     when 'call.ended' then 'integration'
     when 'message.received' then 'message'
     else 'call'
   end;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'flows_family_check'
       and conrelid = 'public.flows'::regclass
  ) then
    alter table public.flows
      add constraint flows_family_check
      check (family in ('call', 'integration', 'care_path', 'message', 'general'));
  end if;
end;
$$;

comment on column public.flows.family is
  'The capability boundary for this versioned graph. Entry timing belongs to its trigger nodes.';

-- Structural validation remains callable through the historical one-argument
-- API. It accepts v2's singleton start and v3's explicit trigger entries so an
-- older control plane and a newer one can overlap during rollout.
create or replace function public.validate_flow(p_graph jsonb)
returns void language plpgsql stable set search_path = public as $$
declare
  v_ids      text[];
  v_node     jsonb;
  v_tr       jsonb;
  v_def      public.catalogue_node_types;
  v_version  integer;
  v_triggers integer;
begin
  if p_graph is null or jsonb_typeof(p_graph->'nodes') <> 'array' then
    raise exception 'the flow has no nodes' using errcode = 'P0004';
  end if;

  select coalesce(array_agg(n->>'id'), array[]::text[]) into v_ids
    from jsonb_array_elements(p_graph->'nodes') n;

  if cardinality(v_ids) = 0 then
    raise exception 'the flow has no nodes' using errcode = 'P0004';
  end if;

  if exists (
    select 1
      from unnest(v_ids) id
     group by id
    having id is null or btrim(id) = '' or count(*) > 1
  ) then
    raise exception 'every node in the flow needs a unique id' using errcode = 'P0004';
  end if;

  if coalesce(p_graph->>'version', '2') !~ '^[0-9]+$' then
    raise exception 'the flow has an invalid graph version' using errcode = 'P0004';
  end if;
  v_version := coalesce((p_graph->>'version')::integer, 2);

  select count(*) into v_triggers
    from jsonb_array_elements(p_graph->'nodes') n
   where n->>'implementation' like 'trigger.%';

  if v_version >= 3 and v_triggers = 0 then
    raise exception 'the flow has no trigger' using errcode = 'P0004';
  end if;

  if v_version < 3
     and ((p_graph->>'start') is null or not ((p_graph->>'start') = any(v_ids))) then
    raise exception 'the flow does not say which node answers the call' using errcode = 'P0004';
  end if;

  for v_node in select * from jsonb_array_elements(p_graph->'nodes') loop
    select * into v_def
      from public.catalogue_node_types
     where id = v_node->>'implementation'
       and is_active;

    if v_def.id is null then
      raise exception 'unknown node "%" in the flow', v_node->>'implementation'
        using errcode = 'P0004';
    end if;
    if v_def.node_type <> (v_node->>'type') then
      raise exception '% is a % node, not a %', v_def.label, v_def.node_type, v_node->>'type'
        using errcode = 'P0004';
    end if;
    if v_def.suspends and v_def.default_timeout_seconds is null
       and (v_node->'config'->>'timeout_seconds') is null then
      raise exception '% waits for something and has no timeout', v_def.label
        using errcode = 'P0004';
    end if;
  end loop;

  for v_tr in
    select * from jsonb_array_elements(coalesce(p_graph->'transitions', '[]'::jsonb))
  loop
    if not ((v_tr->>'from') = any(v_ids)) or not ((v_tr->>'to') = any(v_ids)) then
      raise exception 'a transition points at a node that is not in the flow'
        using errcode = 'P0004';
    end if;
  end loop;
end;
$$;

-- Family-aware validation owns entry identity. The third argument exists only
-- for the compatibility window: a CRM graph already stored as call.ended must
-- remain publishable until the assisted migration moves that trigger and its
-- extraction nodes back into the call flow.
create or replace function public.validate_flow(
  p_graph jsonb,
  p_family text,
  p_legacy_trigger_event text
)
returns void language plpgsql stable set search_path = public as $$
declare
  v_legacy_ended boolean;
begin
  perform public.validate_flow(p_graph);

  if p_family not in ('call', 'integration', 'care_path', 'message', 'general') then
    raise exception 'unknown flow family "%"', p_family using errcode = 'P0004';
  end if;

  if exists (
    select 1
      from (
        select n->>'implementation' as implementation,
               coalesce(nullif(btrim(n->'config'->>'key'), ''), 'default') as trigger_key
          from jsonb_array_elements(p_graph->'nodes') n
         where n->>'implementation' like 'trigger.%'
         group by n->>'implementation',
                  coalesce(nullif(btrim(n->'config'->>'key'), ''), 'default')
        having count(*) > 1
      ) duplicate
  ) then
    raise exception 'the flow has two triggers for the same event and key'
      using errcode = 'P0004';
  end if;

  select p_family = 'integration'
         and p_legacy_trigger_event = 'call.ended'
         and count(*) = 1
         and bool_and(n->>'implementation' = 'trigger.call_ended')
    into v_legacy_ended
    from jsonb_array_elements(p_graph->'nodes') n
   where n->>'implementation' like 'trigger.%';

  if p_family = 'call' and exists (
    select 1 from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' like 'trigger.%'
       and n->>'implementation' not like 'trigger.call_%'
  ) then
    raise exception 'a call flow contains a trigger from another family'
      using errcode = 'P0004';
  elsif p_family = 'integration' and not v_legacy_ended and exists (
    select 1 from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' like 'trigger.%'
       and n->>'implementation' <> 'trigger.integration_invoked'
  ) then
    raise exception 'an integration flow contains a trigger from another family'
      using errcode = 'P0004';
  elsif p_family = 'message' and exists (
    select 1 from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' like 'trigger.%'
       and n->>'implementation' not like 'trigger.message_%'
  ) then
    raise exception 'a message flow contains a trigger from another family'
      using errcode = 'P0004';
  elsif p_family = 'care_path' and exists (
    select 1 from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' like 'trigger.%'
       and n->>'implementation' not in (
         'trigger.due', 'trigger.recurring', 'trigger.reported', 'trigger.document'
       )
  ) then
    raise exception 'a care-path flow contains a trigger from another family'
      using errcode = 'P0004';
  end if;
end;
$$;

revoke all on function public.validate_flow(jsonb, text, text) from public;
grant execute on function public.validate_flow(jsonb, text, text) to authenticated;

create or replace function public.publish_flow(p_flow_id uuid, p_graph jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_org_id uuid;
  v_next   integer;
  v_row    public.flows;
  v_graph  jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.flows
   where id = p_flow_id
   for update;
  if v_row.id is null then
    raise exception 'flow not found' using errcode = 'P0002';
  end if;
  v_org_id := v_row.org_id;
  if not public.can_release(v_org_id) then
    raise exception 'your role may not publish' using errcode = 'P0003';
  end if;

  v_graph := coalesce(p_graph, v_row.graph);
  perform public.validate_flow(v_graph, v_row.family, v_row.trigger_event);

  update public.flows set
    graph = v_graph,
    status = 'published', published_at = now(), updated_at = now()
  where id = p_flow_id
  returning * into v_row;

  if exists (
    select 1
      from jsonb_array_elements(v_row.graph->'nodes') n
      join public.agents a on a.id = (n->'config'->>'agent_id')::uuid
     where n->>'implementation' = 'agent'
       and a.status <> 'published'
  ) then
    raise exception 'this flow uses an agent that has not been published'
      using errcode = 'P0004';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.flow_versions
   where flow_id = p_flow_id;

  insert into public.flow_versions (org_id, flow_id, version, snapshot, published_by)
  values (v_org_id, p_flow_id, v_next, to_jsonb(v_row), auth.uid());

  return jsonb_build_object('flow', to_jsonb(v_row), 'version', v_next);
end;
$$;

revoke all on function public.publish_flow(uuid, jsonb) from public;
grant execute on function public.publish_flow(uuid, jsonb) to authenticated;

commit;
