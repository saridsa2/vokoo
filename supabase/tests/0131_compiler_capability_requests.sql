\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('public.capability_requests') is null
     or to_regclass('public.compiler_capability_adapters') is null
     or to_regclass('public.compiler_capability_resolutions') is null then
    raise exception 'compiler capability ledger is missing';
  end if;
end;
$$;

insert into public.organizations (id, name, slug)
values
  ('10000000-0000-0000-0000-000000000131', 'Capability request test', 'capability-request-0131'),
  ('20000000-0000-0000-0000-000000000131', 'Other capability test', 'other-capability-0131');

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('30000000-0000-0000-0000-000000000131', 'authenticated', 'authenticated',
   'capability-member@example.test', now(), '{"provider":"email"}', '{}', now(), now()),
  ('40000000-0000-0000-0000-000000000131', 'authenticated', 'authenticated',
   'capability-operator@example.test', now(), '{"provider":"email"}', '{}', now(), now()),
  ('50000000-0000-0000-0000-000000000131', 'authenticated', 'authenticated',
   'capability-other@example.test', now(), '{"provider":"email"}', '{}', now(), now());

insert into public.memberships (org_id, user_id, role, display_name)
values
  ('10000000-0000-0000-0000-000000000131', '30000000-0000-0000-0000-000000000131', 'developer', 'Workspace member'),
  ('20000000-0000-0000-0000-000000000131', '50000000-0000-0000-0000-000000000131', 'developer', 'Other member');

insert into public.platform_admins (user_id, note)
values ('40000000-0000-0000-0000-000000000131', '0131 test operator');

insert into public.files (id, org_id, name, object_path, mime_type, size_bytes, status)
values ('60000000-0000-0000-0000-000000000131', '10000000-0000-0000-0000-000000000131',
        'hlt.pdf', 'database:capability-0131', 'application/pdf', 3, 'processing');

insert into public.file_versions (id, org_id, file_id, version, mime_type, size_bytes, sha256, content)
values ('70000000-0000-0000-0000-000000000131', '10000000-0000-0000-0000-000000000131',
        '60000000-0000-0000-0000-000000000131', 1, 'application/pdf', 3,
        encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8'));

insert into public.document_extractions (
  id, org_id, file_id, file_version_id, job_id, provider, provider_version,
  schema_version, source_sha256, warnings, raw_artifact
)
select '80000000-0000-0000-0000-000000000131', v.org_id, v.file_id, v.id, j.id,
       'docling-rs', '1.37.0', 'layout-v1', v.sha256, '[]', '{}'
from public.file_versions v
join public.document_ingestion_jobs j on j.file_version_id = v.id
where v.id = '70000000-0000-0000-0000-000000000131';

update public.file_versions
set status = 'indexed', indexed_at = now(),
    active_extraction_id = '80000000-0000-0000-0000-000000000131',
    intelligence = '{"recommendations":[{"compiler_id":"care_path","confidence":1,"reason":"follow-up pathway"}]}'
where id = '70000000-0000-0000-0000-000000000131';

with catalogue as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'node_type', node_type, 'families', families, 'outcomes', outcomes,
    'fields', fields, 'outcomes_from', outcomes_from, 'output', output, 'suspends', suspends
  ) order by id), '[]'::jsonb) snapshot
  from public.catalogue_node_types where is_active and 'care_path' = any(families)
)
insert into public.compiler_runs (
  id, org_id, file_id, file_version_id, extraction_id, compiler_id, status,
  provider, model, compiler_version, prompt_version, catalogue_digest,
  input_snapshot, attempt_count, completed_at
)
select '90000000-0000-0000-0000-000000000131',
       '10000000-0000-0000-0000-000000000131',
       '60000000-0000-0000-0000-000000000131',
       '70000000-0000-0000-0000-000000000131',
       '80000000-0000-0000-0000-000000000131',
       'care_path', 'completed_with_gaps', 'minimax', 'MiniMax-M3',
       'care-path-v1', 'care-path-prompt-v1',
       encode(extensions.digest(convert_to(snapshot::text, 'utf8'), 'sha256'), 'hex'),
       jsonb_build_object('catalogue', snapshot, 'resources', '{}'::jsonb), 1, now()
from catalogue;

insert into public.compiler_gaps (
  id, org_id, run_id, code, severity, recommendation_id, explanation,
  missing_capability, details, evidence
) values
  ('a0000000-0000-0000-0000-000000000131', '10000000-0000-0000-0000-000000000131',
   '90000000-0000-0000-0000-000000000131', 'unsupported_action_actor', 'blocking', 'HLT-1',
   'Clinician work cannot be represented.', 'clinical.task',
   '{"actor":"clinician","action_key":"review-result","what":"Review the result","instructions":"Review the cited result and decide follow-up.","expires_days":7}', '[]'),
  ('b0000000-0000-0000-0000-000000000131', '10000000-0000-0000-0000-000000000131',
   '90000000-0000-0000-0000-000000000131', 'threshold_requires_mapping', 'blocking', 'HLT-2',
   'Legacy threshold has no typed contract.', 'clinical.threshold_mapping', '{}', '[]'),
  ('c0000000-0000-0000-0000-000000000131', '10000000-0000-0000-0000-000000000131',
   '90000000-0000-0000-0000-000000000131', 'invented_gap', 'blocking', 'HLT-3',
   'Unknown gap.', 'invented.capability', '{"value":1}', '[]');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000131', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare v_first jsonb; v_second jsonb;
begin
  v_first := public.request_compiler_capability(
    'a0000000-0000-0000-0000-000000000131', 'Needed for transplant follow-up'
  );
  v_second := public.request_compiler_capability(
    'a0000000-0000-0000-0000-000000000131', 'Repeated submission'
  );
  if v_first->>'id' is distinct from v_second->>'id'
     or v_first->>'capability_key' <> 'clinical.task' then
    raise exception 'capability request was not idempotent';
  end if;

  begin
    perform public.request_compiler_capability('b0000000-0000-0000-0000-000000000131', null);
    raise exception 'legacy empty details were requestable';
  exception when sqlstate 'P0004' then null;
  end;
  begin
    perform public.request_compiler_capability('c0000000-0000-0000-0000-000000000131', null);
    raise exception 'unknown gap code was requestable';
  exception when sqlstate 'P0004' then null;
  end;
  begin
    perform public.resolve_compiler_capability_request(
      (v_first->>'id')::uuid, 'existing_component', 'clinical-task-escalate-notify-v1',
      'escalate.notify', '{"to":"clinician","urgency":"routine"}', 'Use the existing care-team notification.'
    );
    raise exception 'workspace member resolved a capability';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config(
  'test.capability_request_id',
  (select id::text from public.capability_requests
    where gap_id = 'a0000000-0000-0000-0000-000000000131'),
  true
);
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000131', true);
set local role authenticated;

do $$
declare v_request uuid; v_resolution jsonb;
begin
  v_request := current_setting('test.capability_request_id')::uuid;
  begin
    perform public.resolve_compiler_capability_request(
      v_request, 'existing_component', 'clinical-task-escalate-notify-v1',
      'care_path.record', '{"to":"clinician","urgency":"routine"}', 'Use existing.'
    );
    raise exception 'incompatible node resolved a capability';
  exception when sqlstate 'P0004' then null;
  end;

  v_resolution := public.resolve_compiler_capability_request(
    v_request, 'existing_component', 'clinical-task-escalate-notify-v1',
    'escalate.notify', '{"to":"clinician","urgency":"routine"}',
    'Use Notify care team for clinician work.'
  );
  if v_resolution->>'status' <> 'active' then
    raise exception 'operator resolution was not activated';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000131', true);
set local role authenticated;

do $$
declare v_child jsonb;
begin
  v_child := public.enqueue_compiler_recompile('90000000-0000-0000-0000-000000000131');
  if v_child->>'parent_run_id' <> '90000000-0000-0000-0000-000000000131'
     or coalesce(v_child->>'resolution_digest', '') !~ '^[0-9a-f]{64}$'
     or jsonb_array_length(v_child#>'{input_snapshot,resolutions}') <> 1
     or v_child#>>'{input_snapshot,resolutions,0,recommendation_id}' <> 'HLT-1' then
    raise exception 'recompile did not freeze the active resolution';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000131', true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.capability_requests)
     or exists (select 1 from public.compiler_runs where parent_run_id is not null) then
    raise exception 'another organization could read capability request state';
  end if;
end;
$$;

rollback;
