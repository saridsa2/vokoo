\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org       uuid := '10000000-0000-0000-0000-000000000115';
  v_other_org uuid := '11000000-0000-0000-0000-000000000115';
  v_source    uuid := '20000000-0000-0000-0000-000000000115';
  v_target    uuid := '30000000-0000-0000-0000-000000000115';
  v_other     uuid := '31000000-0000-0000-0000-000000000115';
  v_first     jsonb;
  v_duplicate jsonb;
  v_claimed   jsonb;
  v_rejected  boolean := false;
  v_stale     boolean := false;
  v_renewed   boolean;
begin
  insert into public.organizations (id, name, slug) values
    (v_org, 'Integration queue test', 'integration-queue-test-0115'),
    (v_other_org, 'Other integration queue test', 'other-integration-queue-test-0115');

  insert into public.flows (id, org_id, name, description, status, graph, config,
                            trigger_event, channel, family)
  values
    (v_source, v_org, 'Caller', '', 'published',
     '{"version":3,"nodes":[{"id":"ended","type":"trigger","implementation":"trigger.call_ended","config":{}}],"transitions":[],"variables":[]}',
     '{}', 'call.answered', 'voice', 'call'),
    (v_target, v_org, 'CRM', '', 'published',
     '{"version":3,"nodes":[{"id":"invoked","type":"trigger","implementation":"trigger.integration_invoked","config":{}}],"transitions":[],"variables":[]}',
     '{}', 'call.ended', 'voice', 'integration'),
    (v_other, v_other_org, 'Other CRM', '', 'published',
     '{"version":3,"nodes":[{"id":"invoked","type":"trigger","implementation":"trigger.integration_invoked","config":{}}],"transitions":[],"variables":[]}',
     '{}', 'call.ended', 'voice', 'integration');

  insert into public.flow_versions (org_id, flow_id, version, snapshot)
  select org_id, id, 1, to_jsonb(f) from public.flows f where id in (v_target, v_other);
  insert into public.flow_versions (org_id, flow_id, version, snapshot)
  select org_id, id, 2, jsonb_set(to_jsonb(f), '{name}', '"CRM v2"')
    from public.flows f where id = v_target;

  v_first := public.enqueue_integration_run(
    v_org, v_source, 8, 'call:0115', 'invoke-crm', v_target, 2,
    '{"lead":{"name":"Satya"}}', 'lead-0115', 4
  );
  v_duplicate := public.enqueue_integration_run(
    v_org, v_source, 8, 'call:0115-retry', 'invoke-crm', v_target, 2,
    '{"lead":{"name":"Changed"}}', 'lead-0115', 4
  );

  if v_first->>'id' <> v_duplicate->>'id'
     or (v_first->>'target_flow_version')::integer <> 2
     or v_duplicate->>'input' <> '{"lead": {"name": "Satya"}}' then
    raise exception 'enqueue was not version-pinned and idempotent: first %, duplicate %', v_first, v_duplicate;
  end if;

  begin
    perform public.enqueue_integration_run(
      v_org, v_source, 8, 'call:0115', 'invoke-other', v_other, 1, '{}', null, 3
    );
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'cross-organisation integration target was accepted';
  end if;

  begin
    perform public.enqueue_integration_run(
      v_org, v_source, 8, 'call:0115', 'invoke-missing-version', v_target, 3,
      '{}', null, 3
    );
  exception when sqlstate '42501' then v_stale := true;
  end;
  if not v_stale then
    raise exception 'an unvalidated target version was accepted';
  end if;

  v_claimed := public.claim_integration_run('worker-0115', 60);
  if v_claimed->>'id' <> v_first->>'id'
     or v_claimed->>'status' <> 'running'
     or (v_claimed->>'attempt_count')::integer <> 1 then
    raise exception 'claim did not lease the queued run: %', v_claimed;
  end if;

  update public.integration_runs set locked_at = now() - interval '90 seconds'
   where id = (v_first->>'id')::uuid;
  v_renewed := public.renew_integration_run_lease((v_first->>'id')::uuid, 'worker-0115');
  if not v_renewed or not exists (
       select 1 from public.integration_runs
        where id = (v_first->>'id')::uuid and locked_at > now() - interval '5 seconds'
     ) then
    raise exception 'the active worker could not renew its lease: renewed %, row %',
      v_renewed,
      (select to_jsonb(r) from public.integration_runs r where id = (v_first->>'id')::uuid);
  end if;

  perform public.fail_integration_run((v_first->>'id')::uuid, 'worker-0115', 'temporary outage', true);
  if not exists (
    select 1 from public.integration_runs
     where id = (v_first->>'id')::uuid and status = 'retryable'
       and locked_at is null and available_at > now()
       and available_at < now() + interval '61 minutes'
  ) then
    raise exception 'retryable failure was not scheduled, bounded, and unlocked';
  end if;

  update public.integration_runs set available_at = now() where id = (v_first->>'id')::uuid;
  v_claimed := public.claim_integration_run('worker-0115', 60);
  perform public.complete_integration_run((v_first->>'id')::uuid, 'worker-0115', '{"accepted":true}');
  if not exists (
    select 1 from public.integration_runs
     where id = (v_first->>'id')::uuid and status = 'succeeded'
       and attempt_count = 2 and result = '{"accepted":true}'
  ) then
    raise exception 'completion did not preserve attempts and result';
  end if;
end;
$$;

rollback;
