-- First-class care-path components and their patient-scoped runtime state.
--
-- A care path is still a flow. What makes it longitudinal is that its trigger
-- nodes enter against one cohort enrolment, and every due date, observation,
-- document, outreach and escalation remains a row after the flow has moved on.

begin;

-- Kept only for older readers during the graph-v3 transition. New runtimes
-- enter at trigger nodes, but a care-path row still has to satisfy this legacy
-- column's constraint until it is retired.
alter table public.flows drop constraint if exists flows_trigger_event_check;
alter table public.flows add constraint flows_trigger_event_check check (
  trigger_event in (
    'call.answered','call.ended','call.never_answered','message.received',
    'integration.invoked','care_path.due','care_path.recurring',
    'care_path.reported','care_path.document'
  )
);

-- ---------------------------------------------------------------- vocabulary

insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action, suspends,
  default_timeout_seconds, outcomes, fields, sort_order, is_active,
  valid_triggers, families, is_addable, outcomes_from, output
) values
  ('trigger.due', 'trigger', 'Milestone due',
   'Enter for one patient when an anchor plus an offset reaches its due window.',
   null, false, null,
   '[{"id":"due","label":"Due"}]'::jsonb,
   '[{"key":"key","type":"text","label":"Milestone key","required":true,"help":"Stable within this care path, for example first-midwife-contact."},{"key":"anchor","type":"select","label":"Count from","required":true,"options":[{"id":"enrolment","label":"Enrolment"},{"id":"birth","label":"Birth"},{"id":"transfer_of_care","label":"Transfer of care"},{"id":"discharge","label":"Discharge"},{"id":"treatment_start","label":"Treatment start"}]},{"key":"offset_days","type":"number","label":"Due after days","required":true,"default":0},{"key":"window_days","type":"number","label":"Window length in days","required":false,"default":0}]'::jsonb,
   30, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('trigger.recurring', 'trigger', 'Recurring milestone',
   'Enter for one patient every configured number of days from a named anchor.',
   null, false, null,
   '[{"id":"due","label":"Due"}]'::jsonb,
   '[{"key":"key","type":"text","label":"Milestone key","required":true},{"key":"anchor","type":"select","label":"Count from","required":true,"options":[{"id":"enrolment","label":"Enrolment"},{"id":"birth","label":"Birth"},{"id":"transfer_of_care","label":"Transfer of care"},{"id":"discharge","label":"Discharge"},{"id":"treatment_start","label":"Treatment start"}]},{"key":"every_days","type":"number","label":"Repeat every days","required":true},{"key":"left","type":"text","label":"Continue while value","required":false},{"key":"operator","type":"select","label":"Comparison","required":false,"options":[{"id":"equals","label":"Equals"},{"id":"not_equals","label":"Does not equal"},{"id":"gt","label":"Greater than"},{"id":"gte","label":"At least"},{"id":"lt","label":"Less than"},{"id":"lte","label":"At most"}]},{"key":"right","type":"text","label":"Compared with","required":false}]'::jsonb,
   31, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('trigger.reported', 'trigger', 'Reported by patient',
   'Enter when a patient or practitioner reports one of this trigger''s named observations.',
   null, false, null,
   '[]'::jsonb,
   '[{"key":"key","type":"text","label":"Trigger key","required":true},{"key":"watch","type":"branches","label":"Reported observations","required":true,"help":"One outcome and path is created for each observation."}]'::jsonb,
   32, true, array[]::text[], array['care_path']::text[], true, 'watch', 'opaque'),
  ('trigger.document', 'trigger', 'Document received',
   'Enter when a document of the configured kind is attached to this patient''s care path.',
   null, false, null,
   '[{"id":"received","label":"Received"}]'::jsonb,
   '[{"key":"key","type":"text","label":"Trigger key","required":true},{"key":"document_kind","type":"select","label":"Document kind","required":true,"options":[{"id":"lab_report","label":"Lab report"},{"id":"imaging_report","label":"Imaging report"},{"id":"discharge_summary","label":"Discharge summary"},{"id":"referral","label":"Referral"},{"id":"other","label":"Other"}]}]'::jsonb,
   33, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('outreach.call', 'custom', 'Call patient',
   'Create a durable outbound call request for this patient and wait for its result.',
   null, true, 604800,
   '[{"id":"reached","label":"Reached"},{"id":"not_reached","label":"Not reached"},{"id":"declined","label":"Declined"},{"id":"expired","label":"Expired"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[{"key":"agent_id","type":"agent","label":"Agent","required":true},{"key":"attempts","type":"number","label":"Attempts","required":false,"default":3},{"key":"retry_hours","type":"number","label":"Retry after hours","required":false,"default":4},{"key":"expires_days","type":"number","label":"Expire after days","required":false,"default":7}]'::jsonb,
   34, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('outreach.message', 'custom', 'Message patient',
   'Create a durable patient message for an external delivery adapter.',
   null, true, 86400,
   '[{"id":"reached","label":"Delivered"},{"id":"not_reached","label":"Not delivered"},{"id":"declined","label":"Opted out"},{"id":"expired","label":"Expired"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[{"key":"template","type":"template","label":"Message","required":true},{"key":"channel","type":"select","label":"Channel","required":true,"options":[{"id":"app","label":"App"},{"id":"whatsapp","label":"WhatsApp"},{"id":"sms","label":"SMS"}]},{"key":"expires_days","type":"number","label":"Expire after days","required":false,"default":1}]'::jsonb,
   35, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('outreach.request', 'custom', 'Request from patient',
   'Ask the patient to attend, complete a test, or upload a document; expiry is an explicit flow outcome.',
   null, true, 604800,
   '[{"id":"fulfilled","label":"Fulfilled"},{"id":"declined","label":"Declined"},{"id":"expired","label":"Expired"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[{"key":"what","type":"select","label":"Request","required":true,"options":[{"id":"attendance","label":"Attend appointment"},{"id":"lab_report","label":"Upload lab report"},{"id":"imaging_report","label":"Upload imaging report"},{"id":"test","label":"Complete a test"},{"id":"medication_review","label":"Medication review"},{"id":"other","label":"Other"}]},{"key":"instructions","type":"template","label":"Instructions","required":true},{"key":"expires_days","type":"number","label":"Expire after days","required":true,"default":7}]'::jsonb,
   36, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('care_path.record', 'custom', 'Record observation',
   'Persist a patient-scoped observation so the journey and later flows can use it.',
   null, false, null,
   '[{"id":"recorded","label":"Recorded"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[{"key":"kind","type":"text","label":"Observation kind","required":true},{"key":"value","type":"template","label":"Value","required":true},{"key":"source","type":"select","label":"Source","required":false,"options":[{"id":"patient","label":"Patient"},{"id":"practitioner","label":"Practitioner"},{"id":"document","label":"Document"},{"id":"workflow","label":"Workflow"}],"default":"workflow"}]'::jsonb,
   37, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('care_path.complete', 'custom', 'Complete milestone',
   'Mark a named patient milestone complete and retain the completion evidence.',
   null, false, null,
   '[{"id":"completed","label":"Completed"},{"id":"not_found","label":"Milestone not found"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[{"key":"milestone_key","type":"text","label":"Milestone key","required":true},{"key":"evidence","type":"template","label":"Completion evidence","required":false}]'::jsonb,
   38, true, array[]::text[], array['care_path']::text[], true, null, 'opaque'),
  ('escalate.notify', 'custom', 'Notify care team',
   'Create trackable work for a clinician outside a live conversation.',
   null, false, null,
   '[{"id":"notified","label":"Notified"},{"id":"failed","label":"Failed"}]'::jsonb,
   '[{"key":"to","type":"select","label":"Recipient","required":true,"options":[{"id":"primary_team","label":"Primary care team"},{"id":"on_call","label":"On-call clinician"},{"id":"clinician","label":"Named clinician"},{"id":"coordinator","label":"Care coordinator"}]},{"key":"urgency","type":"select","label":"Urgency","required":true,"options":[{"id":"routine","label":"Routine"},{"id":"soon","label":"Soon"},{"id":"urgent","label":"Urgent"},{"id":"immediate","label":"Immediate"}]},{"key":"note","type":"template","label":"Clinical note","required":true}]'::jsonb,
   39, true, array[]::text[], array['care_path']::text[], true, null, 'opaque')
on conflict (id) do update set
  node_type = excluded.node_type, label = excluded.label,
  description = excluded.description, provider_action = excluded.provider_action,
  suspends = excluded.suspends, default_timeout_seconds = excluded.default_timeout_seconds,
  outcomes = excluded.outcomes, fields = excluded.fields, sort_order = excluded.sort_order,
  is_active = excluded.is_active, valid_triggers = excluded.valid_triggers,
  families = excluded.families, is_addable = excluded.is_addable,
  outcomes_from = excluded.outcomes_from, output = excluded.output;

update public.catalogue_node_types
   set families = array(
     select distinct family
       from unnest(families || array['care_path']::text[]) family
   )
 where id in ('agent','condition','loop','var','intelligence','integration.invoke');

-- --------------------------------------------------------- patient state rows

create table public.care_path_anchors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_patient_id uuid not null references public.cohort_patients(id) on delete cascade,
  anchor_key text not null check (btrim(anchor_key) <> ''),
  occurred_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cohort_patient_id, anchor_key)
);

create table public.care_path_milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_patient_id uuid not null references public.cohort_patients(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete restrict,
  flow_version integer not null,
  trigger_node_id text not null,
  milestone_key text not null check (btrim(milestone_key) <> ''),
  occurrence_key text not null default 'once',
  due_at timestamptz not null,
  overdue_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','due','overdue','completed','cancelled')),
  completed_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cohort_patient_id, flow_id, flow_version, trigger_node_id, occurrence_key)
);

create table public.care_path_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_patient_id uuid not null references public.cohort_patients(id) on delete cascade,
  kind text not null check (btrim(kind) <> ''),
  value jsonb not null,
  source text not null default 'workflow',
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.care_path_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_patient_id uuid not null references public.cohort_patients(id) on delete cascade,
  document_kind text not null check (btrim(document_kind) <> ''),
  document_id text not null check (btrim(document_id) <> ''),
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (cohort_patient_id, document_id)
);

create table public.care_path_outreach (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_patient_id uuid not null references public.cohort_patients(id) on delete cascade,
  run_id uuid,
  kind text not null check (kind in ('call','message','request')),
  instruction text not null check (btrim(instruction) <> ''),
  status text not null default 'pending'
    check (status in ('pending','reached','not_reached','declined','fulfilled','expired','failed')),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.care_path_escalations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_patient_id uuid not null references public.cohort_patients(id) on delete cascade,
  milestone_id uuid references public.care_path_milestones(id) on delete set null,
  recipient text not null check (btrim(recipient) <> ''),
  urgency text not null check (urgency in ('routine','soon','urgent','immediate')),
  note text not null check (btrim(note) <> ''),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  context jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.care_path_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cohort_patient_id uuid not null references public.cohort_patients(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete restrict,
  flow_version integer not null,
  trigger_node_id text not null,
  trigger_implementation text not null,
  trigger_key text not null,
  trigger_outcome text not null,
  event_key text not null,
  scheduled_for timestamptz not null default now(),
  input jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','running','waiting','succeeded','failed','cancelled')),
  result jsonb,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cohort_patient_id, flow_id, flow_version, trigger_node_id, event_key)
);

alter table public.care_path_outreach
  add constraint care_path_outreach_run_fk
  foreign key (run_id) references public.care_path_runs(id) on delete set null;

create index care_path_anchors_enrolment_idx on public.care_path_anchors (cohort_patient_id, anchor_key);
create index care_path_milestones_due_idx on public.care_path_milestones (status, due_at, overdue_at);
create index care_path_observations_enrolment_idx on public.care_path_observations (cohort_patient_id, recorded_at desc);
create index care_path_documents_enrolment_idx on public.care_path_documents (cohort_patient_id, received_at desc);
create index care_path_outreach_pending_idx on public.care_path_outreach (expires_at) where status = 'pending';
create index care_path_escalations_open_idx on public.care_path_escalations (org_id, created_at) where status = 'open';
create index care_path_runs_queue_idx on public.care_path_runs (scheduled_for, created_at) where status = 'queued';

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'care_path_anchors','care_path_milestones','care_path_observations',
    'care_path_documents','care_path_outreach','care_path_escalations','care_path_runs'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy org_member_access on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
  end loop;
end;
$$;

-- -------------------------------------------------------------- invariants

create or replace function public.cohort_uses_care_path_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_flow public.flows;
begin
  select * into v_flow from public.flows where id = new.flow_id;
  if v_flow.id is null or v_flow.org_id <> new.org_id or v_flow.family <> 'care_path' then
    raise exception 'a cohort requires a care_path flow in its own workspace' using errcode = '23514';
  end if;
  if new.status = 'running' and v_flow.status <> 'published' then
    raise exception 'a running cohort requires a published care_path flow' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists cohorts_require_care_path_flow on public.cohorts;
create trigger cohorts_require_care_path_flow
  before insert or update of flow_id, org_id, status on public.cohorts
  for each row execute function public.cohort_uses_care_path_flow();

create or replace function public.seed_enrolment_anchor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.care_path_anchors (
    org_id, cohort_patient_id, anchor_key, occurred_at, evidence
  ) values (
    new.org_id, new.id, 'enrolment', new.started_on::timestamp at time zone 'UTC',
    jsonb_build_object('source', 'cohort_patients.started_on')
  ) on conflict (cohort_patient_id, anchor_key) do update set
    occurred_at = excluded.occurred_at,
    evidence = excluded.evidence,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists cohort_patients_seed_anchor on public.cohort_patients;
create trigger cohort_patients_seed_anchor
  after insert or update of started_on on public.cohort_patients
  for each row execute function public.seed_enrolment_anchor();

insert into public.care_path_anchors (
  org_id, cohort_patient_id, anchor_key, occurred_at, evidence
)
select org_id, id, 'enrolment', started_on::timestamp at time zone 'UTC',
       jsonb_build_object('source', 'cohort_patients.started_on')
  from public.cohort_patients
on conflict (cohort_patient_id, anchor_key) do nothing;

-- ---------------------------------------------------------- trigger handlers

create or replace function public.enqueue_care_path_run(
  p_org_id uuid, p_cohort_patient_id uuid, p_flow_id uuid, p_flow_version integer,
  p_trigger_node_id text, p_trigger_implementation text, p_trigger_key text,
  p_trigger_outcome text, p_event_key text, p_scheduled_for timestamptz,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.care_path_runs;
begin
  insert into public.care_path_runs (
    org_id, cohort_patient_id, flow_id, flow_version, trigger_node_id,
    trigger_implementation, trigger_key, trigger_outcome, event_key,
    scheduled_for, input
  ) values (
    p_org_id, p_cohort_patient_id, p_flow_id, p_flow_version, p_trigger_node_id,
    p_trigger_implementation, p_trigger_key, p_trigger_outcome, p_event_key,
    coalesce(p_scheduled_for, now()), coalesce(p_input, '{}'::jsonb)
  )
  on conflict (cohort_patient_id, flow_id, flow_version, trigger_node_id, event_key)
  do nothing
  returning * into v_run;

  if v_run.id is null then
    select * into v_run from public.care_path_runs
     where cohort_patient_id = p_cohort_patient_id
       and flow_id = p_flow_id and flow_version = p_flow_version
       and trigger_node_id = p_trigger_node_id and event_key = p_event_key;
  end if;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.enqueue_care_path_run(uuid,uuid,uuid,integer,text,text,text,text,text,timestamptz,jsonb) from public;

create or replace function public.set_care_path_anchor(
  p_cohort_patient_id uuid, p_anchor_key text, p_occurred_at timestamptz,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_anchor public.care_path_anchors;
begin
  select org_id into v_org from public.cohort_patients where id = p_cohort_patient_id;
  if v_org is null or (auth.uid() is not null and not public.is_org_member(v_org)) then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  if coalesce(btrim(p_anchor_key), '') = '' or p_occurred_at is null then
    raise exception 'anchor key and occurrence time are required' using errcode = 'P0004';
  end if;
  insert into public.care_path_anchors (
    org_id, cohort_patient_id, anchor_key, occurred_at, evidence
  ) values (
    v_org, p_cohort_patient_id, btrim(p_anchor_key), p_occurred_at,
    coalesce(p_evidence, '{}'::jsonb)
  ) on conflict (cohort_patient_id, anchor_key) do update set
    occurred_at = excluded.occurred_at,
    evidence = excluded.evidence,
    updated_at = now()
  returning * into v_anchor;
  return to_jsonb(v_anchor);
end;
$$;

revoke all on function public.set_care_path_anchor(uuid,text,timestamptz,jsonb) from public;
grant execute on function public.set_care_path_anchor(uuid,text,timestamptz,jsonb) to authenticated, service_role;

create or replace function public.sweep_care_path_events(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record; v_anchor timestamptz; v_due timestamptz; v_overdue timestamptz;
  v_key text; v_window integer; v_every integer; v_latest integer; v_i integer;
  v_occurrence text; v_status text; v_count integer := 0;
begin
  for v_entry in
    select cp.id as enrolment_id, cp.org_id, f.id as flow_id,
           fv.version as flow_version, n as node
      from public.cohort_patients cp
      join public.cohorts c on c.id = cp.cohort_id and c.status = 'running'
      join public.flows f on f.id = c.flow_id and f.family = 'care_path' and f.status = 'published'
      join lateral (
        select version, snapshot from public.flow_versions
         where flow_id = f.id and org_id = f.org_id
         order by version desc limit 1
      ) fv on true
      cross join lateral jsonb_array_elements(fv.snapshot->'graph'->'nodes') n
     where cp.status = 'active'
       and n->>'implementation' in ('trigger.due','trigger.recurring')
  loop
    v_key := nullif(btrim(v_entry.node->'config'->>'key'), '');
    select occurred_at into v_anchor
      from public.care_path_anchors
     where cohort_patient_id = v_entry.enrolment_id
       and anchor_key = v_entry.node->'config'->>'anchor';
    if v_key is null or v_anchor is null then continue; end if;

    if v_entry.node->>'implementation' = 'trigger.due' then
      v_window := greatest(0, coalesce((v_entry.node->'config'->>'window_days')::integer, 0));
      v_due := v_anchor + make_interval(days => coalesce((v_entry.node->'config'->>'offset_days')::integer, 0));
      v_overdue := case when v_window > 0 then v_due + make_interval(days => v_window) else null end;
      v_status := case
        when v_overdue is not null and p_at > v_overdue then 'overdue'
        when p_at >= v_due then 'due'
        else 'scheduled'
      end;
      insert into public.care_path_milestones (
        org_id, cohort_patient_id, flow_id, flow_version, trigger_node_id,
        milestone_key, occurrence_key, due_at, overdue_at, status
      ) values (
        v_entry.org_id, v_entry.enrolment_id, v_entry.flow_id, v_entry.flow_version,
        v_entry.node->>'id', v_key, 'once', v_due, v_overdue, v_status
      ) on conflict (cohort_patient_id, flow_id, flow_version, trigger_node_id, occurrence_key)
      do update set
        due_at = excluded.due_at,
        overdue_at = excluded.overdue_at,
        status = case when care_path_milestones.status in ('completed','cancelled')
                      then care_path_milestones.status else excluded.status end,
        updated_at = now();
      if p_at >= v_due then
        perform public.enqueue_care_path_run(
          v_entry.org_id, v_entry.enrolment_id, v_entry.flow_id, v_entry.flow_version,
          v_entry.node->>'id', 'trigger.due', v_key, 'due', v_key || ':once', v_due,
          jsonb_build_object('milestone_key', v_key, 'due_at', v_due, 'overdue_at', v_overdue)
        );
        v_count := v_count + 1;
      end if;
    else
      v_every := greatest(1, coalesce((v_entry.node->'config'->>'every_days')::integer, 1));
      if p_at < v_anchor then continue; end if;
      v_latest := least(1000, floor(extract(epoch from (p_at - v_anchor)) / (v_every * 86400))::integer);
      for v_i in 0..v_latest loop
        v_due := v_anchor + make_interval(days => v_i * v_every);
        v_occurrence := v_i::text;
        insert into public.care_path_milestones (
          org_id, cohort_patient_id, flow_id, flow_version, trigger_node_id,
          milestone_key, occurrence_key, due_at, status
        ) values (
          v_entry.org_id, v_entry.enrolment_id, v_entry.flow_id, v_entry.flow_version,
          v_entry.node->>'id', v_key, v_occurrence, v_due, 'due'
        ) on conflict (cohort_patient_id, flow_id, flow_version, trigger_node_id, occurrence_key)
        do nothing;
        perform public.enqueue_care_path_run(
          v_entry.org_id, v_entry.enrolment_id, v_entry.flow_id, v_entry.flow_version,
          v_entry.node->>'id', 'trigger.recurring', v_key, 'due',
          v_key || ':' || v_occurrence, v_due,
          jsonb_build_object('milestone_key', v_key, 'occurrence', v_i, 'due_at', v_due)
        );
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;

  update public.care_path_outreach
     set status = 'expired', resolved_at = p_at, updated_at = now()
   where status = 'pending' and expires_at <= p_at;
  return v_count;
end;
$$;

revoke all on function public.sweep_care_path_events(timestamptz) from public;
grant execute on function public.sweep_care_path_events(timestamptz) to service_role;

create or replace function public.record_care_path_observation(
  p_cohort_patient_id uuid, p_kind text, p_value jsonb, p_source text default 'workflow'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_observation public.care_path_observations; v_entry record;
begin
  select org_id into v_org from public.cohort_patients where id = p_cohort_patient_id;
  if v_org is null or (auth.uid() is not null and not public.is_org_member(v_org)) then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  insert into public.care_path_observations (org_id, cohort_patient_id, kind, value, source)
  values (v_org, p_cohort_patient_id, btrim(p_kind), coalesce(p_value, 'null'::jsonb), coalesce(nullif(btrim(p_source), ''), 'workflow'))
  returning * into v_observation;

  for v_entry in
    select f.id as flow_id, fv.version, n as node
      from public.cohort_patients cp
      join public.cohorts c on c.id = cp.cohort_id and c.status = 'running'
      join public.flows f on f.id = c.flow_id and f.family = 'care_path' and f.status = 'published'
      join lateral (select version, snapshot from public.flow_versions where flow_id = f.id order by version desc limit 1) fv on true
      cross join lateral jsonb_array_elements(fv.snapshot->'graph'->'nodes') n
     where cp.id = p_cohort_patient_id and cp.status = 'active'
       and n->>'implementation' = 'trigger.reported'
       and exists (
         select 1 from jsonb_array_elements(coalesce(n->'config'->'watch', '[]'::jsonb)) watched
          where watched->>'id' = p_kind
       )
  loop
    perform public.enqueue_care_path_run(
      v_org, p_cohort_patient_id, v_entry.flow_id, v_entry.version,
      v_entry.node->>'id', 'trigger.reported', v_entry.node->'config'->>'key',
      p_kind, v_observation.id::text, v_observation.recorded_at,
      jsonb_build_object('observation_id', v_observation.id, 'kind', p_kind, 'value', p_value, 'source', p_source)
    );
  end loop;
  return to_jsonb(v_observation);
end;
$$;

revoke all on function public.record_care_path_observation(uuid,text,jsonb,text) from public;
grant execute on function public.record_care_path_observation(uuid,text,jsonb,text) to authenticated, service_role;

create or replace function public.record_care_path_document(
  p_cohort_patient_id uuid, p_document_kind text, p_document_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_document public.care_path_documents; v_entry record;
begin
  select org_id into v_org from public.cohort_patients where id = p_cohort_patient_id;
  if v_org is null or (auth.uid() is not null and not public.is_org_member(v_org)) then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  insert into public.care_path_documents (
    org_id, cohort_patient_id, document_kind, document_id, metadata
  ) values (
    v_org, p_cohort_patient_id, btrim(p_document_kind), btrim(p_document_id),
    coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (cohort_patient_id, document_id) do update set
    document_kind = excluded.document_kind,
    metadata = excluded.metadata
  returning * into v_document;

  for v_entry in
    select f.id as flow_id, fv.version, n as node
      from public.cohort_patients cp
      join public.cohorts c on c.id = cp.cohort_id and c.status = 'running'
      join public.flows f on f.id = c.flow_id and f.family = 'care_path' and f.status = 'published'
      join lateral (select version, snapshot from public.flow_versions where flow_id = f.id order by version desc limit 1) fv on true
      cross join lateral jsonb_array_elements(fv.snapshot->'graph'->'nodes') n
     where cp.id = p_cohort_patient_id and cp.status = 'active'
       and n->>'implementation' = 'trigger.document'
       and n->'config'->>'document_kind' = p_document_kind
  loop
    perform public.enqueue_care_path_run(
      v_org, p_cohort_patient_id, v_entry.flow_id, v_entry.version,
      v_entry.node->>'id', 'trigger.document', v_entry.node->'config'->>'key',
      'received', v_document.id::text, v_document.received_at,
      jsonb_build_object('document_id', p_document_id, 'document_kind', p_document_kind, 'metadata', p_metadata)
    );
  end loop;
  return to_jsonb(v_document);
end;
$$;

revoke all on function public.record_care_path_document(uuid,text,text,jsonb) from public;
grant execute on function public.record_care_path_document(uuid,text,text,jsonb) to authenticated, service_role;

-- ----------------------------------------------------------- action handlers

create or replace function public.complete_care_path_milestone(
  p_cohort_patient_id uuid, p_milestone_key text, p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_milestone public.care_path_milestones;
begin
  select org_id into v_org from public.cohort_patients where id = p_cohort_patient_id;
  if v_org is null or (auth.uid() is not null and not public.is_org_member(v_org)) then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  select * into v_milestone from public.care_path_milestones
   where cohort_patient_id = p_cohort_patient_id and milestone_key = p_milestone_key
     and status not in ('completed','cancelled')
   order by due_at limit 1 for update;
  if v_milestone.id is null then return null; end if;
  update public.care_path_milestones set
    status = 'completed', completed_at = now(), evidence = coalesce(p_evidence, '{}'::jsonb), updated_at = now()
   where id = v_milestone.id returning * into v_milestone;
  return to_jsonb(v_milestone);
end;
$$;

revoke all on function public.complete_care_path_milestone(uuid,text,jsonb) from public;
grant execute on function public.complete_care_path_milestone(uuid,text,jsonb) to authenticated, service_role;

create or replace function public.enqueue_care_path_outreach(
  p_cohort_patient_id uuid, p_run_id uuid, p_kind text, p_instruction text,
  p_expires_at timestamptz, p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_outreach public.care_path_outreach;
begin
  select org_id into v_org from public.cohort_patients where id = p_cohort_patient_id;
  if v_org is null or (auth.uid() is not null and not public.is_org_member(v_org)) then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  if p_kind not in ('call','message','request') or p_expires_at <= now() then
    raise exception 'outreach kind and a future expiry are required' using errcode = 'P0004';
  end if;
  insert into public.care_path_outreach (
    org_id, cohort_patient_id, run_id, kind, instruction, expires_at, payload
  ) values (
    v_org, p_cohort_patient_id, p_run_id, p_kind, btrim(p_instruction), p_expires_at,
    coalesce(p_payload, '{}'::jsonb)
  ) returning * into v_outreach;
  return to_jsonb(v_outreach);
end;
$$;

revoke all on function public.enqueue_care_path_outreach(uuid,uuid,text,text,timestamptz,jsonb) from public;
grant execute on function public.enqueue_care_path_outreach(uuid,uuid,text,text,timestamptz,jsonb) to service_role;

create or replace function public.resolve_care_path_outreach(
  p_outreach_id uuid, p_outcome text, p_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_outreach public.care_path_outreach;
begin
  select * into v_outreach from public.care_path_outreach where id = p_outreach_id for update;
  if v_outreach.id is null
     or (auth.uid() is not null and not public.is_org_member(v_outreach.org_id)) then
    raise exception 'outreach not found' using errcode = '42501';
  end if;
  if v_outreach.status <> 'pending' then
    raise exception 'only pending outreach can be resolved' using errcode = 'P0004';
  end if;
  if p_outcome not in ('reached','not_reached','declined','fulfilled','expired','failed') then
    raise exception 'unknown outreach outcome' using errcode = 'P0004';
  end if;
  update public.care_path_outreach set
    status = p_outcome, result = coalesce(p_result, '{}'::jsonb), resolved_at = now(), updated_at = now()
   where id = p_outreach_id returning * into v_outreach;
  return to_jsonb(v_outreach);
end;
$$;

revoke all on function public.resolve_care_path_outreach(uuid,text,jsonb) from public;
grant execute on function public.resolve_care_path_outreach(uuid,text,jsonb) to authenticated, service_role;

create or replace function public.notify_care_path_escalation(
  p_cohort_patient_id uuid, p_milestone_id uuid, p_recipient text,
  p_urgency text, p_note text, p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_escalation public.care_path_escalations;
begin
  select org_id into v_org from public.cohort_patients where id = p_cohort_patient_id;
  if v_org is null or (auth.uid() is not null and not public.is_org_member(v_org)) then
    raise exception 'enrolment not found' using errcode = '42501';
  end if;
  insert into public.care_path_escalations (
    org_id, cohort_patient_id, milestone_id, recipient, urgency, note, context
  ) values (
    v_org, p_cohort_patient_id, p_milestone_id, btrim(p_recipient), p_urgency,
    btrim(p_note), coalesce(p_context, '{}'::jsonb)
  ) returning * into v_escalation;
  return to_jsonb(v_escalation);
end;
$$;

revoke all on function public.notify_care_path_escalation(uuid,uuid,text,text,text,jsonb) from public;
grant execute on function public.notify_care_path_escalation(uuid,uuid,text,text,text,jsonb) to authenticated, service_role;

-- Care-path release checks are semantic: a graph can only be scheduled when
-- every trigger has a stable patient-scoped identity and usable timing fields.
create or replace function public.validate_care_path_release(p_graph jsonb)
returns void language plpgsql stable set search_path = public as $$
declare v_node jsonb; v_impl text; v_config jsonb;
begin
  for v_node in select * from jsonb_array_elements(p_graph->'nodes') loop
    v_impl := v_node->>'implementation';
    v_config := coalesce(v_node->'config', '{}'::jsonb);
    if v_impl in ('trigger.due','trigger.recurring','trigger.reported','trigger.document')
       and coalesce(btrim(v_config->>'key'), '') = '' then
      raise exception '% needs a stable trigger key', v_impl using errcode = 'P0004';
    end if;
    if v_impl = 'trigger.due' and (
      coalesce(btrim(v_config->>'anchor'), '') = ''
      or coalesce(v_config->>'offset_days', '') !~ '^-?[0-9]+$'
      or coalesce(v_config->>'window_days', '0') !~ '^[0-9]+$'
    ) then raise exception 'Milestone due needs an anchor, integer offset and non-negative window' using errcode = 'P0004'; end if;
    if v_impl = 'trigger.recurring' and (
      coalesce(btrim(v_config->>'anchor'), '') = ''
      or coalesce(v_config->>'every_days', '') !~ '^[1-9][0-9]*$'
    ) then raise exception 'Recurring milestone needs an anchor and positive interval' using errcode = 'P0004'; end if;
    if v_impl = 'trigger.reported' and jsonb_array_length(coalesce(v_config->'watch', '[]'::jsonb)) = 0
    then raise exception 'Reported by patient needs at least one observation' using errcode = 'P0004'; end if;
    if v_impl = 'trigger.document' and coalesce(btrim(v_config->>'document_kind'), '') = ''
    then raise exception 'Document received needs a document kind' using errcode = 'P0004'; end if;
  end loop;
end;
$$;

revoke all on function public.validate_care_path_release(jsonb) from public;
grant execute on function public.validate_care_path_release(jsonb) to authenticated;

-- Extend the release validator installed by 0115 without weakening its
-- integration checks.
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
  ) then raise exception 'the flow contains a node outside its family' using errcode = 'P0004'; end if;

  if p_family = 'care_path' then perform public.validate_care_path_release(p_graph); end if;
  if p_family = 'integration' then
    if (select count(*) from jsonb_array_elements(p_graph->'nodes') n
         where n->>'implementation' = 'trigger.integration_invoked') <> 1
       or exists (select 1 from jsonb_array_elements(p_graph->'nodes') n
                   where n->>'implementation' like 'trigger.%'
                     and n->>'implementation' <> 'trigger.integration_invoked') then
      raise exception 'an integration needs exactly one Integration invoked trigger' using errcode = 'P0004';
    end if;
    select n->'config'->>'input_schema_id' into v_schema
      from jsonb_array_elements(p_graph->'nodes') n
     where n->>'implementation' = 'trigger.integration_invoked';
    if coalesce(v_schema, '') = '' or not exists (
      select 1 from public.structured_outputs
       where id = v_schema::uuid and org_id = p_org_id and enabled
    ) then raise exception 'the integration trigger needs an enabled input schema in this workspace' using errcode = 'P0004'; end if;
  end if;

  for v_node in select n from jsonb_array_elements(p_graph->'nodes') n
                 where n->>'implementation' = 'integration.invoke'
  loop
    v_target := v_node->'config'->>'target_flow_id';
    if coalesce(v_target, '') = '' or not exists (
      select 1 from public.flows where id = v_target::uuid and org_id = p_org_id
       and family = 'integration' and status = 'published'
    ) then raise exception 'Invoke integration needs a published integration in this workspace' using errcode = 'P0004'; end if;
  end loop;
end;
$$;

revoke all on function public.validate_flow_release(uuid,text,jsonb) from public;
grant execute on function public.validate_flow_release(uuid,text,jsonb) to authenticated;

commit;
