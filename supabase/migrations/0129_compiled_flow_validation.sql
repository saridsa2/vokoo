-- Deterministic safety checks for compiler-created care-path drafts.

begin;

create or replace function public.compiler_node_outcomes(
  p_node jsonb,
  p_static_outcomes jsonb,
  p_outcomes_from text
)
returns text[] language sql immutable set search_path = public as $$
  with static_outcomes(id) as (
    select outcome->>'id'
      from jsonb_array_elements(coalesce(p_static_outcomes, '[]'::jsonb)) outcome
  ), dynamic_outcomes(id) as (
    select case jsonb_typeof(item)
      when 'string' then item #>> '{}'
      when 'object' then coalesce(item->>'id', item->>'key', item->>'outcome', item->>'value')
      else null
    end
      from jsonb_array_elements(
        case
          when p_outcomes_from is not null
           and jsonb_typeof(p_node->'config'->p_outcomes_from) = 'array'
          then p_node->'config'->p_outcomes_from
          else '[]'::jsonb
        end
      ) item
  )
  select coalesce(array_agg(distinct id order by id), array[]::text[])
    from (
      select id from static_outcomes
      union all
      select id from dynamic_outcomes
    ) outcomes
   where nullif(btrim(id), '') is not null
$$;

create or replace function public.validate_compiled_care_path(
  p_org_id uuid,
  p_graph jsonb
)
returns void language plpgsql stable set search_path = public as $$
declare
  v_node jsonb;
  v_source jsonb;
  v_transition jsonb;
  v_field jsonb;
  v_def public.catalogue_node_types;
  v_config jsonb;
  v_key text;
  v_value jsonb;
  v_outcome text;
  v_outcomes text[];
  v_node_ids text[];
  v_trigger_ids text[];
  v_reachable text[];
  v_additions text[];
  v_from_trigger text[];
  v_safe text[];
  v_target text;
  v_node_count integer;
  v_pass integer;
  v_changed boolean;
  v_has_terminal boolean;
  v_node_safe boolean;
begin
  if p_org_id is null then
    raise exception 'compiled care path needs an organization' using errcode = 'P0004';
  end if;
  if jsonb_typeof(p_graph) <> 'object'
     or jsonb_typeof(p_graph->'nodes') <> 'array'
     or jsonb_typeof(p_graph->'transitions') <> 'array' then
    raise exception 'compiled care path needs node and transition arrays' using errcode = 'P0004';
  end if;

  perform public.validate_flow(p_graph, 'care_path', 'care_path.due');
  perform public.validate_flow_release(p_org_id, 'care_path', p_graph);

  select coalesce(array_agg(n->>'id'), array[]::text[]), count(*)
    into v_node_ids, v_node_count
    from jsonb_array_elements(p_graph->'nodes') n;
  select coalesce(array_agg(n->>'id'), array[]::text[])
    into v_trigger_ids
    from jsonb_array_elements(p_graph->'nodes') n
   where n->>'implementation' like 'trigger.%';

  for v_node in select value from jsonb_array_elements(p_graph->'nodes') loop
    select * into v_def
      from public.catalogue_node_types
     where id = v_node->>'implementation'
       and is_active
       and 'care_path' = any(families);
    if v_def.id is null then
      raise exception 'compiled node % is not in the active care-path catalogue', v_node->>'implementation'
        using errcode = 'P0004';
    end if;
    v_config := coalesce(v_node->'config', '{}'::jsonb);
    if jsonb_typeof(v_config) <> 'object' then
      raise exception 'node % has invalid configuration', v_node->>'id' using errcode = 'P0004';
    end if;

    for v_field in select value from jsonb_array_elements(coalesce(v_def.fields, '[]'::jsonb)) loop
      v_key := v_field->>'key';
      v_value := v_config->v_key;
      if coalesce((v_field->>'required')::boolean, false) and (
        not (v_config ? v_key)
        or v_value is null
        or jsonb_typeof(v_value) = 'null'
        or (jsonb_typeof(v_value) = 'string' and btrim(v_value #>> '{}') = '')
        or (jsonb_typeof(v_value) = 'array' and jsonb_array_length(v_value) = 0)
      ) then
        raise exception '% requires %', v_def.id, v_key using errcode = 'P0004';
      end if;
      if v_config ? v_key
         and jsonb_typeof(v_value) <> 'null'
         and v_field->>'type' = 'select'
         and not exists (
           select 1 from jsonb_array_elements(coalesce(v_field->'options', '[]'::jsonb)) option
            where option->>'id' = v_value #>> '{}'
         ) then
        raise exception '% has an invalid % option', v_def.id, v_key using errcode = 'P0004';
      end if;
    end loop;

    if v_def.id = 'loop' and (
      coalesce(v_config->>'max_iterations', '') !~ '^[1-9][0-9]*$'
      or coalesce(v_config->>'max_seconds', '') !~ '^[1-9][0-9]*$'
    ) then
      raise exception 'compiled loops need positive iteration and time bounds' using errcode = 'P0004';
    end if;
  end loop;

  if exists (
    select 1
      from jsonb_array_elements(p_graph->'transitions') t
     group by t->>'from', t->>'outcome'
    having count(*) > 1
  ) then
    raise exception 'a node outcome has more than one destination' using errcode = 'P0004';
  end if;

  for v_transition in select value from jsonb_array_elements(p_graph->'transitions') loop
    select n into v_source
      from jsonb_array_elements(p_graph->'nodes') n
     where n->>'id' = v_transition->>'from';
    select * into v_def from public.catalogue_node_types where id = v_source->>'implementation';
    v_outcomes := public.compiler_node_outcomes(v_source, v_def.outcomes, v_def.outcomes_from);
    if not (coalesce(v_transition->>'outcome', '') = any(v_outcomes)) then
      raise exception 'transition % uses an outcome not exposed by %',
        v_transition->>'id', v_source->>'implementation' using errcode = 'P0004';
    end if;
  end loop;

  v_reachable := v_trigger_ids;
  for v_pass in 1..greatest(v_node_count, 1) loop
    select coalesce(array_agg(distinct t->>'to'), array[]::text[])
      into v_additions
      from jsonb_array_elements(p_graph->'transitions') t
     where (t->>'from') = any(v_reachable)
       and not ((t->>'to') = any(v_reachable));
    exit when cardinality(v_additions) = 0;
    v_reachable := v_reachable || v_additions;
  end loop;
  if exists (select 1 from unnest(v_node_ids) id where not (id = any(v_reachable))) then
    raise exception 'compiled care path contains an unreachable node' using errcode = 'P0004';
  end if;

  foreach v_key in array v_trigger_ids loop
    v_from_trigger := array[v_key];
    for v_pass in 1..greatest(v_node_count, 1) loop
      select coalesce(array_agg(distinct t->>'to'), array[]::text[])
        into v_additions
        from jsonb_array_elements(p_graph->'transitions') t
       where (t->>'from') = any(v_from_trigger)
         and not ((t->>'to') = any(v_from_trigger));
      exit when cardinality(v_additions) = 0;
      v_from_trigger := v_from_trigger || v_additions;
    end loop;
    v_has_terminal := false;
    for v_node in
      select n from jsonb_array_elements(p_graph->'nodes') n
       where (n->>'id') = any(v_from_trigger)
    loop
      select * into v_def from public.catalogue_node_types where id = v_node->>'implementation';
      v_outcomes := public.compiler_node_outcomes(v_node, v_def.outcomes, v_def.outcomes_from);
      foreach v_outcome in array v_outcomes loop
        if not exists (
          select 1 from jsonb_array_elements(p_graph->'transitions') t
           where t->>'from' = v_node->>'id' and t->>'outcome' = v_outcome
        ) then
          v_has_terminal := true;
        end if;
      end loop;
    end loop;
    if not v_has_terminal then
      raise exception 'trigger % cannot reach a terminal outcome', v_key using errcode = 'P0004';
    end if;
  end loop;

  select coalesce(array_agg(n->>'id'), array[]::text[])
    into v_safe
    from jsonb_array_elements(p_graph->'nodes') n
   where n->>'implementation' = 'escalate.notify';
  for v_pass in 1..greatest(v_node_count, 1) loop
    v_changed := false;
    for v_node in
      select n from jsonb_array_elements(p_graph->'nodes') n
       where not ((n->>'id') = any(v_safe))
    loop
      select * into v_def from public.catalogue_node_types where id = v_node->>'implementation';
      v_outcomes := public.compiler_node_outcomes(v_node, v_def.outcomes, v_def.outcomes_from);
      v_node_safe := cardinality(v_outcomes) > 0;
      foreach v_outcome in array v_outcomes loop
        select t->>'to' into v_target
          from jsonb_array_elements(p_graph->'transitions') t
         where t->>'from' = v_node->>'id' and t->>'outcome' = v_outcome;
        if v_target is null or not (v_target = any(v_safe)) then
          v_node_safe := false;
          exit;
        end if;
      end loop;
      if v_node_safe then
        v_safe := array_append(v_safe, v_node->>'id');
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  for v_source, v_outcome in
    select n, risky.outcome
      from jsonb_array_elements(p_graph->'nodes') n
      cross join lateral (
        select outcome from unnest(
          case n->>'implementation'
            when 'outreach.request' then array['declined','expired','failed']::text[]
            when 'intelligence' then array['empty','failed']::text[]
            when 'care_path.record' then array['failed']::text[]
            when 'care_path.complete' then array['not_found','failed']::text[]
            else array[]::text[]
          end
        ) outcome
      ) risky
  loop
    select t->>'to' into v_target
      from jsonb_array_elements(p_graph->'transitions') t
     where t->>'from' = v_source->>'id' and t->>'outcome' = v_outcome;
    if v_target is null or not (v_target = any(v_safe)) then
      raise exception '% % must lead to a care-team escalation',
        v_source->>'implementation', v_outcome using errcode = 'P0004';
    end if;
  end loop;
end;
$$;

revoke all on function public.compiler_node_outcomes(jsonb,jsonb,text) from public;
grant execute on function public.compiler_node_outcomes(jsonb,jsonb,text) to authenticated, service_role;
revoke all on function public.validate_compiled_care_path(uuid,jsonb) from public;
grant execute on function public.validate_compiled_care_path(uuid,jsonb) to authenticated, service_role;

create or replace function public.validate_compiler_flow_artifact()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_flow public.flows;
begin
  if new.artifact_type <> 'flow' then
    return new;
  end if;
  if new.flow_id is null then
    raise exception 'compiler flow artifact needs a flow' using errcode = 'P0004';
  end if;
  select * into v_flow from public.flows where id = new.flow_id;
  if v_flow.id is null or v_flow.org_id <> new.org_id or v_flow.family <> 'care_path' then
    raise exception 'compiler flow artifact is outside its care-path run' using errcode = 'P0004';
  end if;
  perform public.validate_compiled_care_path(new.org_id, v_flow.graph);
  return new;
end;
$$;

create trigger validate_compiler_flow_artifact
before insert or update of flow_id on public.compiler_artifacts
for each row execute function public.validate_compiler_flow_artifact();

revoke all on function public.validate_compiler_flow_artifact() from public;

do $$
declare
  v_artifact public.compiler_artifacts;
  v_graph jsonb;
begin
  for v_artifact in
    select * from public.compiler_artifacts
     where artifact_type = 'flow' and flow_id is not null
  loop
    select graph into v_graph from public.flows where id = v_artifact.flow_id;
    perform public.validate_compiled_care_path(v_artifact.org_id, v_graph);
  end loop;
end;
$$;

create or replace function public.publish_flow(p_flow_id uuid, p_graph jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_org_id uuid;
  v_next integer;
  v_row public.flows;
  v_graph jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;
  select * into v_row from public.flows where id = p_flow_id for update;
  if v_row.id is null then
    raise exception 'flow not found' using errcode = 'P0002';
  end if;
  v_org_id := v_row.org_id;
  if not public.can_release(v_org_id) then
    raise exception 'your role may not publish' using errcode = 'P0003';
  end if;
  v_graph := coalesce(p_graph, v_row.graph);
  perform public.validate_flow(v_graph, v_row.family, v_row.trigger_event);
  perform public.validate_flow_release(v_org_id, v_row.family, v_graph);
  if exists (
    select 1 from public.compiler_artifacts
     where flow_id = p_flow_id and org_id = v_org_id
  ) then
    perform public.validate_compiled_care_path(v_org_id, v_graph);
  end if;
  update public.flows set
    graph = v_graph, status = 'published', published_at = now(), updated_at = now()
   where id = p_flow_id returning * into v_row;
  if exists (
    select 1 from jsonb_array_elements(v_row.graph->'nodes') n
    join public.agents a on a.id = (n->'config'->>'agent_id')::uuid
    where n->>'implementation' = 'agent' and a.status <> 'published'
  ) then
    raise exception 'this flow uses an agent that has not been published' using errcode = 'P0004';
  end if;
  select coalesce(max(version), 0) + 1 into v_next
    from public.flow_versions where flow_id = p_flow_id;
  insert into public.flow_versions (org_id, flow_id, version, snapshot, published_by)
  values (v_org_id, p_flow_id, v_next, to_jsonb(v_row), auth.uid());
  return jsonb_build_object('flow', to_jsonb(v_row), 'version', v_next);
end;
$$;

revoke all on function public.publish_flow(uuid,jsonb) from public;
grant execute on function public.publish_flow(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
