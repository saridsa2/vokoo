-- Human-requested compiler capabilities and operator-owned deterministic resolutions.

begin;

alter table public.compiler_gaps
  add column details jsonb not null default '{}'::jsonb;
alter table public.compiler_gaps
  add constraint compiler_gaps_details_object_check
  check (jsonb_typeof(details) = 'object');

alter table public.compiler_runs
  add column parent_run_id uuid references public.compiler_runs(id),
  add column resolution_digest text;
alter table public.compiler_runs
  add constraint compiler_runs_resolution_digest_check
  check (resolution_digest is null or resolution_digest ~ '^[0-9a-f]{64}$');

alter table public.compiler_steps drop constraint compiler_steps_kind_check;
alter table public.compiler_steps add constraint compiler_steps_kind_check check (kind in (
  'plan','retrieve','extract','reconcile','resolve','lower','validate','materialize'
));

create table public.compiler_capability_adapters (
  adapter_key text not null check (adapter_key ~ '^[a-z0-9][a-z0-9._-]+$'),
  adapter_version text not null check (btrim(adapter_version) <> ''),
  capability_key text not null check (btrim(capability_key) <> ''),
  label text not null check (btrim(label) <> ''),
  compatible_node_type_ids text[] not null check (cardinality(compatible_node_type_ids) > 0),
  mapping_schema jsonb not null check (jsonb_typeof(mapping_schema) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (adapter_key, adapter_version)
);

create table public.compiler_capability_resolutions (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null check (btrim(capability_key) <> ''),
  resolution_type text not null check (resolution_type in ('existing_component','new_component')),
  adapter_key text not null,
  adapter_version text not null,
  node_type_id text not null references public.catalogue_node_types(id),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  scope text not null default 'platform' check (scope = 'platform'),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (adapter_key, adapter_version)
    references public.compiler_capability_adapters(adapter_key, adapter_version)
);

create table public.capability_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  gap_id uuid not null,
  capability_key text not null check (btrim(capability_key) <> ''),
  requested_contract jsonb not null check (jsonb_typeof(requested_contract) = 'object'),
  contract_digest text not null check (contract_digest ~ '^[0-9a-f]{64}$'),
  status text not null default 'requested' check (status in (
    'requested','under_review','needs_information','delivering','resolved','declined','cancelled'
  )),
  workspace_note text check (workspace_note is null or char_length(workspace_note) <= 1000),
  operator_response text check (operator_response is null or char_length(operator_response) <= 2000),
  delivery_reference text check (delivery_reference is null or char_length(delivery_reference) <= 500),
  active_resolution_id uuid references public.compiler_capability_resolutions(id),
  requested_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gap_id),
  unique (id, org_id),
  foreign key (run_id, org_id) references public.compiler_runs(id, org_id) on delete cascade,
  foreign key (gap_id, org_id) references public.compiler_gaps(id, org_id) on delete cascade
);

create index capability_requests_queue_idx
  on public.capability_requests (status, capability_key, created_at);
create index capability_requests_org_run_idx
  on public.capability_requests (org_id, run_id);
create index compiler_capability_resolutions_active_idx
  on public.compiler_capability_resolutions (capability_key, status);

alter table public.capability_requests enable row level security;
alter table public.compiler_capability_adapters enable row level security;
alter table public.compiler_capability_resolutions enable row level security;

create policy capability_requests_read on public.capability_requests
  for select to authenticated using (public.is_org_member(org_id));
grant select on public.capability_requests to authenticated;

revoke all on public.compiler_capability_adapters from anon, authenticated;
revoke all on public.compiler_capability_resolutions from anon, authenticated;

insert into public.compiler_capability_adapters (
  adapter_key, adapter_version, capability_key, label,
  compatible_node_type_ids, mapping_schema, is_active
) values (
  'clinical-task-escalate-notify-v1', '1', 'clinical.task',
  'Use Notify care team for clinician work', array['escalate.notify'],
  '{"type":"object","additionalProperties":false,"required":["to","urgency"],"properties":{"to":{"type":"string","enum":["primary_team","on_call","clinician","coordinator"]},"urgency":{"type":"string","enum":["routine","soon","urgent","immediate"]}}}',
  true
);

-- Preserve typed gap contracts during the existing atomic materializer without
-- copying its large, security-sensitive body into a second implementation.
do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.materialize_care_path_compilation(uuid,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    'explanation, missing_capability, evidence
    ) values (',
    'explanation, missing_capability, details, evidence
    ) values ('
  );
  v_updated := replace(
    v_updated,
    'v_item->>''explanation'', v_item->>''missing_capability'',
      coalesce(v_item->''evidence'', ''[]''::jsonb)',
    'v_item->>''explanation'', v_item->>''missing_capability'',
      coalesce(v_item->''details'', ''{}''::jsonb),
      coalesce(v_item->''evidence'', ''[]''::jsonb)'
  );
  if v_updated = v_definition
     or position('missing_capability, details, evidence' in v_updated) = 0 then
    raise exception 'could not update compiler materializer for typed gap details';
  end if;
  execute v_updated;
end;
$$;

create or replace function public.append_compiler_step(
  p_run_id uuid, p_worker text, p_step jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run public.compiler_runs; v_step public.compiler_steps; v_sequence integer; v_parent uuid;
begin
  select * into v_run from public.compiler_runs where id = p_run_id for update;
  if v_run.id is null or v_run.lease_owner is distinct from p_worker
     or v_run.lease_expires_at <= now()
     or v_run.status not in ('planning','compiling','validating','materializing') then
    raise exception 'compiler run lease was lost' using errcode = 'P0004';
  end if;
  if coalesce(p_step->>'kind', '') not in ('plan','retrieve','extract','reconcile','resolve','lower','validate','materialize')
     or coalesce(p_step->>'status', '') not in ('started','completed','failed','skipped') then
    raise exception 'invalid compiler step' using errcode = 'P0004';
  end if;
  v_parent := nullif(p_step->>'parent_step_id', '')::uuid;
  if v_parent is not null and not exists (
    select 1 from public.compiler_steps where id = v_parent and run_id = v_run.id
  ) then
    raise exception 'compiler parent step is outside the run' using errcode = 'P0004';
  end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence
    from public.compiler_steps where run_id = v_run.id;
  insert into public.compiler_steps (
    org_id, run_id, sequence, parent_step_id, kind, status, task_key, objective,
    page_start, page_end, input_refs, result, provider_request_id,
    input_tokens, output_tokens, duration_ms, retry_count, error_code, error_detail
  ) values (
    v_run.org_id, v_run.id, v_sequence, v_parent, p_step->>'kind', p_step->>'status',
    nullif(btrim(p_step->>'task_key'), ''), p_step->>'objective',
    nullif(p_step->>'page_start', '')::integer, nullif(p_step->>'page_end', '')::integer,
    coalesce(p_step->'input_refs', '{}'::jsonb), coalesce(p_step->'result', '{}'::jsonb),
    p_step->>'provider_request_id', nullif(p_step->>'input_tokens', '')::bigint,
    nullif(p_step->>'output_tokens', '')::bigint, nullif(p_step->>'duration_ms', '')::bigint,
    coalesce(nullif(p_step->>'retry_count', '')::integer, 0),
    p_step->>'error_code', left(p_step->>'error_detail', 2048)
  ) returning * into v_step;
  return to_jsonb(v_step);
end;
$$;
revoke all on function public.append_compiler_step(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.append_compiler_step(uuid,text,jsonb) to service_role;

create or replace function public.request_compiler_capability(p_gap_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_gap public.compiler_gaps; v_run public.compiler_runs; v_request public.capability_requests;
begin
  select g.* into v_gap from public.compiler_gaps g where g.id = p_gap_id;
  if v_gap.id is null or not public.is_org_member(v_gap.org_id) then
    raise exception 'compiler gap not found' using errcode = '42501';
  end if;
  select * into v_run from public.compiler_runs where id = v_gap.run_id;
  if v_run.status not in ('completed','completed_with_gaps','failed','cancelled') then
    raise exception 'compiler run is not terminal' using errcode = 'P0004';
  end if;
  if v_gap.code = 'threshold_requires_mapping'
     and v_gap.missing_capability = 'clinical.threshold_mapping' then
    if not (v_gap.details ?& array['observation','operator','value','unit'])
       or exists (select 1 from jsonb_object_keys(v_gap.details) k where k not in ('observation','operator','value','unit'))
       or btrim(coalesce(v_gap.details->>'observation','')) = ''
       or btrim(coalesce(v_gap.details->>'operator','')) = ''
       or btrim(coalesce(v_gap.details->>'unit','')) = ''
       or v_gap.details->'value' is null or v_gap.details->'value' = 'null'::jsonb then
      raise exception 'compiler gap has no requestable typed contract' using errcode = 'P0004';
    end if;
  elsif v_gap.code = 'unsupported_action_actor'
        and v_gap.missing_capability = 'clinical.task' then
    if not (v_gap.details ?& array['actor','action_key','what','instructions','expires_days'])
       or exists (select 1 from jsonb_object_keys(v_gap.details) k where k not in ('actor','action_key','what','instructions','expires_days'))
       or v_gap.details->>'actor' not in ('clinician','care_team')
       or btrim(coalesce(v_gap.details->>'action_key','')) = ''
       or btrim(coalesce(v_gap.details->>'what','')) = ''
       or btrim(coalesce(v_gap.details->>'instructions','')) = ''
       or jsonb_typeof(v_gap.details->'expires_days') <> 'number' then
      raise exception 'compiler gap has no requestable typed contract' using errcode = 'P0004';
    end if;
  else
    raise exception 'compiler gap is not requestable' using errcode = 'P0004';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'workspace note is too long' using errcode = 'P0004';
  end if;
  insert into public.capability_requests (
    org_id, run_id, gap_id, capability_key, requested_contract,
    contract_digest, workspace_note, requested_by
  ) values (
    v_gap.org_id, v_gap.run_id, v_gap.id, v_gap.missing_capability, v_gap.details,
    encode(extensions.digest(convert_to(v_gap.details::text, 'utf8'), 'sha256'), 'hex'),
    nullif(btrim(p_note), ''), auth.uid()
  ) on conflict (gap_id) do nothing returning * into v_request;
  if v_request.id is null then
    select * into v_request from public.capability_requests where gap_id = v_gap.id;
  end if;
  return to_jsonb(v_request);
end;
$$;
revoke all on function public.request_compiler_capability(uuid,text) from public, anon;
grant execute on function public.request_compiler_capability(uuid,text) to authenticated;

create or replace function public.transition_compiler_capability_request(
  p_request_id uuid, p_status text, p_response text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.capability_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  if p_status not in ('under_review','needs_information','delivering','declined','cancelled')
     or (p_status in ('needs_information','delivering','declined') and btrim(coalesce(p_response,'')) = '')
     or char_length(coalesce(p_response,'')) > 2000 then
    raise exception 'invalid capability request transition' using errcode = 'P0004';
  end if;
  update public.capability_requests set
    status = p_status,
    operator_response = case when p_status = 'delivering' then operator_response else nullif(btrim(p_response), '') end,
    delivery_reference = case when p_status = 'delivering' then nullif(btrim(p_response), '') else delivery_reference end,
    updated_at = now()
  where id = p_request_id and status <> 'resolved' returning * into v_request;
  if v_request.id is null then raise exception 'capability request not found or terminal' using errcode = 'P0004'; end if;
  return to_jsonb(v_request);
end;
$$;
revoke all on function public.transition_compiler_capability_request(uuid,text,text) from public, anon;
grant execute on function public.transition_compiler_capability_request(uuid,text,text) to authenticated;

create or replace function public.resolve_compiler_capability_request(
  p_request_id uuid, p_resolution_type text, p_adapter_key text,
  p_node_type_id text, p_mapping jsonb, p_response text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.capability_requests; v_adapter public.compiler_capability_adapters;
        v_resolution public.compiler_capability_resolutions;
begin
  if not public.is_platform_admin() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  select * into v_request from public.capability_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'capability request not found' using errcode = 'P0004'; end if;
  if v_request.status = 'resolved' and v_request.active_resolution_id is not null then
    select * into v_resolution from public.compiler_capability_resolutions where id = v_request.active_resolution_id;
    return to_jsonb(v_resolution);
  end if;
  select * into v_adapter from public.compiler_capability_adapters
   where adapter_key = p_adapter_key and capability_key = v_request.capability_key and is_active
   order by adapter_version desc limit 1;
  if v_adapter.adapter_key is null
     or not (p_node_type_id = any(v_adapter.compatible_node_type_ids))
     or not exists (select 1 from public.catalogue_node_types where id = p_node_type_id and is_active)
     or p_resolution_type not in ('existing_component','new_component') then
    raise exception 'adapter and active catalogue node are incompatible' using errcode = 'P0004';
  end if;
  if p_mapping is null or jsonb_typeof(p_mapping) <> 'object'
     or not (p_mapping ?& array['to','urgency'])
     or exists (select 1 from jsonb_object_keys(p_mapping) k where k not in ('to','urgency'))
     or p_mapping->>'to' not in ('primary_team','on_call','clinician','coordinator')
     or p_mapping->>'urgency' not in ('routine','soon','urgent','immediate') then
    raise exception 'mapping does not satisfy the registered adapter' using errcode = 'P0004';
  end if;
  insert into public.compiler_capability_resolutions (
    capability_key, resolution_type, adapter_key, adapter_version,
    node_type_id, mapping, status, created_by
  ) values (
    v_request.capability_key, p_resolution_type, v_adapter.adapter_key,
    v_adapter.adapter_version, p_node_type_id, p_mapping, 'active', auth.uid()
  ) returning * into v_resolution;
  update public.capability_requests set
    status = 'resolved', active_resolution_id = v_resolution.id,
    operator_response = nullif(btrim(p_response), ''), resolved_by = auth.uid(),
    resolved_at = now(), updated_at = now()
  where id = v_request.id;
  return to_jsonb(v_resolution);
end;
$$;
revoke all on function public.resolve_compiler_capability_request(uuid,text,text,text,jsonb,text) from public, anon;
grant execute on function public.resolve_compiler_capability_request(uuid,text,text,text,jsonb,text) to authenticated;

create or replace function public.enqueue_compiler_recompile(p_parent_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parent public.compiler_runs; v_version public.file_versions; v_catalogue jsonb; v_resources jsonb;
        v_resolutions jsonb; v_digest text; v_catalogue_digest text; v_run public.compiler_runs;
begin
  select * into v_parent from public.compiler_runs where id = p_parent_run_id for update;
  if v_parent.id is null or not public.is_org_member(v_parent.org_id) then
    raise exception 'compiler run not found' using errcode = '42501';
  end if;
  if v_parent.status not in ('completed','completed_with_gaps','failed','cancelled') then
    raise exception 'compiler run is not terminal' using errcode = 'P0004';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', q.id, 'gap_id', q.gap_id, 'resolution_id', r.id,
    'recommendation_id', g.recommendation_id,
    'capability_key', r.capability_key, 'adapter_key', r.adapter_key,
    'adapter_version', r.adapter_version, 'node_type_id', r.node_type_id,
    'mapping', r.mapping
  ) order by q.id), '[]'::jsonb)
  into v_resolutions
  from public.capability_requests q
  join public.compiler_capability_resolutions r on r.id = q.active_resolution_id and r.status = 'active'
  join public.compiler_gaps g on g.id = q.gap_id and g.run_id = q.run_id and g.org_id = q.org_id
  join public.compiler_capability_adapters a on a.adapter_key = r.adapter_key
    and a.adapter_version = r.adapter_version and a.is_active
    and r.node_type_id = any(a.compatible_node_type_ids)
  join public.catalogue_node_types n on n.id = r.node_type_id and n.is_active
  where q.run_id = v_parent.id and q.org_id = v_parent.org_id and q.status = 'resolved';
  if jsonb_array_length(v_resolutions) = 0 then
    raise exception 'no active compiler capability resolution is available' using errcode = 'P0004';
  end if;
  v_digest := encode(extensions.digest(convert_to(v_resolutions::text, 'utf8'), 'sha256'), 'hex');
  select * into v_version from public.file_versions where id = v_parent.file_version_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'node_type', node_type, 'families', families, 'outcomes', outcomes,
    'fields', fields, 'outcomes_from', outcomes_from, 'output', output, 'suspends', suspends
  ) order by id), '[]'::jsonb)
  into v_catalogue from public.catalogue_node_types where is_active and 'care_path' = any(families);
  v_catalogue_digest := encode(extensions.digest(convert_to(v_catalogue::text, 'utf8'), 'sha256'), 'hex');
  select jsonb_build_object(
    'agents', coalesce((select jsonb_agg(id order by id) from public.agents where org_id=v_parent.org_id and status='published'),'[]'),
    'schemas', coalesce((select jsonb_agg(id order by id) from public.structured_outputs where org_id=v_parent.org_id and enabled),'[]'),
    'tools', coalesce((select jsonb_agg(id order by id) from public.tools where org_id=v_parent.org_id),'[]'),
    'integrations', coalesce((select jsonb_agg(id order by id) from public.flows where org_id=v_parent.org_id and family='integration' and status='published'),'[]')
  ) into v_resources;
  insert into public.compiler_runs (
    org_id, file_id, file_version_id, extraction_id, compiler_id, status,
    provider, model, compiler_version, prompt_version, retrieval_profile,
    catalogue_digest, input_snapshot, requested_by, parent_run_id, resolution_digest
  ) values (
    v_parent.org_id, v_parent.file_id, v_parent.file_version_id, v_version.active_extraction_id,
    v_parent.compiler_id, 'queued', v_parent.provider, v_parent.model,
    v_parent.compiler_version, v_parent.prompt_version, v_version.active_embedding_profile,
    v_catalogue_digest, jsonb_build_object('catalogue',v_catalogue,'resources',v_resources,'resolutions',v_resolutions),
    auth.uid(), v_parent.id, v_digest
  ) on conflict (org_id,file_version_id,compiler_id,compiler_version)
    where status in ('queued','planning','compiling','validating','materializing')
    do nothing returning * into v_run;
  if v_run.id is null then
    select * into v_run from public.compiler_runs where org_id=v_parent.org_id
      and file_version_id=v_parent.file_version_id and compiler_id=v_parent.compiler_id
      and compiler_version=v_parent.compiler_version
      and status in ('queued','planning','compiling','validating','materializing');
  end if;
  return to_jsonb(v_run);
end;
$$;
revoke all on function public.enqueue_compiler_recompile(uuid) from public, anon;
grant execute on function public.enqueue_compiler_recompile(uuid) to authenticated;

create or replace function public.operator_compiler_capability_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'org_id', q.org_id, 'organization_name', o.name,
      'run_id', q.run_id, 'gap_id', q.gap_id,
      'capability_key', q.capability_key, 'requested_contract', q.requested_contract,
      'contract_digest', q.contract_digest, 'status', q.status,
      'workspace_note', q.workspace_note, 'operator_response', q.operator_response,
      'delivery_reference', q.delivery_reference,
      'active_resolution_id', q.active_resolution_id,
      'created_at', q.created_at, 'updated_at', q.updated_at,
      'demand_count', (
        select count(*) from public.capability_requests demand
        where demand.capability_key = q.capability_key
          and demand.contract_digest = q.contract_digest
      )
    ) order by q.created_at desc)
    from public.capability_requests q
    join public.organizations o on o.id = q.org_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.operator_compiler_capability_requests() from public, anon;
grant execute on function public.operator_compiler_capability_requests() to authenticated;

create or replace function public.operator_compiler_capability_adapters()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'operator access required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'adapter_key', a.adapter_key, 'adapter_version', a.adapter_version,
      'capability_key', a.capability_key, 'label', a.label,
      'mapping_schema', a.mapping_schema,
      'compatible_nodes', coalesce((
        select jsonb_agg(jsonb_build_object('id', n.id, 'label', n.label) order by n.sort_order)
        from public.catalogue_node_types n
        where n.is_active and n.id = any(a.compatible_node_type_ids)
      ), '[]'::jsonb)
    ) order by a.capability_key, a.adapter_key, a.adapter_version)
    from public.compiler_capability_adapters a where a.is_active
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.operator_compiler_capability_adapters() from public, anon;
grant execute on function public.operator_compiler_capability_adapters() to authenticated;

notify pgrst, 'reload schema';

commit;
