-- Durable compiler runs over one immutable, indexed document version.
-- Model work happens in the document worker; these rows are the tenant-scoped
-- queue and the reviewable structured record of what it did.

begin;

create table public.compiler_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null,
  file_version_id uuid not null,
  extraction_id uuid not null,
  compiler_id text not null check (compiler_id = 'care_path'),
  status text not null default 'queued' check (status in (
    'queued','planning','compiling','validating','materializing',
    'completed','completed_with_gaps','failed','cancelled'
  )),
  provider text not null check (btrim(provider) <> ''),
  model text not null check (btrim(model) <> ''),
  compiler_version text not null check (btrim(compiler_version) <> ''),
  prompt_version text not null check (btrim(prompt_version) <> ''),
  retrieval_profile text,
  catalogue_digest text not null check (catalogue_digest ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  summary text,
  coverage jsonb not null default '{}'::jsonb check (jsonb_typeof(coverage) = 'object'),
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint compiler_runs_file_same_org
    foreign key (file_id, org_id) references public.files(id, org_id) on delete cascade,
  constraint compiler_runs_version_same_org
    foreign key (file_version_id, org_id) references public.file_versions(id, org_id) on delete cascade,
  constraint compiler_runs_extraction_same_version
    foreign key (extraction_id, file_version_id, org_id)
    references public.document_extractions(id, file_version_id, org_id)
);

create unique index compiler_runs_one_active_version_idx
  on public.compiler_runs (org_id, file_version_id, compiler_id, compiler_version)
  where status in ('queued','planning','compiling','validating','materializing');
create index compiler_runs_claim_idx
  on public.compiler_runs (available_at, created_at)
  where status in ('queued','planning','compiling','validating');

create table public.compiler_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  sequence integer not null check (sequence > 0),
  parent_step_id uuid,
  kind text not null check (kind in (
    'plan','retrieve','extract','reconcile','lower','validate','materialize'
  )),
  status text not null check (status in ('started','completed','failed','skipped')),
  task_key text check (task_key is null or btrim(task_key) <> ''),
  objective text,
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end >= page_start),
  input_refs jsonb not null default '{}'::jsonb check (jsonb_typeof(input_refs) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  provider_request_id text,
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  unique (run_id, sequence),
  unique (id, org_id),
  constraint compiler_steps_run_same_org
    foreign key (run_id, org_id) references public.compiler_runs(id, org_id) on delete cascade,
  constraint compiler_steps_parent_same_org
    foreign key (parent_step_id, org_id) references public.compiler_steps(id, org_id)
);

create table public.compiler_gaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  step_id uuid,
  code text not null check (btrim(code) <> ''),
  severity text not null check (severity in ('info','warning','blocking')),
  recommendation_id text not null default '',
  explanation text not null check (btrim(explanation) <> ''),
  missing_capability text,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  review_status text not null default 'open' check (review_status in ('open','accepted','resolved')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, code, recommendation_id),
  unique (id, org_id),
  constraint compiler_gaps_run_same_org
    foreign key (run_id, org_id) references public.compiler_runs(id, org_id) on delete cascade,
  constraint compiler_gaps_step_same_org
    foreign key (step_id, org_id) references public.compiler_steps(id, org_id)
);

alter table public.compiler_runs enable row level security;
alter table public.compiler_steps enable row level security;
alter table public.compiler_gaps enable row level security;

create policy compiler_runs_read on public.compiler_runs for select to authenticated
  using (public.is_org_member(org_id));
create policy compiler_steps_read on public.compiler_steps for select to authenticated
  using (public.is_org_member(org_id));
create policy compiler_gaps_read on public.compiler_gaps for select to authenticated
  using (public.is_org_member(org_id));

grant select on public.compiler_runs, public.compiler_steps, public.compiler_gaps to authenticated;

create or replace function public.protect_compiler_step()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'compiler steps are append only' using errcode = 'P0004';
end;
$$;

create trigger protect_compiler_step
before update or delete on public.compiler_steps
for each row execute function public.protect_compiler_step();

create or replace function public.enqueue_compiler_run(
  p_file_version_id uuid,
  p_compiler_id text,
  p_compiler_version text,
  p_prompt_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.file_versions;
  v_provider text;
  v_model text;
  v_catalogue jsonb;
  v_resources jsonb;
  v_digest text;
  v_run public.compiler_runs;
begin
  select * into v_version from public.file_versions where id = p_file_version_id;
  if v_version.id is null
     or not public.can_release(v_version.org_id) then
    raise exception 'document version not found' using errcode = '42501';
  end if;
  if p_compiler_id <> 'care_path'
     or btrim(coalesce(p_compiler_version, '')) = ''
     or btrim(coalesce(p_prompt_version, '')) = '' then
    raise exception 'unsupported compiler request' using errcode = 'P0004';
  end if;
  if v_version.status <> 'indexed' or v_version.active_extraction_id is null then
    raise exception 'document version is not indexed' using errcode = 'P0004';
  end if;
  if not exists (
    select 1
      from jsonb_array_elements(coalesce(v_version.intelligence->'recommendations', '[]'::jsonb)) r
     where r->>'compiler_id' = p_compiler_id
  ) then
    raise exception 'workspace intelligence did not recommend this compiler' using errcode = 'P0004';
  end if;

  select intelligence_provider, intelligence_model
    into v_provider, v_model
    from public.organizations where id = v_version.org_id;
  if btrim(coalesce(v_provider, '')) = '' or btrim(coalesce(v_model, '')) = '' then
    raise exception 'workspace intelligence is not configured' using errcode = 'P0004';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id, 'node_type', node_type, 'families', families,
      'outcomes', outcomes, 'fields', fields, 'outcomes_from', outcomes_from,
      'output', output, 'suspends', suspends
    ) order by id
  ), '[]'::jsonb)
  into v_catalogue
  from public.catalogue_node_types
  where is_active and 'care_path' = any(families);
  v_digest := encode(extensions.digest(convert_to(v_catalogue::text, 'utf8'), 'sha256'), 'hex');

  select jsonb_build_object(
    'agents', coalesce((select jsonb_agg(id order by id) from public.agents
      where org_id = v_version.org_id and status = 'published'), '[]'::jsonb),
    'schemas', coalesce((select jsonb_agg(id order by id) from public.structured_outputs
      where org_id = v_version.org_id and enabled), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(id order by id) from public.tools
      where org_id = v_version.org_id), '[]'::jsonb),
    'integrations', coalesce((select jsonb_agg(id order by id) from public.flows
      where org_id = v_version.org_id and family = 'integration' and status = 'published'), '[]'::jsonb)
  ) into v_resources;

  insert into public.compiler_runs (
    org_id, file_id, file_version_id, extraction_id, compiler_id,
    provider, model, compiler_version, prompt_version, retrieval_profile,
    catalogue_digest, input_snapshot, requested_by
  ) values (
    v_version.org_id, v_version.file_id, v_version.id, v_version.active_extraction_id,
    p_compiler_id, v_provider, v_model, btrim(p_compiler_version), btrim(p_prompt_version),
    v_version.active_embedding_profile, v_digest,
    jsonb_build_object('catalogue', v_catalogue, 'resources', v_resources), auth.uid()
  )
  on conflict (org_id, file_version_id, compiler_id, compiler_version)
    where status in ('queued','planning','compiling','validating','materializing')
  do nothing
  returning * into v_run;

  if v_run.id is null then
    select * into v_run from public.compiler_runs
     where org_id = v_version.org_id
       and file_version_id = v_version.id
       and compiler_id = p_compiler_id
       and compiler_version = btrim(p_compiler_version)
       and status in ('queued','planning','compiling','validating','materializing');
  end if;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.enqueue_compiler_run(uuid,text,text,text) from public, anon;
grant execute on function public.enqueue_compiler_run(uuid,text,text,text) to authenticated;

create or replace function public.claim_compiler_run(
  p_worker text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_run public.compiler_runs;
begin
  if btrim(coalesce(p_worker, '')) = '' then
    raise exception 'worker id is required' using errcode = 'P0004';
  end if;
  select id into v_id from public.compiler_runs
   where attempt_count < max_attempts and available_at <= now()
     and (
       status = 'queued'
       or (status in ('planning','compiling','validating') and lease_expires_at < now())
     )
   order by available_at, created_at
   for update skip locked limit 1;
  if v_id is null then return null; end if;

  update public.compiler_runs set
    status = 'planning', attempt_count = attempt_count + 1,
    lease_owner = p_worker,
    lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
    started_at = coalesce(started_at, now()), completed_at = null,
    last_error_code = null, last_error_detail = null, updated_at = now()
  where id = v_id returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.claim_compiler_run(text,integer) from public, anon, authenticated;
grant execute on function public.claim_compiler_run(text,integer) to service_role;

create or replace function public.renew_compiler_run_lease(
  p_run_id uuid,
  p_worker text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_renewed boolean;
begin
  update public.compiler_runs set
    lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
    updated_at = now()
  where id = p_run_id and lease_owner = p_worker and lease_expires_at > now()
    and status in ('planning','compiling','validating','materializing')
  returning true into v_renewed;
  return coalesce(v_renewed, false);
end;
$$;

revoke all on function public.renew_compiler_run_lease(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.renew_compiler_run_lease(uuid,text,integer) to service_role;

create or replace function public.append_compiler_step(
  p_run_id uuid,
  p_worker text,
  p_step jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.compiler_runs; v_step public.compiler_steps; v_sequence integer; v_parent uuid;
begin
  select * into v_run from public.compiler_runs where id = p_run_id for update;
  if v_run.id is null or v_run.lease_owner is distinct from p_worker
     or v_run.lease_expires_at <= now()
     or v_run.status not in ('planning','compiling','validating','materializing') then
    raise exception 'compiler run lease was lost' using errcode = 'P0004';
  end if;
  if coalesce(p_step->>'kind', '') not in ('plan','retrieve','extract','reconcile','lower','validate','materialize')
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

create or replace function public.advance_compiler_run(
  p_run_id uuid,
  p_worker text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.compiler_runs; v_allowed boolean;
begin
  select * into v_run from public.compiler_runs where id = p_run_id for update;
  if v_run.id is null or v_run.lease_owner is distinct from p_worker
     or v_run.lease_expires_at <= now() then
    raise exception 'compiler run lease was lost' using errcode = 'P0004';
  end if;
  v_allowed := (v_run.status = 'planning' and p_status = 'compiling')
    or (v_run.status = 'compiling' and p_status = 'validating')
    or (v_run.status = 'validating' and p_status = 'materializing');
  if not v_allowed then
    raise exception 'invalid compiler state transition from % to %', v_run.status, p_status using errcode = 'P0004';
  end if;
  update public.compiler_runs set status = p_status, updated_at = now()
   where id = p_run_id returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.advance_compiler_run(uuid,text,text) from public, anon, authenticated;
grant execute on function public.advance_compiler_run(uuid,text,text) to service_role;

create or replace function public.fail_compiler_run(
  p_run_id uuid,
  p_worker text,
  p_code text,
  p_detail text,
  p_retryable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.compiler_runs; v_retry boolean;
begin
  select * into v_run from public.compiler_runs where id = p_run_id for update;
  if v_run.id is null or v_run.lease_owner is distinct from p_worker
     or v_run.lease_expires_at <= now()
     or v_run.status not in ('planning','compiling','validating','materializing') then
    raise exception 'compiler run lease was lost' using errcode = 'P0004';
  end if;
  v_retry := coalesce(p_retryable, false) and v_run.attempt_count < v_run.max_attempts
    and v_run.status <> 'materializing';
  update public.compiler_runs set
    status = case when v_retry then 'queued' else 'failed' end,
    available_at = case when v_retry then now() + make_interval(secs => least(300, 5 * (1 << least(attempt_count, 5)))) else available_at end,
    lease_owner = null, lease_expires_at = null,
    last_error_code = nullif(btrim(p_code), ''), last_error_detail = left(p_detail, 2048),
    completed_at = case when v_retry then null else now() end, updated_at = now()
  where id = p_run_id returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.fail_compiler_run(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.fail_compiler_run(uuid,text,text,text,boolean) to service_role;

create or replace function public.cancel_compiler_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.compiler_runs;
begin
  select * into v_run from public.compiler_runs where id = p_run_id for update;
  if v_run.id is null or not public.can_release(v_run.org_id) then
    raise exception 'compiler run not found' using errcode = '42501';
  end if;
  if v_run.status = 'materializing' or v_run.status in ('completed','completed_with_gaps','failed','cancelled') then
    raise exception 'compiler run cannot be cancelled in state %', v_run.status using errcode = 'P0004';
  end if;
  update public.compiler_runs set status = 'cancelled', lease_owner = null,
    lease_expires_at = null, completed_at = now(), updated_at = now()
  where id = p_run_id returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.cancel_compiler_run(uuid) from public, anon;
grant execute on function public.cancel_compiler_run(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
