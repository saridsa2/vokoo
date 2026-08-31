-- Publishing a flow.
--
-- The same shape agents already use, for the same reasons: the row update, the
-- version number and the snapshot are written in one transaction, because split
-- across statements a crash between them leaves history disagreeing with what is
-- live — and that disagreement is only discovered by someone trying to roll back.
--
-- Releasing is a different privilege from editing, and it is the same privilege
-- for both flows and agents. `can_publish_agents` was named for the one caller it
-- had; now there are two, so it becomes `can_release` and the old name goes.

begin;

create table if not exists public.flow_versions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  flow_id      uuid not null references public.flows(id) on delete cascade,
  version      integer not null,
  snapshot     jsonb not null,
  published_by uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (flow_id, version)
);

alter table public.flow_versions enable row level security;
drop policy if exists org_member_access on public.flow_versions;
create policy org_member_access on public.flow_versions for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
grant select, insert on public.flow_versions to authenticated;

create index if not exists flow_versions_flow_version_idx
  on public.flow_versions (flow_id, version desc);

alter table public.flows add column if not exists published_at timestamptz;

commit;

create or replace function public.can_release(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid()
      and role in ('owner', 'admin', 'developer')
  );
$$;

revoke all on function public.can_release(uuid) from public;
grant execute on function public.can_release(uuid) to authenticated;

-- Agents move onto the shared check rather than keeping their own copy.
create or replace function public.publish_agent(p_agent_id uuid, p_payload jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_org_id uuid;
  v_next   integer;
  v_row    public.agents;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select org_id into v_org_id from public.agents where id = p_agent_id;
  if v_org_id is null then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;
  if not public.can_release(v_org_id) then
    raise exception 'your role may not publish' using errcode = 'P0003';
  end if;

  update public.agents set
    name               = coalesce(p_payload->>'name', name),
    provider           = coalesce(p_payload->>'provider', provider),
    model              = coalesce(p_payload->>'model', model),
    first_message      = coalesce(p_payload->>'first_message', first_message),
    system_prompt      = coalesce(p_payload->>'system_prompt', system_prompt),
    voice_config       = coalesce(p_payload->'voice_config', voice_config),
    transcriber_config = coalesce(p_payload->'transcriber_config', transcriber_config),
    analysis_config    = coalesce(p_payload->'analysis_config', analysis_config),
    compliance_config  = coalesce(p_payload->'compliance_config', compliance_config),
    config             = coalesce(p_payload->'config', config),
    status = 'published', published_at = now(), updated_at = now()
  where id = p_agent_id
  returning * into v_row;

  perform public.validate_agent_config(v_row);

  select coalesce(max(version), 0) + 1 into v_next
  from public.agent_versions where agent_id = p_agent_id;

  insert into public.agent_versions (org_id, agent_id, version, snapshot, published_by)
  values (v_org_id, p_agent_id, v_next, to_jsonb(v_row), auth.uid());

  return jsonb_build_object('agent', to_jsonb(v_row), 'version', v_next);
end;
$$;

revoke all on function public.publish_agent(uuid, jsonb) from public;
grant execute on function public.publish_agent(uuid, jsonb) to authenticated;

drop function if exists public.can_publish_agents(uuid);

-- ------------------------------------------------------------------- flows

create or replace function public.publish_flow(p_flow_id uuid, p_graph jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_org_id uuid;
  v_next   integer;
  v_row    public.flows;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select org_id into v_org_id from public.flows where id = p_flow_id;
  if v_org_id is null then
    raise exception 'flow not found' using errcode = 'P0002';
  end if;
  if not public.can_release(v_org_id) then
    raise exception 'your role may not publish' using errcode = 'P0003';
  end if;

  update public.flows set
    graph = coalesce(p_graph, graph),
    status = 'published', published_at = now(), updated_at = now()
  where id = p_flow_id
  returning * into v_row;

  -- Validated against the row that now exists rather than the payload, so a
  -- rejection rolls the whole function back and leaves the live flow untouched.
  perform public.validate_flow(v_row.graph);

  -- A published flow whose agent is still a draft would fail at the moment it
  -- mattered. Checked here because only the database can see both.
  if exists (
    select 1
    from jsonb_array_elements(v_row.graph->'nodes') n
    join public.agents a on a.id = (n->'config'->>'agent_id')::uuid
    where n->>'implementation' = 'agent' and a.status <> 'published'
  ) then
    raise exception 'this flow uses an agent that has not been published'
      using errcode = 'P0004';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from public.flow_versions where flow_id = p_flow_id;

  insert into public.flow_versions (org_id, flow_id, version, snapshot, published_by)
  values (v_org_id, p_flow_id, v_next, to_jsonb(v_row), auth.uid());

  return jsonb_build_object('flow', to_jsonb(v_row), 'version', v_next);
end;
$$;

revoke all on function public.publish_flow(uuid, jsonb) from public;
grant execute on function public.publish_flow(uuid, jsonb) to authenticated;

-- Restoring republishes an old snapshot through the same path, so a rollback
-- appends a version rather than rewriting history.
create or replace function public.restore_flow_version(p_flow_id uuid, p_version integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_graph jsonb;
begin
  select snapshot->'graph' into v_graph
  from public.flow_versions
  where flow_id = p_flow_id and version = p_version;

  if v_graph is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;

  return public.publish_flow(p_flow_id, v_graph);
end;
$$;

revoke all on function public.restore_flow_version(uuid, integer) from public;
grant execute on function public.restore_flow_version(uuid, integer) to authenticated;
