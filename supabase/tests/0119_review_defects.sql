\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org uuid;
  v_schema uuid;
  v_graph jsonb;
  v_rejected boolean := false;
begin
  if exists (
    select 1 from public.structured_outputs
     where origin = 'vendor'
       and (lower(name) like '%wellall%' or lower(description) like '%wellall%' or lower(schema::text) like '%wellall%')
  ) then
    raise exception 'a vendor schema still carries the retired namespace';
  end if;

  if exists (
    select 1 from public.structured_outputs s
    cross join lateral jsonb_path_query(s.schema, '$.**.description') d
    where s.origin = 'vendor' and (d #>> '{}') ~ '[一-龥]'
  ) then
    raise exception 'a vendor schema still carries a Chinese description';
  end if;

  if exists (
    select 1 from public.cohorts c
    join public.flows f on f.id = c.flow_id
    where f.family <> 'care_path'
  ) then
    raise exception 'a cohort still points at a flow outside the care_path family';
  end if;

  if exists (
    select 1 from public.flows f
     where f.status = 'published'
       and exists (
         select 1 from jsonb_array_elements(f.graph->'nodes') n
          where n->>'implementation' like 'trigger.%'
            and not exists (
              select 1 from jsonb_array_elements(coalesce(f.graph->'transitions', '[]'::jsonb)) t
               where t->>'from' = n->>'id'
            )
       )
  ) then
    raise exception 'an inert flow remains published';
  end if;

  select org_id, id into v_org, v_schema
    from public.structured_outputs
   where enabled
   limit 1;
  v_graph := jsonb_build_object(
    'version', 3,
    'nodes', jsonb_build_array(jsonb_build_object(
      'id', 'trigger', 'type', 'trigger',
      'implementation', 'trigger.integration_invoked',
      'config', jsonb_build_object('input_schema_id', v_schema::text)
    )),
    'transitions', '[]'::jsonb,
    'variables', '[]'::jsonb
  );

  begin
    perform public.validate_flow(v_graph, 'integration', 'integration.invoked');
    perform public.validate_flow_release(v_org, 'integration', v_graph);
  exception when sqlstate 'P0004' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'a trigger-only integration is still publishable';
  end if;

  v_graph := jsonb_set(
    v_graph,
    '{nodes}',
    (v_graph->'nodes') || '[{"id":"send","type":"custom","implementation":"http.request","config":{}}]'::jsonb
  );
  v_graph := jsonb_set(
    v_graph,
    '{transitions}',
    '[{"id":"start","from":"trigger","outcome":"started","to":"send"}]'::jsonb
  );
  perform public.validate_flow(v_graph, 'integration', 'integration.invoked');
  perform public.validate_flow_release(v_org, 'integration', v_graph);
end;
$$;

rollback;
