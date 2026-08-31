-- `validate_flow` passed a graph with no nodes and a start naming nothing.
--
-- `array_agg` over zero rows returns NULL, not an empty array. `'nope' = any(NULL)`
-- is then NULL rather than false, `not NULL` is NULL rather than true, and the
-- `if` never fires. The check read correctly and tested nothing — which is the
-- worst kind of validation, because it reports success.
--
-- Coalesced to an empty array, and the empty-graph case refused outright: a flow
-- with no nodes cannot answer a call, so it is not publishable regardless.
create or replace function public.validate_flow(p_graph jsonb)
returns void language plpgsql stable set search_path = public as $$
declare
  v_ids  text[];
  v_node jsonb;
  v_tr   jsonb;
  v_def  public.catalogue_node_types;
begin
  if p_graph is null or jsonb_typeof(p_graph->'nodes') <> 'array' then
    raise exception 'the flow has no nodes' using errcode = 'P0004';
  end if;

  select coalesce(array_agg(n->>'id'), array[]::text[]) into v_ids
  from jsonb_array_elements(p_graph->'nodes') n;

  if cardinality(v_ids) = 0 then
    raise exception 'the flow has no nodes' using errcode = 'P0004';
  end if;

  if (p_graph->>'start') is null or not ((p_graph->>'start') = any(v_ids)) then
    raise exception 'the flow does not say which node answers the call' using errcode = 'P0004';
  end if;

  for v_node in select * from jsonb_array_elements(p_graph->'nodes') loop
    select * into v_def from public.catalogue_node_types
    where id = v_node->>'implementation' and is_active;

    if v_def.id is null then
      raise exception 'unknown node "%" in the flow', v_node->>'implementation' using errcode = 'P0004';
    end if;
    if v_def.node_type <> (v_node->>'type') then
      raise exception '% is a % node, not a %', v_def.label, v_def.node_type, v_node->>'type'
        using errcode = 'P0004';
    end if;
    if v_def.suspends and v_def.default_timeout_seconds is null
       and (v_node->'config'->>'timeout_seconds') is null then
      raise exception '% waits for something and has no timeout', v_def.label using errcode = 'P0004';
    end if;
  end loop;

  for v_tr in select * from jsonb_array_elements(coalesce(p_graph->'transitions', '[]'::jsonb)) loop
    if not ((v_tr->>'from') = any(v_ids)) or not ((v_tr->>'to') = any(v_ids)) then
      raise exception 'a transition points at a node that is not in the flow' using errcode = 'P0004';
    end if;
  end loop;
end;
$$;

grant execute on function public.validate_flow(jsonb) to authenticated;
