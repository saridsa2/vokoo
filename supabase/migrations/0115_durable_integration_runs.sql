-- Explicit integration invocation, with delivery that survives a process.
--
-- A source flow enqueues a validated payload. The target published version is
-- resolved once here and is never changed by retries. Workers lease rows with
-- SKIP LOCKED, so several bridge processes can cooperate without delivering
-- the same run concurrently.

begin;

create table if not exists public.integration_runs (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  source_flow_id         uuid references public.flows(id) on delete set null,
  source_flow_version    integer,
  source_execution_id    text,
  source_call_id         uuid references public.calls(id) on delete set null,
  source_node_id         text,
  target_flow_id         uuid not null references public.flows(id) on delete restrict,
  target_flow_version    integer not null,
  input                  jsonb not null,
  idempotency_key        text,
  status                 text not null default 'queued'
                         check (status in ('queued','running','succeeded','retryable','failed','cancelled')),
  attempt_count          integer not null default 0 check (attempt_count >= 0),
  max_attempts           integer not null default 5 check (max_attempts between 1 and 20),
  available_at           timestamptz not null default now(),
  locked_at              timestamptz,
  locked_by              text,
  result                 jsonb,
  last_error             text,
  started_at             timestamptz,
  finished_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
) ;

alter table public.integration_runs
  add constraint integration_runs_source_version_check
  check ((source_flow_version is null) = (source_flow_id is null));

create unique index if not exists integration_runs_idempotency_idx
  on public.integration_runs (org_id, target_flow_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists integration_runs_claim_idx
  on public.integration_runs (available_at, created_at)
  where status in ('queued','retryable','running');
create index if not exists integration_runs_org_created_idx
  on public.integration_runs (org_id, created_at desc);

create table if not exists public.integration_run_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  run_id         uuid not null references public.integration_runs(id) on delete cascade,
  sequence       integer not null,
  node_id        text,
  node_name      text,
  implementation text,
  outcome        text,
  duration_ms    integer,
  input          jsonb,
  output         jsonb,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (run_id, sequence)
);

alter table public.integration_runs enable row level security;
alter table public.integration_run_events enable row level security;
drop policy if exists org_member_access on public.integration_runs;
create policy org_member_access on public.integration_runs for select to authenticated
  using (public.is_org_member(org_id));
drop policy if exists org_member_access on public.integration_run_events;
create policy org_member_access on public.integration_run_events for select to authenticated
  using (public.is_org_member(org_id));
grant select on public.integration_runs, public.integration_run_events to authenticated;

-- Enqueue the exact immutable version the caller loaded and validated. The
-- function verifies that version is a published integration in this workspace;
-- it must never independently re-resolve "latest" after validation.
create or replace function public.enqueue_integration_run(
  p_org_id              uuid,
  p_source_flow_id      uuid,
  p_source_flow_version integer,
  p_source_execution_id text,
  p_source_node_id      text,
  p_target_flow_id      uuid,
  p_target_flow_version integer,
  p_input               jsonb,
  p_idempotency_key     text default null,
  p_max_attempts        integer default 5,
  p_source_call_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run     public.integration_runs;
  v_key     text := nullif(btrim(p_idempotency_key), '');
begin
  if p_source_flow_id is not null and not exists (
    select 1 from public.flows
     where id = p_source_flow_id and org_id = p_org_id
  ) then
    raise exception 'source flow is not in this workspace' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.flows f
      join public.flow_versions fv on fv.flow_id = f.id and fv.org_id = f.org_id
     where f.id = p_target_flow_id
       and f.org_id = p_org_id
       and f.family = 'integration'
       and f.status = 'published'
       and fv.version = p_target_flow_version
  ) then
    raise exception 'target version is not a published integration in this workspace'
      using errcode = '42501';
  end if;

  insert into public.integration_runs (
    org_id, source_flow_id, source_flow_version, source_execution_id,
    source_call_id, source_node_id, target_flow_id, target_flow_version,
    input, idempotency_key, max_attempts
  ) values (
    p_org_id, p_source_flow_id, p_source_flow_version, p_source_execution_id,
    p_source_call_id, p_source_node_id, p_target_flow_id, p_target_flow_version,
    coalesce(p_input, 'null'::jsonb), v_key, greatest(1, least(coalesce(p_max_attempts, 5), 20))
  )
  on conflict (org_id, target_flow_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning * into v_run;

  if v_run.id is null and v_key is not null then
    select * into v_run from public.integration_runs
     where org_id = p_org_id
       and target_flow_id = p_target_flow_id
       and idempotency_key = v_key;
  end if;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.enqueue_integration_run(uuid,uuid,integer,text,text,uuid,integer,jsonb,text,integer,uuid) from public;
grant execute on function public.enqueue_integration_run(uuid,uuid,integer,text,text,uuid,integer,jsonb,text,integer,uuid) to service_role;

create or replace function public.claim_integration_run(
  p_worker text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_run public.integration_runs;
begin
  select id into v_id
    from public.integration_runs
   where attempt_count < max_attempts
     and (
       (status in ('queued','retryable') and available_at <= now())
       or (status = 'running' and locked_at < now() - make_interval(secs => greatest(10, p_lease_seconds)))
     )
   order by available_at, created_at
   for update skip locked
   limit 1;

  if v_id is null then return null; end if;
  update public.integration_runs set
    status = 'running', attempt_count = attempt_count + 1,
    locked_at = now(), locked_by = p_worker,
    started_at = coalesce(started_at, now()), updated_at = now()
  where id = v_id returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.claim_integration_run(text,integer) from public;
grant execute on function public.claim_integration_run(text,integer) to service_role;

create or replace function public.renew_integration_run_lease(p_run_id uuid, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_renewed boolean;
begin
  update public.integration_runs
     set locked_at = now(), updated_at = now()
   where id = p_run_id and status = 'running' and locked_by = p_worker
   returning true into v_renewed;
  return coalesce(v_renewed, false);
end;
$$;

revoke all on function public.renew_integration_run_lease(uuid,text) from public;
grant execute on function public.renew_integration_run_lease(uuid,text) to service_role;

create or replace function public.integration_run_event(
  p_run_id uuid, p_worker text, p_node_id text, p_node_name text,
  p_implementation text, p_outcome text, p_duration_ms integer,
  p_input jsonb default null, p_output jsonb default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_next integer;
begin
  select org_id into v_org from public.integration_runs
   where id = p_run_id and status = 'running' and locked_by = p_worker
   for update;
  if v_org is null then raise exception 'run is not leased by this worker' using errcode = 'P0004'; end if;
  select coalesce(max(sequence), 0) + 1 into v_next
    from public.integration_run_events where run_id = p_run_id;
  insert into public.integration_run_events (
    org_id, run_id, sequence, node_id, node_name, implementation,
    outcome, duration_ms, input, output, detail
  ) values (
    v_org, p_run_id, v_next, p_node_id, p_node_name, p_implementation,
    p_outcome, p_duration_ms, p_input, p_output, coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.integration_run_event(uuid,text,text,text,text,text,integer,jsonb,jsonb,jsonb) from public;
grant execute on function public.integration_run_event(uuid,text,text,text,text,text,integer,jsonb,jsonb,jsonb) to service_role;

create or replace function public.complete_integration_run(
  p_run_id uuid, p_worker text, p_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.integration_runs;
begin
  update public.integration_runs set
    status = 'succeeded', result = p_result, last_error = null,
    locked_at = null, locked_by = null, finished_at = now(), updated_at = now()
  where id = p_run_id and status = 'running' and locked_by = p_worker
  returning * into v_run;
  if v_run.id is null then raise exception 'run is not leased by this worker' using errcode = 'P0004'; end if;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.complete_integration_run(uuid,text,jsonb) from public;
grant execute on function public.complete_integration_run(uuid,text,jsonb) to service_role;

create or replace function public.fail_integration_run(
  p_run_id uuid, p_worker text, p_error text, p_retryable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.integration_runs;
begin
  update public.integration_runs set
    status = case when p_retryable and attempt_count < max_attempts then 'retryable' else 'failed' end,
    available_at = case
      when p_retryable and attempt_count < max_attempts
      then now() + make_interval(secs => least(3600, (15 * power(2, greatest(0, attempt_count - 1)))::integer)
                                      + floor(random() * 10)::integer)
      else available_at end,
    last_error = left(coalesce(p_error, 'integration failed'), 4000),
    locked_at = null, locked_by = null,
    finished_at = case when p_retryable and attempt_count < max_attempts then null else now() end,
    updated_at = now()
  where id = p_run_id and status = 'running' and locked_by = p_worker
  returning * into v_run;
  if v_run.id is null then raise exception 'run is not leased by this worker' using errcode = 'P0004'; end if;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.fail_integration_run(uuid,text,text,boolean) from public;
grant execute on function public.fail_integration_run(uuid,text,text,boolean) to service_role;

create or replace function public.retry_integration_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.integration_runs;
begin
  select * into v_run from public.integration_runs where id = p_run_id;
  if v_run.id is null or not public.is_org_member(v_run.org_id) then
    raise exception 'run not found' using errcode = '42501';
  end if;
  if v_run.status not in ('failed','retryable') then
    raise exception 'only a failed run can be retried' using errcode = 'P0004';
  end if;
  update public.integration_runs set
    status = 'queued', attempt_count = 0, available_at = now(),
    locked_at = null, locked_by = null, finished_at = null, updated_at = now()
  where id = p_run_id returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.retry_integration_run(uuid) from public;
grant execute on function public.retry_integration_run(uuid) to authenticated;

-- ---------------------------------------------------------------- vocabulary

insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action, suspends,
  default_timeout_seconds, outcomes, fields, sort_order, is_active,
  valid_triggers, families, is_addable, outcomes_from, output
) values
  ('trigger.integration_invoked', 'trigger', 'Integration invoked',
   'Another flow supplied a validated payload to this reusable integration.',
   null, false, null,
   '[{"id":"started","label":"Started"}]'::jsonb,
   '[{"key":"input_schema_id","type":"structured_output","label":"Input schema","required":true,"help":"The payload every caller of this integration must supply."},{"key":"clinical_payload_kind","type":"select","label":"Clinical payload","required":false,"options":[{"id":"person","label":"Person"},{"id":"lab_report","label":"Lab report"},{"id":"imaging_report","label":"Imaging report"},{"id":"medication","label":"Medication"},{"id":"family_health","label":"Family health"}]}]'::jsonb,
   -1, true, array[]::text[], array['integration']::text[], false, null, 'opaque'),
  ('integration.invoke', 'custom', 'Invoke integration',
   'Validate a mapped payload and enqueue a reusable integration workflow.',
   null, false, null,
   '[{"id":"queued","label":"Queued"},{"id":"invalid_payload","label":"Invalid payload"},{"id":"failed","label":"Could not queue"}]'::jsonb,
   '[{"key":"target_flow_id","type":"integration","label":"Integration","required":true},{"key":"input","type":"template","label":"Input","required":true,"help":"JSON or an expression that resolves to the target input."},{"key":"idempotency_key","type":"text","label":"Idempotency key","required":false},{"key":"max_attempts","type":"number","label":"Maximum attempts","required":false,"default":5}]'::jsonb,
   22, true, array[]::text[], array['call','care_path','message','general']::text[], true, null, 'opaque')
on conflict (id) do update set
  node_type = excluded.node_type, label = excluded.label,
  description = excluded.description, provider_action = excluded.provider_action,
  suspends = excluded.suspends, default_timeout_seconds = excluded.default_timeout_seconds,
  outcomes = excluded.outcomes, fields = excluded.fields, sort_order = excluded.sort_order,
  is_active = excluded.is_active, valid_triggers = excluded.valid_triggers,
  families = excluded.families, is_addable = excluded.is_addable,
  outcomes_from = excluded.outcomes_from, output = excluded.output;

update public.catalogue_node_types
   set families = array['call','care_path']::text[],
       label = 'Extract data',
       description = 'Turn persisted call or document data into a filled-in schema before invoking an integration.'
 where id = 'intelligence';

create or replace function public.validate_flow_release(
  p_org_id uuid, p_family text, p_graph jsonb
)
returns void language plpgsql stable set search_path = public as $$
declare v_node jsonb; v_schema text; v_target text;
begin
  if exists (
    select 1 from jsonb_array_elements(p_graph->'nodes') n
    left join public.catalogue_node_types t on t.id = n->>'implementation'
    where t.id is null or not (p_family = any(t.families))
  ) then
    raise exception 'the flow contains a node outside its family' using errcode = 'P0004';
  end if;

  if p_family = 'integration' then
    if (select count(*) from jsonb_array_elements(p_graph->'nodes') n
         where n->>'implementation' = 'trigger.integration_invoked') <> 1
       or exists (select 1 from jsonb_array_elements(p_graph->'nodes') n
                   where n->>'implementation' like 'trigger.%'
                     and n->>'implementation' <> 'trigger.integration_invoked') then
      raise exception 'an integration needs exactly one Integration invoked trigger'
        using errcode = 'P0004';
    end if;
    select n->'config'->>'input_schema_id' into v_schema
      from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' = 'trigger.integration_invoked';
    if coalesce(v_schema, '') = '' or not exists (
      select 1 from public.structured_outputs
       where id = v_schema::uuid and org_id = p_org_id and enabled
    ) then
      raise exception 'the integration trigger needs an enabled input schema in this workspace'
        using errcode = 'P0004';
    end if;
  end if;

  for v_node in
    select n from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' = 'integration.invoke'
  loop
    v_target := v_node->'config'->>'target_flow_id';
    if coalesce(v_target, '') = '' or not exists (
      select 1 from public.flows
       where id = v_target::uuid and org_id = p_org_id
         and family = 'integration' and status = 'published'
    ) then
      raise exception 'Invoke integration needs a published integration in this workspace'
        using errcode = 'P0004';
    end if;
  end loop;
end;
$$;

revoke all on function public.validate_flow_release(uuid,text,jsonb) from public;
grant execute on function public.validate_flow_release(uuid,text,jsonb) to authenticated;

-- Add the release-only validation without weakening any validation from 0112.
create or replace function public.publish_flow(p_flow_id uuid, p_graph jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_org_id uuid; v_next integer; v_row public.flows; v_graph jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = 'P0001'; end if;
  select * into v_row from public.flows where id = p_flow_id for update;
  if v_row.id is null then raise exception 'flow not found' using errcode = 'P0002'; end if;
  v_org_id := v_row.org_id;
  if not public.can_release(v_org_id) then raise exception 'your role may not publish' using errcode = 'P0003'; end if;
  v_graph := coalesce(p_graph, v_row.graph);
  perform public.validate_flow(v_graph, v_row.family, v_row.trigger_event);
  perform public.validate_flow_release(v_org_id, v_row.family, v_graph);
  update public.flows set graph = v_graph, status = 'published', published_at = now(), updated_at = now()
   where id = p_flow_id returning * into v_row;
  if exists (
    select 1 from jsonb_array_elements(v_row.graph->'nodes') n
    join public.agents a on a.id = (n->'config'->>'agent_id')::uuid
    where n->>'implementation' = 'agent' and a.status <> 'published'
  ) then raise exception 'this flow uses an agent that has not been published' using errcode = 'P0004'; end if;
  select coalesce(max(version), 0) + 1 into v_next from public.flow_versions where flow_id = p_flow_id;
  insert into public.flow_versions (org_id, flow_id, version, snapshot, published_by)
  values (v_org_id, p_flow_id, v_next, to_jsonb(v_row), auth.uid());
  return jsonb_build_object('flow', to_jsonb(v_row), 'version', v_next);
end;
$$;

revoke all on function public.publish_flow(uuid,jsonb) from public;
grant execute on function public.publish_flow(uuid,jsonb) to authenticated;

commit;
