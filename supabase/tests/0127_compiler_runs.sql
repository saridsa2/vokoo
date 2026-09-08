\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('public.compiler_runs') is null
     or to_regclass('public.compiler_steps') is null
     or to_regclass('public.compiler_gaps') is null then
    raise exception 'compiler ledger is missing';
  end if;
end;
$$;

insert into public.organizations (id, name, slug)
values
  ('10000000-0000-0000-0000-000000000127', 'Compiler ledger test', 'compiler-ledger-0127'),
  ('20000000-0000-0000-0000-000000000127', 'Other compiler test', 'other-compiler-0127');

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '30000000-0000-0000-0000-000000000127', 'authenticated', 'authenticated',
  'compiler-ledger-0127@example.test', now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.memberships (org_id, user_id, role, display_name)
values (
  '10000000-0000-0000-0000-000000000127',
  '30000000-0000-0000-0000-000000000127',
  'developer', 'Compiler test developer'
);

insert into public.files (
  id, org_id, name, object_path, mime_type, size_bytes, status
) values
  ('40000000-0000-0000-0000-000000000127', '10000000-0000-0000-0000-000000000127',
   'ng28-test.pdf', 'database:compiler-0127', 'application/pdf', 3, 'processing'),
  ('70000000-0000-0000-0000-000000000127', '20000000-0000-0000-0000-000000000127',
   'other.pdf', 'database:compiler-other-0127', 'application/pdf', 3, 'processing');

insert into public.file_versions (
  id, org_id, file_id, version, mime_type, size_bytes, sha256, content
) values
  ('50000000-0000-0000-0000-000000000127', '10000000-0000-0000-0000-000000000127',
   '40000000-0000-0000-0000-000000000127', 1, 'application/pdf', 3,
   encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8')),
  ('80000000-0000-0000-0000-000000000127', '20000000-0000-0000-0000-000000000127',
   '70000000-0000-0000-0000-000000000127', 1, 'application/pdf', 3,
   encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8'));

insert into public.document_extractions (
  id, org_id, file_id, file_version_id, job_id, provider, provider_version,
  schema_version, source_sha256, warnings, raw_artifact
)
select
  '60000000-0000-0000-0000-000000000127', v.org_id, v.file_id, v.id, j.id,
  'docling-rs', '1.37.0', 'layout-v1', v.sha256, '[]'::jsonb, '{}'::jsonb
from public.file_versions v
join public.document_ingestion_jobs j on j.file_version_id = v.id
where v.id = '50000000-0000-0000-0000-000000000127';

insert into public.document_extractions (
  id, org_id, file_id, file_version_id, job_id, provider, provider_version,
  schema_version, source_sha256, warnings, raw_artifact
)
select
  '90000000-0000-0000-0000-000000000127', v.org_id, v.file_id, v.id, j.id,
  'docling-rs', '1.37.0', 'layout-v1', v.sha256, '[]'::jsonb, '{}'::jsonb
from public.file_versions v
join public.document_ingestion_jobs j on j.file_version_id = v.id
where v.id = '80000000-0000-0000-0000-000000000127';

update public.file_versions
set status = 'indexed', indexed_at = now(),
    active_extraction_id = case id
      when '50000000-0000-0000-0000-000000000127' then '60000000-0000-0000-0000-000000000127'::uuid
      else '90000000-0000-0000-0000-000000000127'::uuid end,
    intelligence = '{"recommendations":[{"compiler_id":"care_path","confidence":0.95,"reason":"longitudinal care"}]}'::jsonb
where id in (
  '50000000-0000-0000-0000-000000000127',
  '80000000-0000-0000-0000-000000000127'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000127', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_first jsonb;
  v_duplicate jsonb;
begin
  v_first := public.enqueue_compiler_run(
    '50000000-0000-0000-0000-000000000127',
    'care_path', 'care-path-v1', 'care-path-prompt-v1'
  );
  v_duplicate := public.enqueue_compiler_run(
    '50000000-0000-0000-0000-000000000127',
    'care_path', 'care-path-v1', 'care-path-prompt-v1'
  );
  if v_first ->> 'id' is distinct from v_duplicate ->> 'id'
     or v_first ->> 'status' <> 'queued'
     or v_first ->> 'file_version_id' <> '50000000-0000-0000-0000-000000000127'
     or v_first ->> 'extraction_id' <> '60000000-0000-0000-0000-000000000127'
     or coalesce(v_first ->> 'catalogue_digest', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'enqueue did not freeze and deduplicate compiler input';
  end if;

  begin
    perform public.enqueue_compiler_run(
      '80000000-0000-0000-0000-000000000127',
      'care_path', 'care-path-v1', 'care-path-prompt-v1'
    );
    raise exception 'another tenant document was accepted';
  exception when insufficient_privilege then
    null;
  end;

  if exists (
    select 1 from public.compiler_runs
    where org_id = '20000000-0000-0000-0000-000000000127'
  ) then
    raise exception 'another tenant compiler run was visible';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $$
declare
  v_claim jsonb;
  v_step jsonb;
begin
  v_claim := public.claim_compiler_run('compiler-a', 300);
  if v_claim is null
     or v_claim ->> 'lease_owner' <> 'compiler-a'
     or v_claim ->> 'status' <> 'planning'
     or (v_claim ->> 'attempt_count')::integer <> 1 then
    raise exception 'compiler worker could not claim queued work';
  end if;
  if public.claim_compiler_run('compiler-b', 300) is not null then
    raise exception 'two workers claimed one compiler run';
  end if;
  if not public.renew_compiler_run_lease((v_claim ->> 'id')::uuid, 'compiler-a', 300) then
    raise exception 'compiler lease could not be renewed by its owner';
  end if;

  v_step := public.append_compiler_step(
    (v_claim ->> 'id')::uuid, 'compiler-a',
    '{"kind":"plan","status":"completed","task_key":"document-map","input_refs":{},"result":{"selected_pages":[18,19]}}'::jsonb
  );
  if v_step ->> 'sequence' <> '1' then
    raise exception 'first compiler step did not receive sequence one';
  end if;
  v_step := public.append_compiler_step(
    (v_claim ->> 'id')::uuid, 'compiler-a',
    '{"kind":"retrieve","status":"completed","task_key":"hba1c","page_start":18,"page_end":24,"input_refs":{"chunk_ids":[]},"result":{}}'::jsonb
  );
  if v_step ->> 'sequence' <> '2' then
    raise exception 'compiler step sequence is not monotonic';
  end if;

  begin
    perform public.advance_compiler_run((v_claim ->> 'id')::uuid, 'wrong-worker', 'compiling');
    raise exception 'a wrong lease owner advanced compiler work';
  exception when sqlstate 'P0004' then
    null;
  end;

  perform public.advance_compiler_run((v_claim ->> 'id')::uuid, 'compiler-a', 'compiling');
  perform public.fail_compiler_run(
    (v_claim ->> 'id')::uuid, 'compiler-a', 'provider_busy', 'retry safely', true
  );
  if (select status from public.compiler_runs where id = (v_claim ->> 'id')::uuid) <> 'queued'
     or (select lease_owner from public.compiler_runs where id = (v_claim ->> 'id')::uuid) is not null then
    raise exception 'retryable compiler failure did not requeue cleanly';
  end if;

  update public.compiler_runs
     set available_at = now() - interval '1 second'
   where id = (v_claim ->> 'id')::uuid;
  v_claim := public.claim_compiler_run('compiler-b', 300);
  if v_claim ->> 'lease_owner' <> 'compiler-b'
     or (v_claim ->> 'attempt_count')::integer <> 2 then
    raise exception 'retryable compiler run was not reclaimable';
  end if;
  perform public.fail_compiler_run(
    (v_claim ->> 'id')::uuid, 'compiler-b', 'invalid_evidence', 'permanent failure', false
  );
  if (select status from public.compiler_runs where id = (v_claim ->> 'id')::uuid) <> 'failed' then
    raise exception 'permanent compiler failure was not terminal';
  end if;

  begin
    update public.compiler_steps set result = '{"rewritten":true}'::jsonb
     where run_id = (v_claim ->> 'id')::uuid and sequence = 1;
    raise exception 'compiler trace allowed an update';
  exception when sqlstate 'P0004' then
    null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_run jsonb;
  v_cancelled jsonb;
begin
  v_run := public.enqueue_compiler_run(
    '50000000-0000-0000-0000-000000000127',
    'care_path', 'care-path-v2', 'care-path-prompt-v1'
  );
  v_cancelled := public.cancel_compiler_run((v_run ->> 'id')::uuid);
  if v_cancelled ->> 'status' <> 'cancelled' then
    raise exception 'queued compiler run was not cancelled';
  end if;
end;
$$;

rollback;
