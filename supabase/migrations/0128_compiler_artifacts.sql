-- Provenance and one-transaction materialization for compiler-created drafts.

begin;

create table public.compiler_artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  artifact_type text not null check (artifact_type in ('agent','flow')),
  stable_key text not null check (btrim(stable_key) <> ''),
  role text not null default 'generated' check (btrim(role) <> ''),
  agent_id uuid references public.agents(id) on delete set null,
  flow_id uuid references public.flows(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (run_id, stable_key),
  unique (id, run_id, org_id),
  check (num_nonnulls(agent_id, flow_id) <= 1),
  constraint compiler_artifacts_run_same_org
    foreign key (run_id, org_id) references public.compiler_runs(id, org_id) on delete cascade
);

create table public.compiler_evidence_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  artifact_id uuid not null,
  target_path text not null check (btrim(target_path) <> ''),
  chunk_id uuid not null,
  excerpt text not null check (btrim(excerpt) <> '' and char_length(excerpt) <= 1000),
  recommendation_id text not null default '',
  evidence_role text not null check (evidence_role in (
    'requirement','threshold','timing','exception','population','escalation'
  )),
  created_at timestamptz not null default now(),
  unique (artifact_id, target_path, chunk_id, evidence_role),
  constraint compiler_evidence_artifact_same_run
    foreign key (artifact_id, run_id, org_id)
    references public.compiler_artifacts(id, run_id, org_id) on delete cascade,
  constraint compiler_evidence_chunk_same_org
    foreign key (chunk_id, org_id) references public.document_chunks(id, org_id)
);

create index compiler_artifacts_run_idx on public.compiler_artifacts (run_id, artifact_type, stable_key);
create index compiler_evidence_run_idx on public.compiler_evidence_links (run_id, artifact_id);

alter table public.compiler_artifacts enable row level security;
alter table public.compiler_evidence_links enable row level security;
create policy compiler_artifacts_read on public.compiler_artifacts for select to authenticated
  using (public.is_org_member(org_id));
create policy compiler_evidence_read on public.compiler_evidence_links for select to authenticated
  using (public.is_org_member(org_id));
grant select on public.compiler_artifacts, public.compiler_evidence_links to authenticated;

create or replace function public.materialize_care_path_compilation(
  p_run_id uuid,
  p_worker text,
  p_agents jsonb,
  p_flows jsonb,
  p_gaps jsonb,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.compiler_runs;
  v_catalogue jsonb;
  v_digest text;
  v_item jsonb;
  v_node jsonb;
  v_graph jsonb;
  v_nodes jsonb;
  v_agent_id uuid;
  v_flow_id uuid;
  v_artifact_id uuid;
  v_key text;
  v_chunk public.document_chunks;
  v_agent_ids jsonb := '{}'::jsonb;
  v_agents_result jsonb;
  v_flows_result jsonb;
  v_sequence integer;
  v_gap_count integer;
begin
  select * into v_run from public.compiler_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'compiler run not found' using errcode = 'P0004';
  end if;
  if v_run.status in ('completed','completed_with_gaps') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.agent_id, 'key', a.stable_key, 'artifact_id', a.id
    ) order by a.stable_key), '[]'::jsonb)
      into v_agents_result from public.compiler_artifacts a
     where a.run_id = v_run.id and a.artifact_type = 'agent';
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.flow_id, 'key', a.stable_key, 'artifact_id', a.id
    ) order by a.stable_key), '[]'::jsonb)
      into v_flows_result from public.compiler_artifacts a
     where a.run_id = v_run.id and a.artifact_type = 'flow';
    return jsonb_build_object(
      'run_id', v_run.id, 'status', v_run.status,
      'agents', v_agents_result, 'flows', v_flows_result
    );
  end if;
  if v_run.status <> 'materializing'
     or v_run.lease_owner is distinct from p_worker
     or v_run.lease_expires_at <= now() then
    raise exception 'compiler run lease was lost' using errcode = 'P0004';
  end if;
  if jsonb_typeof(p_agents) <> 'array' or jsonb_typeof(p_flows) <> 'array'
     or jsonb_typeof(p_gaps) <> 'array' or jsonb_typeof(p_evidence) <> 'array' then
    raise exception 'compiler materialization payloads must be arrays' using errcode = 'P0004';
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
  if v_digest is distinct from v_run.catalogue_digest
     or v_run.input_snapshot->'catalogue' is distinct from v_catalogue then
    raise exception 'compiler catalogue changed before materialization' using errcode = 'P0004';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_agents) a
    group by a->>'key' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(p_flows) f
    group by f->>'key' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(p_agents) a
    join jsonb_array_elements(p_flows) f on f->>'key' = a->>'key'
  ) then
    raise exception 'compiler artifact keys must be unique' using errcode = 'P0004';
  end if;

  for v_item in select value from jsonb_array_elements(p_agents) loop
    v_key := btrim(coalesce(v_item->>'key', ''));
    if v_key = '' or btrim(coalesce(v_item->>'name', '')) = ''
       or btrim(coalesce(v_item->>'system_prompt', '')) = '' then
      raise exception 'generated agent is incomplete' using errcode = 'P0004';
    end if;
    insert into public.agents (
      org_id, name, status, system_prompt, first_message, config
    ) values (
      v_run.org_id, btrim(v_item->>'name'), 'draft', v_item->>'system_prompt',
      coalesce(v_item->>'first_message', ''), coalesce(v_item->'config', '{}'::jsonb)
    ) returning id into v_agent_id;
    insert into public.compiler_artifacts (
      org_id, run_id, artifact_type, stable_key, role, agent_id
    ) values (
      v_run.org_id, v_run.id, 'agent', v_key,
      coalesce(nullif(btrim(v_item->>'role'), ''), 'conversation'), v_agent_id
    ) returning id into v_artifact_id;
    v_agent_ids := jsonb_set(v_agent_ids, array[v_key], to_jsonb(v_agent_id::text), true);
  end loop;

  for v_item in select value from jsonb_array_elements(p_flows) loop
    v_key := btrim(coalesce(v_item->>'key', ''));
    v_graph := v_item->'graph';
    if v_key = '' or btrim(coalesce(v_item->>'name', '')) = ''
       or jsonb_typeof(v_graph) <> 'object'
       or jsonb_typeof(v_graph->'nodes') <> 'array'
       or jsonb_typeof(v_graph->'transitions') <> 'array'
       or coalesce(v_item->>'trigger_event', '') not in (
         'care_path.due','care_path.recurring','care_path.reported','care_path.document'
       ) then
      raise exception 'generated care path is incomplete' using errcode = 'P0004';
    end if;
    v_nodes := '[]'::jsonb;
    for v_node in select value from jsonb_array_elements(v_graph->'nodes') loop
      if nullif(btrim(v_node->>'agent_key'), '') is not null then
        v_agent_id := nullif(v_agent_ids->>(v_node->>'agent_key'), '')::uuid;
        if v_agent_id is null then
          raise exception 'generated flow references unknown agent key %', v_node->>'agent_key' using errcode = 'P0004';
        end if;
        v_node := jsonb_set(
          v_node - 'agent_key', '{config}',
          coalesce(v_node->'config', '{}'::jsonb) || jsonb_build_object('agent_id', v_agent_id),
          true
        );
      end if;
      v_nodes := v_nodes || jsonb_build_array(v_node);
    end loop;
    v_graph := jsonb_set(v_graph, '{nodes}', v_nodes, true);
    perform public.validate_flow(v_graph, 'care_path', v_item->>'trigger_event');
    perform public.validate_care_path_release(v_graph);
    insert into public.flows (
      org_id, name, description, status, graph, trigger_event, channel, family
    ) values (
      v_run.org_id, btrim(v_item->>'name'), coalesce(v_item->>'description', ''),
      'draft', v_graph, v_item->>'trigger_event', 'voice', 'care_path'
    ) returning id into v_flow_id;
    insert into public.compiler_artifacts (
      org_id, run_id, artifact_type, stable_key, role, flow_id
    ) values (
      v_run.org_id, v_run.id, 'flow', v_key,
      coalesce(nullif(btrim(v_item->>'role'), ''), 'care_path'), v_flow_id
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_gaps) loop
    if btrim(coalesce(v_item->>'code', '')) = ''
       or coalesce(v_item->>'severity', '') not in ('info','warning','blocking')
       or btrim(coalesce(v_item->>'explanation', '')) = ''
       or jsonb_typeof(coalesce(v_item->'evidence', '[]'::jsonb)) <> 'array' then
      raise exception 'compiler gap is invalid' using errcode = 'P0004';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_item->'evidence', '[]'::jsonb)) e
      left join public.document_chunks c
        on c.id = nullif(e->>'chunk_id', '')::uuid
       and c.org_id = v_run.org_id and c.file_version_id = v_run.file_version_id
      where c.id is null
    ) then
      raise exception 'compiler gap evidence is outside the frozen version' using errcode = 'P0004';
    end if;
    insert into public.compiler_gaps (
      org_id, run_id, step_id, code, severity, recommendation_id,
      explanation, missing_capability, evidence
    ) values (
      v_run.org_id, v_run.id, nullif(v_item->>'step_id', '')::uuid,
      v_item->>'code', v_item->>'severity', coalesce(v_item->>'recommendation_id', ''),
      v_item->>'explanation', v_item->>'missing_capability',
      coalesce(v_item->'evidence', '[]'::jsonb)
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_evidence) loop
    select id into v_artifact_id from public.compiler_artifacts
     where run_id = v_run.id and stable_key = v_item->>'artifact_key';
    select * into v_chunk from public.document_chunks
     where id = nullif(v_item->>'chunk_id', '')::uuid
       and org_id = v_run.org_id and file_version_id = v_run.file_version_id;
    if v_artifact_id is null or v_chunk.id is null
       or btrim(coalesce(v_item->>'target_path', '')) = ''
       or btrim(coalesce(v_item->>'excerpt', '')) = ''
       or position(btrim(v_item->>'excerpt') in v_chunk.content) = 0
       or coalesce(v_item->>'role', '') not in (
         'requirement','threshold','timing','exception','population','escalation'
       ) then
      raise exception 'compiler evidence is invalid or outside the frozen version' using errcode = 'P0004';
    end if;
    insert into public.compiler_evidence_links (
      org_id, run_id, artifact_id, target_path, chunk_id, excerpt,
      recommendation_id, evidence_role
    ) values (
      v_run.org_id, v_run.id, v_artifact_id, v_item->>'target_path', v_chunk.id,
      btrim(v_item->>'excerpt'), coalesce(v_item->>'recommendation_id', ''), v_item->>'role'
    );
  end loop;

  select count(*) into v_gap_count from public.compiler_gaps where run_id = v_run.id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.compiler_steps where run_id = v_run.id;
  insert into public.compiler_steps (
    org_id, run_id, sequence, kind, status, task_key, input_refs, result
  ) values (
    v_run.org_id, v_run.id, v_sequence, 'materialize', 'completed', 'workspace-drafts',
    jsonb_build_object('agent_count', jsonb_array_length(p_agents), 'flow_count', jsonb_array_length(p_flows)),
    jsonb_build_object('gap_count', v_gap_count)
  );
  update public.compiler_runs set
    status = case when v_gap_count > 0 then 'completed_with_gaps' else 'completed' end,
    coverage = coverage || jsonb_build_object(
      'agent_count', jsonb_array_length(p_agents),
      'flow_count', jsonb_array_length(p_flows),
      'gap_count', v_gap_count
    ),
    lease_owner = null, lease_expires_at = null, completed_at = now(), updated_at = now()
  where id = v_run.id returning * into v_run;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.agent_id, 'key', a.stable_key, 'artifact_id', a.id
  ) order by a.stable_key), '[]'::jsonb)
    into v_agents_result from public.compiler_artifacts a
   where a.run_id = v_run.id and a.artifact_type = 'agent';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.flow_id, 'key', a.stable_key, 'artifact_id', a.id
  ) order by a.stable_key), '[]'::jsonb)
    into v_flows_result from public.compiler_artifacts a
   where a.run_id = v_run.id and a.artifact_type = 'flow';
  return jsonb_build_object(
    'run_id', v_run.id, 'status', v_run.status,
    'agents', v_agents_result, 'flows', v_flows_result
  );
end;
$$;

revoke all on function public.materialize_care_path_compilation(uuid,text,jsonb,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_care_path_compilation(uuid,text,jsonb,jsonb,jsonb,jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
