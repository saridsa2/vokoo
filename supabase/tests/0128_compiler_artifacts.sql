\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('public.compiler_artifacts') is null
     or to_regclass('public.compiler_evidence_links') is null then
    raise exception 'compiler artifact provenance is missing';
  end if;
end;
$$;

insert into public.organizations (id, name, slug)
values
  ('10000000-0000-0000-0000-000000000128', 'Compiler artifact test', 'compiler-artifact-0128'),
  ('20000000-0000-0000-0000-000000000128', 'Other artifact test', 'other-artifact-0128');

insert into public.files (id, org_id, name, object_path, mime_type, size_bytes, status)
values
  ('30000000-0000-0000-0000-000000000128', '10000000-0000-0000-0000-000000000128',
   'ng28-test.pdf', 'database:compiler-0128', 'application/pdf', 3, 'processing'),
  ('40000000-0000-0000-0000-000000000128', '20000000-0000-0000-0000-000000000128',
   'other.pdf', 'database:compiler-other-0128', 'application/pdf', 3, 'processing');

insert into public.file_versions (
  id, org_id, file_id, version, mime_type, size_bytes, sha256, content
) values
  ('50000000-0000-0000-0000-000000000128', '10000000-0000-0000-0000-000000000128',
   '30000000-0000-0000-0000-000000000128', 1, 'application/pdf', 3,
   encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8')),
  ('60000000-0000-0000-0000-000000000128', '20000000-0000-0000-0000-000000000128',
   '40000000-0000-0000-0000-000000000128', 1, 'application/pdf', 3,
   encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8'));

insert into public.document_extractions (
  id, org_id, file_id, file_version_id, job_id, provider, provider_version,
  schema_version, source_sha256, warnings, raw_artifact
)
select '70000000-0000-0000-0000-000000000128', v.org_id, v.file_id, v.id, j.id,
  'docling-rs', '1.37.0', 'layout-v1', v.sha256, '[]'::jsonb, '{}'::jsonb
from public.file_versions v
join public.document_ingestion_jobs j on j.file_version_id = v.id
where v.id = '50000000-0000-0000-0000-000000000128';

update public.file_versions set
  status = 'indexed', indexed_at = now(),
  active_extraction_id = '70000000-0000-0000-0000-000000000128'
where id = '50000000-0000-0000-0000-000000000128';

insert into public.document_chunks (
  id, org_id, file_id, file_version_id, chunker_version, ordinal,
  page_start, page_end, section_path, content, token_count, content_sha256
) values
  ('80000000-0000-0000-0000-000000000128', '10000000-0000-0000-0000-000000000128',
   '30000000-0000-0000-0000-000000000128', '50000000-0000-0000-0000-000000000128',
   'clinical-structure-v1', 0, 18, 18, array['Monitoring'],
   'Review HbA1c every three to six months until stable.', 9,
   encode(digest(convert_to('Review HbA1c every three to six months until stable.', 'utf8'), 'sha256'), 'hex')),
  ('90000000-0000-0000-0000-000000000128', '20000000-0000-0000-0000-000000000128',
   '40000000-0000-0000-0000-000000000128', '60000000-0000-0000-0000-000000000128',
   'clinical-structure-v1', 0, 1, 1, array['Other'], 'Other tenant evidence.', 3,
   encode(digest(convert_to('Other tenant evidence.', 'utf8'), 'sha256'), 'hex'));

with catalogue as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id, 'node_type', node_type, 'families', families,
      'outcomes', outcomes, 'fields', fields, 'outcomes_from', outcomes_from,
      'output', output, 'suspends', suspends
    ) order by id
  ), '[]'::jsonb) as snapshot
  from public.catalogue_node_types
  where is_active and 'care_path' = any(families)
), runs(id, compiler_version, worker) as (
  values
    ('a0000000-0000-0000-0000-000000000128'::uuid, 'care-path-v1'::text, 'compiler-a'::text),
    ('b0000000-0000-0000-0000-000000000128'::uuid, 'care-path-v2'::text, 'compiler-b'::text),
    ('c0000000-0000-0000-0000-000000000128'::uuid, 'care-path-v3'::text, 'compiler-c'::text),
    ('d0000000-0000-0000-0000-000000000128'::uuid, 'care-path-v4'::text, 'compiler-d'::text),
    ('e0000000-0000-0000-0000-000000000128'::uuid, 'care-path-v5'::text, 'compiler-e'::text)
)
insert into public.compiler_runs (
  id, org_id, file_id, file_version_id, extraction_id, compiler_id, status,
  provider, model, compiler_version, prompt_version, catalogue_digest,
  input_snapshot, attempt_count, lease_owner, lease_expires_at, started_at
)
select r.id, '10000000-0000-0000-0000-000000000128',
  '30000000-0000-0000-0000-000000000128', '50000000-0000-0000-0000-000000000128',
  '70000000-0000-0000-0000-000000000128', 'care_path', 'materializing',
  'minimax', 'MiniMax-M3', r.compiler_version, 'care-path-prompt-v1',
  encode(extensions.digest(convert_to(c.snapshot::text, 'utf8'), 'sha256'), 'hex'),
  jsonb_build_object('catalogue', c.snapshot, 'resources', '{}'::jsonb),
  1, r.worker, now() + interval '5 minutes', now()
from runs r cross join catalogue c;

do $$
declare
  v_result jsonb;
  v_repeat jsonb;
  v_agent uuid;
  v_flow uuid;
begin
  v_result := public.materialize_care_path_compilation(
    'a0000000-0000-0000-0000-000000000128', 'compiler-a',
    '[{"key":"hba1c-agent","name":"HbA1c follow-up","system_prompt":"Ask only the cited monitoring questions.","first_message":"Hello."}]',
    '[{"key":"hba1c-path","name":"HbA1c monitoring","description":"Cited monitoring pathway","trigger_event":"care_path.recurring","graph":{"version":3,"nodes":[{"id":"recurring","type":"trigger","implementation":"trigger.recurring","config":{"key":"hba1c","anchor":"enrolment","every_days":90}},{"id":"request","type":"custom","implementation":"outreach.request","config":{"what":"test","instructions":"Complete an HbA1c test.","expires_days":7}},{"id":"conversation","type":"custom","implementation":"agent","agent_key":"hba1c-agent","config":{}},{"id":"escalate","type":"custom","implementation":"escalate.notify","config":{"to":"primary_team","urgency":"soon","note":"Review incomplete HbA1c outreach."}}],"transitions":[{"id":"start-request","from":"recurring","outcome":"due","to":"request"},{"id":"fulfilled","from":"request","outcome":"fulfilled","to":"conversation"},{"id":"declined","from":"request","outcome":"declined","to":"escalate"},{"id":"expired","from":"request","outcome":"expired","to":"escalate"},{"id":"failed","from":"request","outcome":"failed","to":"escalate"}]}}]',
    '[{"code":"missing_capability","severity":"warning","recommendation_id":"NG28-1.6.1","explanation":"No laboratory ordering component.","missing_capability":"laboratory.order","evidence":[{"chunk_id":"80000000-0000-0000-0000-000000000128"}]}]',
    '[{"artifact_key":"hba1c-agent","target_path":"agent.system_prompt.monitoring","chunk_id":"80000000-0000-0000-0000-000000000128","excerpt":"Review HbA1c every three to six months until stable.","recommendation_id":"NG28-1.6.1","role":"timing"},{"artifact_key":"hba1c-path","target_path":"flow.nodes.request","chunk_id":"80000000-0000-0000-0000-000000000128","excerpt":"Review HbA1c every three to six months until stable.","recommendation_id":"NG28-1.6.1","role":"requirement"}]'
  );
  v_agent := (v_result->'agents'->0->>'id')::uuid;
  v_flow := (v_result->'flows'->0->>'id')::uuid;
  if v_result->>'status' <> 'completed_with_gaps'
     or (select status from public.agents where id = v_agent) <> 'draft'
     or (select status from public.flows where id = v_flow) <> 'draft'
     or (select graph #>> '{nodes,2,config,agent_id}' from public.flows where id = v_flow) <> v_agent::text
     or (select graph #> '{nodes,2}' ? 'agent_key' from public.flows where id = v_flow) then
    raise exception 'drafts were not materialized and linked correctly';
  end if;
  if (select count(*) from public.compiler_artifacts where run_id = 'a0000000-0000-0000-0000-000000000128') <> 2
     or (select count(*) from public.compiler_evidence_links where run_id = 'a0000000-0000-0000-0000-000000000128') <> 2
     or (select count(*) from public.compiler_gaps where run_id = 'a0000000-0000-0000-0000-000000000128') <> 1 then
    raise exception 'artifact provenance, evidence, or gaps were lost';
  end if;

  v_repeat := public.materialize_care_path_compilation(
    'a0000000-0000-0000-0000-000000000128', 'compiler-a', '[]', '[]', '[]', '[]'
  );
  if v_repeat->'agents'->0->>'id' <> v_agent::text
     or v_repeat->'flows'->0->>'id' <> v_flow::text
     or (select count(*) from public.compiler_artifacts where run_id = 'a0000000-0000-0000-0000-000000000128') <> 2 then
    raise exception 'materialization retry duplicated or changed artifacts';
  end if;

  delete from public.agents where id = v_agent;
  if not exists (
    select 1 from public.compiler_artifacts
     where run_id = 'a0000000-0000-0000-0000-000000000128'
       and stable_key = 'hba1c-agent' and agent_id is null
  ) or (select count(*) from public.compiler_evidence_links where run_id = 'a0000000-0000-0000-0000-000000000128') <> 2 then
    raise exception 'deleting a draft erased its compiler origin or evidence';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.materialize_care_path_compilation(
      'b0000000-0000-0000-0000-000000000128', 'compiler-b',
      '[{"key":"unsafe-agent","name":"Unsafe","system_prompt":"Unsafe","first_message":"Hello."}]',
      '[{"key":"unsafe-flow","name":"Unsafe","trigger_event":"care_path.due","graph":{"version":3,"nodes":[{"id":"due","type":"trigger","implementation":"trigger.due","config":{"key":"review","anchor":"enrolment","offset_days":0,"window_days":1}},{"id":"set","type":"var","implementation":"var","config":{"name":"reviewed","value":"true"}}],"transitions":[{"id":"start","from":"due","outcome":"due","to":"set"}]}}]',
      '[]',
      '[{"artifact_key":"unsafe-agent","target_path":"agent.system_prompt","chunk_id":"90000000-0000-0000-0000-000000000128","excerpt":"Other tenant evidence.","recommendation_id":"X","role":"requirement"}]'
    );
    raise exception 'foreign evidence was accepted';
  exception when sqlstate 'P0004' then
    null;
  end;
  if exists (select 1 from public.agents where name = 'Unsafe')
     or exists (select 1 from public.flows where name = 'Unsafe')
     or exists (select 1 from public.compiler_artifacts where run_id = 'b0000000-0000-0000-0000-000000000128') then
    raise exception 'failed materialization left partial artifacts';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.materialize_care_path_compilation(
      'c0000000-0000-0000-0000-000000000128', 'compiler-c', '[]',
      '[{"key":"missing-agent-flow","name":"Missing agent","trigger_event":"care_path.due","graph":{"version":3,"nodes":[{"id":"due","type":"trigger","implementation":"trigger.due","config":{"key":"review","anchor":"enrolment","offset_days":0,"window_days":1}},{"id":"conversation","type":"custom","implementation":"agent","agent_key":"does-not-exist","config":{}}],"transitions":[{"id":"start","from":"due","outcome":"due","to":"conversation"}]}}]',
      '[]', '[]'
    );
    raise exception 'unknown agent key was accepted';
  exception when sqlstate 'P0004' then null;
  end;
  if exists (select 1 from public.compiler_artifacts where run_id = 'c0000000-0000-0000-0000-000000000128') then
    raise exception 'unknown agent key left partial artifacts';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.materialize_care_path_compilation(
      'd0000000-0000-0000-0000-000000000128', 'compiler-d',
      '[{"key":"duplicate","name":"First","system_prompt":"First"},{"key":"duplicate","name":"Second","system_prompt":"Second"}]',
      '[]', '[]', '[]'
    );
    raise exception 'duplicate artifact key was accepted';
  exception when sqlstate 'P0004' then null;
  end;
  if exists (select 1 from public.agents where name in ('First','Second'))
     or exists (select 1 from public.compiler_artifacts where run_id = 'd0000000-0000-0000-0000-000000000128') then
    raise exception 'duplicate key left partial artifacts';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.materialize_care_path_compilation(
      'e0000000-0000-0000-0000-000000000128', 'compiler-e', '[]',
      '[{"key":"malformed","name":"Malformed","trigger_event":"care_path.document","graph":{"version":3,"nodes":[],"transitions":[]}}]',
      '[]', '[]'
    );
    raise exception 'malformed graph was accepted';
  exception when sqlstate 'P0004' then null;
  end;
  if exists (select 1 from public.flows where name = 'Malformed')
     or exists (select 1 from public.compiler_artifacts where run_id = 'e0000000-0000-0000-0000-000000000128') then
    raise exception 'malformed graph left partial artifacts';
  end if;
end;
$$;

rollback;
