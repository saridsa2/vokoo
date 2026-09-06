\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org              uuid := '10000000-0000-0000-0000-000000000114';
  v_number           uuid := '20000000-0000-0000-0000-000000000114';
  v_call_flow        uuid := '30000000-0000-0000-0000-000000000114';
  v_integration_flow uuid := '40000000-0000-0000-0000-000000000114';
  v_started          jsonb;
  v_retried          jsonb;
  v_rejected         boolean := false;
begin
  insert into public.organizations (id, name, slug)
  values (v_org, 'Pinned call test', 'pinned-call-test-0114');

  insert into public.flows (id, org_id, name, description, status, graph, config,
                            trigger_event, channel, family)
  values
    (v_call_flow, v_org, 'One call lifecycle', '', 'published',
     '{"version":3,"nodes":[{"id":"answered","type":"trigger","implementation":"trigger.call_answered","config":{}},{"id":"ended","type":"trigger","implementation":"trigger.call_ended","config":{}}],"transitions":[],"variables":[]}'::jsonb,
     '{}'::jsonb, 'call.answered', 'voice', 'call'),
    (v_integration_flow, v_org, 'CRM push', '', 'published',
     '{"version":3,"nodes":[{"id":"manual","type":"trigger","implementation":"trigger.integration_manual","config":{}}],"transitions":[],"variables":[]}'::jsonb,
     '{}'::jsonb, 'call.ended', 'voice', 'integration');

  insert into public.phone_numbers (id, org_id, number, label, status, flow_id)
  values (v_number, v_org, '+918000000114', 'Test line', 'active', v_call_flow);

  insert into public.number_flows (org_id, phone_number_id, trigger_event, flow_id)
  values
    (v_org, v_number, 'call.answered', v_call_flow),
    (v_org, v_number, 'call.ended', v_integration_flow);

  insert into public.flow_versions (org_id, flow_id, version, snapshot)
  select v_org, v_call_flow, 1, to_jsonb(f) from public.flows f where f.id = v_call_flow;
  insert into public.flow_versions (org_id, flow_id, version, snapshot)
  select v_org, v_call_flow, 2,
         jsonb_set(to_jsonb(f), '{name}', '"Pinned version two"'::jsonb)
    from public.flows f where f.id = v_call_flow;

  v_started := public.start_call('kookoo', 'ucid-0114', '918000000114', '+919999999999');

  if v_started->>'call_id' is null
     or v_started->>'flow_id' <> v_call_flow::text
     or (v_started->>'flow_version')::integer <> 2 then
    raise exception 'start_call did not return and pin the latest published call flow: %', v_started;
  end if;

  insert into public.flow_versions (org_id, flow_id, version, snapshot)
  select v_org, v_call_flow, 3,
         jsonb_set(to_jsonb(f), '{name}', '"Published after answer"'::jsonb)
    from public.flows f where f.id = v_call_flow;

  v_retried := public.start_call('kookoo', 'ucid-0114', '918000000114', '+919999999999');
  if v_retried <> v_started then
    raise exception 'a retried start changed the call pin: first %, retry %', v_started, v_retried;
  end if;

  begin
    perform public.set_number_flow(v_number, 'call.answered', v_integration_flow);
  exception
    when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'an integration flow was accepted as a number call flow';
  end if;

  perform public.set_number_flow(v_number, 'call.answered', null);
  if exists (select 1 from public.number_flows where phone_number_id = v_number)
     or exists (select 1 from public.phone_numbers where id = v_number and flow_id is not null) then
    raise exception 'unbinding left a canonical or legacy flow pointer';
  end if;
end;
$$;

rollback;
