\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regprocedure('public.validate_compiled_care_path(uuid,jsonb)') is null then
    raise exception 'compiled care-path validator is missing';
  end if;
end;
$$;

create function pg_temp.expect_compiled_rejection(
  p_org_id uuid,
  p_graph jsonb,
  p_label text
)
returns void language plpgsql as $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.validate_compiled_care_path(p_org_id, p_graph);
  exception when sqlstate 'P0004' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception '% was accepted', p_label;
  end if;
end;
$$;

do $$
declare
  v_org uuid := '10000000-0000-0000-0000-000000000129';
  v_valid jsonb;
  v_graph jsonb;
begin
  v_valid := '{
    "version":3,
    "nodes":[
      {"id":"schedule","type":"trigger","implementation":"trigger.recurring","config":{"key":"hba1c","anchor":"enrolment","every_days":90}},
      {"id":"request","type":"custom","implementation":"outreach.request","config":{"what":"test","instructions":"Complete an HbA1c test.","expires_days":7}},
      {"id":"complete","type":"custom","implementation":"care_path.complete","config":{"milestone_key":"hba1c"}},
      {"id":"escalate","type":"custom","implementation":"escalate.notify","config":{"to":"primary_team","urgency":"soon","note":"Review the incomplete HbA1c request."}}
    ],
    "transitions":[
      {"id":"scheduled","from":"schedule","outcome":"due","to":"request"},
      {"id":"fulfilled","from":"request","outcome":"fulfilled","to":"complete"},
      {"id":"declined","from":"request","outcome":"declined","to":"escalate"},
      {"id":"expired","from":"request","outcome":"expired","to":"escalate"},
      {"id":"request-failed","from":"request","outcome":"failed","to":"escalate"},
      {"id":"not-found","from":"complete","outcome":"not_found","to":"escalate"},
      {"id":"complete-failed","from":"complete","outcome":"failed","to":"escalate"}
    ]
  }'::jsonb;
  perform public.validate_compiled_care_path(v_org, v_valid);

  v_graph := jsonb_set(
    v_valid, '{nodes,1,implementation}', '"invented.clinical_action"'::jsonb
  );
  perform pg_temp.expect_compiled_rejection(v_org, v_graph, 'invented component');

  v_graph := jsonb_set(v_valid, '{transitions,1,outcome}', '"invented"'::jsonb);
  perform pg_temp.expect_compiled_rejection(v_org, v_graph, 'invalid source outcome');

  v_graph := jsonb_set(
    v_valid, '{nodes}',
    (v_valid->'nodes') || '[{"id":"orphan","type":"var","implementation":"var","config":{"name":"unused","value":"never"}}]'::jsonb
  );
  perform pg_temp.expect_compiled_rejection(v_org, v_graph, 'unreachable node');

  v_graph := '{
    "version":3,
    "nodes":[
      {"id":"due","type":"trigger","implementation":"trigger.due","config":{"key":"review","anchor":"enrolment","offset_days":0,"window_days":1}},
      {"id":"cycle","type":"condition","implementation":"condition","config":{"expression":"true"}}
    ],
    "transitions":[
      {"id":"start","from":"due","outcome":"due","to":"cycle"},
      {"id":"true","from":"cycle","outcome":"true","to":"cycle"},
      {"id":"false","from":"cycle","outcome":"false","to":"cycle"}
    ]
  }'::jsonb;
  perform pg_temp.expect_compiled_rejection(v_org, v_graph, 'closed cycle');

  v_graph := jsonb_set(
    v_valid, '{transitions}',
    (select jsonb_agg(t) from jsonb_array_elements(v_valid->'transitions') t
      where not (t->>'from' = 'request' and t->>'outcome' = 'expired'))
  );
  perform pg_temp.expect_compiled_rejection(v_org, v_graph, 'silent outreach expiry');

  v_graph := jsonb_set(v_valid, '{nodes,3,config,to}', '"unknown_team"'::jsonb);
  perform pg_temp.expect_compiled_rejection(v_org, v_graph, 'invalid select option');

  v_graph := v_valid #- '{nodes,1,config,instructions}';
  perform pg_temp.expect_compiled_rejection(v_org, v_graph, 'missing required field');

  v_graph := '{
    "version":3,
    "nodes":[
      {"id":"reported","type":"trigger","implementation":"trigger.reported","config":{"key":"symptoms","watch":["headache"]}},
      {"id":"escalate","type":"custom","implementation":"escalate.notify","config":{"to":"on_call","urgency":"urgent","note":"Assess reported symptom."}}
    ],
    "transitions":[{"id":"headache","from":"reported","outcome":"headache","to":"escalate"}]
  }'::jsonb;
  perform public.validate_compiled_care_path(v_org, v_graph);
end;
$$;

insert into public.organizations (id, name, slug)
values ('10000000-0000-0000-0000-000000000129', 'Compiled publish test', 'compiled-publish-0129');

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '20000000-0000-0000-0000-000000000129', 'authenticated', 'authenticated',
  'compiled-publish-0129@example.test', now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.memberships (org_id, user_id, role, display_name)
values (
  '10000000-0000-0000-0000-000000000129',
  '20000000-0000-0000-0000-000000000129',
  'developer', 'Compiled publish developer'
);

insert into public.files (id, org_id, name, object_path, mime_type, size_bytes, status)
values (
  '30000000-0000-0000-0000-000000000129',
  '10000000-0000-0000-0000-000000000129',
  'compiler-source.pdf', 'database:compiler-0129', 'application/pdf', 3, 'processing'
);

insert into public.file_versions (
  id, org_id, file_id, version, mime_type, size_bytes, sha256, content
) values (
  '40000000-0000-0000-0000-000000000129',
  '10000000-0000-0000-0000-000000000129',
  '30000000-0000-0000-0000-000000000129', 1, 'application/pdf', 3,
  encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8')
);

insert into public.document_extractions (
  id, org_id, file_id, file_version_id, job_id, provider, provider_version,
  schema_version, source_sha256, warnings, raw_artifact
)
select '50000000-0000-0000-0000-000000000129', v.org_id, v.file_id, v.id, j.id,
  'docling-rs', '1.37.0', 'layout-v1', v.sha256, '[]'::jsonb, '{}'::jsonb
from public.file_versions v
join public.document_ingestion_jobs j on j.file_version_id = v.id
where v.id = '40000000-0000-0000-0000-000000000129';

insert into public.compiler_runs (
  id, org_id, file_id, file_version_id, extraction_id, compiler_id, status,
  provider, model, compiler_version, prompt_version, catalogue_digest, input_snapshot
) values (
  '60000000-0000-0000-0000-000000000129',
  '10000000-0000-0000-0000-000000000129',
  '30000000-0000-0000-0000-000000000129',
  '40000000-0000-0000-0000-000000000129',
  '50000000-0000-0000-0000-000000000129',
  'care_path', 'completed', 'minimax', 'MiniMax-M3', 'care-path-v1',
  'care-path-prompt-v1', repeat('a', 64), '{}'::jsonb
);

insert into public.flows (
  id, org_id, name, description, status, graph, config, trigger_event, channel, family
) values
(
  '70000000-0000-0000-0000-000000000129',
  '10000000-0000-0000-0000-000000000129', 'Compiled draft', '', 'draft',
  '{"version":3,"nodes":[{"id":"schedule","type":"trigger","implementation":"trigger.recurring","config":{"key":"hba1c","anchor":"enrolment","every_days":90}},{"id":"request","type":"custom","implementation":"outreach.request","config":{"what":"test","instructions":"Complete an HbA1c test.","expires_days":7}},{"id":"complete","type":"custom","implementation":"care_path.complete","config":{"milestone_key":"hba1c"}},{"id":"escalate","type":"custom","implementation":"escalate.notify","config":{"to":"primary_team","urgency":"soon","note":"Review the incomplete request."}}],"transitions":[{"id":"scheduled","from":"schedule","outcome":"due","to":"request"},{"id":"fulfilled","from":"request","outcome":"fulfilled","to":"complete"},{"id":"declined","from":"request","outcome":"declined","to":"escalate"},{"id":"expired","from":"request","outcome":"expired","to":"escalate"},{"id":"request-failed","from":"request","outcome":"failed","to":"escalate"},{"id":"not-found","from":"complete","outcome":"not_found","to":"escalate"},{"id":"complete-failed","from":"complete","outcome":"failed","to":"escalate"}]}'::jsonb,
  '{}', 'care_path.recurring', 'voice', 'care_path'
),
(
  '80000000-0000-0000-0000-000000000129',
  '10000000-0000-0000-0000-000000000129', 'Hand-authored draft', '', 'draft',
  '{"version":3,"nodes":[{"id":"schedule","type":"trigger","implementation":"trigger.recurring","config":{"key":"manual","anchor":"enrolment","every_days":90}},{"id":"request","type":"custom","implementation":"outreach.request","config":{"what":"test","instructions":"Complete a test.","expires_days":7}}],"transitions":[{"id":"scheduled","from":"schedule","outcome":"due","to":"request"}]}'::jsonb,
  '{}', 'care_path.recurring', 'voice', 'care_path'
);

insert into public.compiler_artifacts (
  org_id, run_id, artifact_type, stable_key, role, flow_id
) values (
  '10000000-0000-0000-0000-000000000129',
  '60000000-0000-0000-0000-000000000129',
  'flow', 'compiled-draft', 'care_path', '70000000-0000-0000-0000-000000000129'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000129', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_unsafe jsonb;
  v_rejected boolean := false;
begin
  select jsonb_set(
    graph, '{transitions}',
    (select jsonb_agg(t) from jsonb_array_elements(graph->'transitions') t
      where not (t->>'from' = 'request' and t->>'outcome' = 'expired'))
  ) into v_unsafe
  from public.flows where id = '70000000-0000-0000-0000-000000000129';
  begin
    perform public.publish_flow('70000000-0000-0000-0000-000000000129', v_unsafe);
  exception when sqlstate 'P0004' then
    v_rejected := true;
  end;
  if not v_rejected
     or (select status from public.flows where id = '70000000-0000-0000-0000-000000000129') <> 'draft' then
    raise exception 'publish did not recheck compiler-origin safety';
  end if;

  perform public.publish_flow('80000000-0000-0000-0000-000000000129', null);
  if (select status from public.flows where id = '80000000-0000-0000-0000-000000000129') <> 'published' then
    raise exception 'compiler safety changed hand-authored publish behavior';
  end if;
end;
$$;

rollback;
