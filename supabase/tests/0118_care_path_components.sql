\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org        uuid := '10000000-0000-0000-0000-000000000116';
  v_flow       uuid := '20000000-0000-0000-0000-000000000116';
  v_cohort     uuid := '30000000-0000-0000-0000-000000000116';
  v_patient    uuid := '40000000-0000-0000-0000-000000000116';
  v_enrolment  uuid := '50000000-0000-0000-0000-000000000116';
  v_milestone  jsonb;
  v_observation jsonb;
  v_document    jsonb;
  v_outreach    jsonb;
  v_escalation jsonb;
  v_rejected   boolean := false;
begin
  if (select count(*) from public.catalogue_node_types
       where id in (
         'trigger.due','trigger.recurring','trigger.reported','trigger.document',
         'outreach.call','outreach.message','outreach.request',
         'care_path.record','care_path.complete','escalate.notify'
       ) and is_active and is_addable and 'care_path' = any(families)) <> 10 then
    raise exception 'the first-class care-path component set is incomplete';
  end if;

  perform public.validate_flow(
    '{
      "version":3,
      "nodes":[
        {"id":"midwife","type":"trigger","implementation":"trigger.due","config":{"key":"midwife-contact","anchor":"transfer_of_care","offset_days":0,"window_days":1}},
        {"id":"daily","type":"trigger","implementation":"trigger.recurring","config":{"key":"daily-check","anchor":"enrolment","every_days":1}},
        {"id":"red-flag","type":"trigger","implementation":"trigger.reported","config":{"key":"maternal-red-flags","watch":[{"id":"heavy_bleeding","label":"Heavy bleeding"}]}},
        {"id":"lab","type":"trigger","implementation":"trigger.document","config":{"key":"postnatal-lab","document_kind":"lab_report"}},
        {"id":"notify","type":"custom","implementation":"escalate.notify","config":{"to":"on_call","urgency":"immediate","note":"Postnatal red flag"}}
      ],
      "transitions":[{"id":"red-notify","from":"red-flag","outcome":"heavy_bleeding","to":"notify"}],
      "variables":[]
    }'::jsonb,
    'care_path',
    null
  );

  insert into public.organizations (id, name, slug)
  values (v_org, 'Care path component test', 'care-path-components-0116');

  insert into public.flows (
    id, org_id, name, description, status, graph, config,
    trigger_event, channel, family, published_at
  ) values (
    v_flow, v_org, 'NG194 postnatal care', '', 'published',
    '{
      "version":3,
      "nodes":[
        {"id":"midwife","type":"trigger","implementation":"trigger.due","config":{"key":"midwife-contact","anchor":"transfer_of_care","offset_days":0,"window_days":1}},
        {"id":"daily","type":"trigger","implementation":"trigger.recurring","config":{"key":"daily-check","anchor":"enrolment","every_days":1}},
        {"id":"red-flag","type":"trigger","implementation":"trigger.reported","config":{"key":"maternal-red-flags","watch":[{"id":"heavy_bleeding","label":"Heavy bleeding"}]}},
        {"id":"lab","type":"trigger","implementation":"trigger.document","config":{"key":"postnatal-lab","document_kind":"lab_report"}},
        {"id":"notify","type":"custom","implementation":"escalate.notify","config":{"to":"on_call","urgency":"immediate","note":"Postnatal red flag"}}
      ],
      "transitions":[{"id":"red-notify","from":"red-flag","outcome":"heavy_bleeding","to":"notify"}],
      "variables":[]
    }'::jsonb,
    '{}', 'care_path.due', 'voice', 'care_path', now()
  );
  insert into public.flow_versions (org_id, flow_id, version, snapshot)
  select org_id, id, 1, to_jsonb(f) from public.flows f where id = v_flow;

  insert into public.cohorts (id, org_id, name, flow_id, status)
  values (v_cohort, v_org, 'Postnatal', v_flow, 'running');
  insert into public.patients (id, org_id, full_name, phone)
  values (v_patient, v_org, 'Test patient', '+919999999116');
  insert into public.cohort_patients (id, org_id, cohort_id, patient_id, started_on)
  values (v_enrolment, v_org, v_cohort, v_patient, current_date - 2);

  perform public.set_care_path_anchor(
    v_enrolment, 'transfer_of_care', now() - interval '2 days', '{}'
  );
  perform public.sweep_care_path_events(now());

  if not exists (
    select 1 from public.care_path_milestones
     where cohort_patient_id = v_enrolment
       and milestone_key = 'midwife-contact'
       and status = 'overdue'
  ) then
    raise exception 'the due trigger did not create and age its patient milestone';
  end if;
  if not exists (
    select 1 from public.care_path_runs
     where cohort_patient_id = v_enrolment
       and flow_id = v_flow and flow_version = 1
       and trigger_node_id = 'midwife' and trigger_implementation = 'trigger.due'
       and status = 'queued'
  ) then
    raise exception 'the due trigger did not enqueue a version-pinned run';
  end if;
  if not exists (
    select 1 from public.care_path_runs
     where cohort_patient_id = v_enrolment
       and trigger_node_id = 'daily'
       and trigger_implementation = 'trigger.recurring'
  ) then
    raise exception 'the recurring trigger did not enqueue an occurrence';
  end if;

  v_observation := public.record_care_path_observation(
    v_enrolment, 'heavy_bleeding', '{"reported":true}', 'patient'
  );
  if coalesce(v_observation->>'id', '') = '' or not exists (
    select 1 from public.care_path_runs
     where cohort_patient_id = v_enrolment
       and trigger_node_id = 'red-flag'
       and trigger_implementation = 'trigger.reported'
       and trigger_outcome = 'heavy_bleeding'
  ) then
    raise exception 'a reported observation did not enter the matching trigger';
  end if;

  v_document := public.record_care_path_document(
    v_enrolment, 'lab_report', 'file-0116', '{"source":"patient"}'
  );
  if coalesce(v_document->>'id', '') = '' or not exists (
    select 1 from public.care_path_runs
     where cohort_patient_id = v_enrolment
       and trigger_node_id = 'lab'
       and trigger_implementation = 'trigger.document'
       and trigger_outcome = 'received'
  ) then
    raise exception 'a document did not enter the matching document trigger';
  end if;

  v_outreach := public.enqueue_care_path_outreach(
    v_enrolment, null, 'request', 'Attend the first midwife contact',
    now() + interval '1 day', '{"milestone_key":"midwife-contact"}'
  );
  if coalesce(v_outreach->>'status', '') <> 'pending' then
    raise exception 'the outreach handler did not create pending work';
  end if;
  perform public.resolve_care_path_outreach(
    (v_outreach->>'id')::uuid, 'fulfilled', '{"attended":true}'
  );
  if not exists (
    select 1 from public.care_path_outreach
     where id = (v_outreach->>'id')::uuid
       and status = 'fulfilled' and resolved_at is not null
  ) then
    raise exception 'outreach resolution did not persist its terminal outcome';
  end if;

  select to_jsonb(m) into v_milestone from public.care_path_milestones m
   where cohort_patient_id = v_enrolment and milestone_key = 'midwife-contact';
  perform public.complete_care_path_milestone(
    v_enrolment, 'midwife-contact', '{"attended":true}'
  );
  if not exists (
    select 1 from public.care_path_milestones
     where id = (v_milestone->>'id')::uuid and status = 'completed' and completed_at is not null
  ) then
    raise exception 'the completion handler did not complete the milestone';
  end if;

  v_escalation := public.notify_care_path_escalation(
    v_enrolment, (v_milestone->>'id')::uuid, 'on_call', 'immediate',
    'Postnatal red flag', '{"observation":"heavy_bleeding"}'
  );
  if coalesce(v_escalation->>'status', '') <> 'open' then
    raise exception 'the escalation handler did not create trackable open work';
  end if;

  begin
    insert into public.flows (
      id, org_id, name, description, status, graph, config,
      trigger_event, channel, family
    ) values (
      '21000000-0000-0000-0000-000000000116', v_org, 'Not a path', '', 'draft',
      '{"version":3,"nodes":[{"id":"answered","type":"trigger","implementation":"trigger.call_answered","config":{}}],"transitions":[],"variables":[]}',
      '{}', 'call.answered', 'voice', 'call'
    );
    insert into public.cohorts (
      id, org_id, name, flow_id, status
    ) values (
      '31000000-0000-0000-0000-000000000116', v_org, 'Invalid cohort',
      '21000000-0000-0000-0000-000000000116', 'draft'
    );
  exception when sqlstate '23514' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'a cohort accepted a flow outside the care_path family';
  end if;
end;
$$;

rollback;
