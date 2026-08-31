-- Assistants become agents.
--
-- "Assistant" was Vapi's word and it describes a thing that helps a person.
-- What this product configures is a worker that takes a call on its own: it has
-- skills, it has tools, it finishes with an outcome, and a flow decides what
-- happens next. Agent is the word for that, and it is the word used everywhere
-- else in the system we are building.
--
-- Done now because nothing depends on the old names yet — one published row,
-- one phone number, no customers. The same rename after a customer integration
-- exists is a deprecation cycle rather than an afternoon.
--
-- Renames rather than new tables: PostgreSQL carries indexes, constraints,
-- foreign keys and row-level security policies across a rename, so the data and
-- every guarantee on it survive untouched.

alter table public.assistants         rename to agents;
alter table public.assistant_versions rename to agent_versions;
alter table public.assistant_tools    rename to agent_tools;

alter table public.agent_versions rename column assistant_id to agent_id;
alter table public.agent_tools    rename column assistant_id to agent_id;
alter table public.calls          rename column assistant_id to agent_id;
alter table public.chats          rename column assistant_id to agent_id;
alter table public.phone_numbers  rename column assistant_id to agent_id;

alter index if exists assistant_versions_assistant_version_idx
  rename to agent_versions_agent_version_idx;

-- Functions cannot be renamed in place with their bodies referring to the old
-- names, so they are dropped and recreated. Behaviour is unchanged.
drop function if exists public.publish_assistant(uuid, jsonb);
drop function if exists public.restore_assistant_version(uuid, integer);
drop function if exists public.can_publish_assistants(uuid);
drop function if exists public.validate_assistant_config(public.agents);

-- Publishing is a different privilege from editing. The boundary between
-- developer and admin is still open; what is settled is that a viewer may not
-- release to live callers.
create or replace function public.can_publish_agents(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid()
      and role in ('owner', 'admin', 'developer')
  );
$$;

revoke all on function public.can_publish_agents(uuid) from public;
grant execute on function public.can_publish_agents(uuid) to authenticated;

-- Validation joins the capability catalogue, so the cross-field rules a client
-- cannot be trusted with are enforced here: a model on the wrong provider, a
-- voice its provider cannot speak, a text model with nothing transcribing.
create or replace function public.validate_agent_config(p_row public.agents)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_config   jsonb := coalesce(p_row.config, '{}'::jsonb);
  v_voice    jsonb := coalesce(p_row.voice_config, '{}'::jsonb);
  v_trans    jsonb := coalesce(p_row.transcriber_config, '{}'::jsonb);
  v_mode     text;
  v_model    public.catalogue_models;
  v_voice_id text;
  v_trans_id text;
begin
  if coalesce(trim(p_row.name), '') = '' then
    raise exception 'name is required' using errcode = 'P0004';
  end if;

  if not exists (select 1 from public.catalogue_providers where id = p_row.provider and is_active) then
    raise exception 'unknown provider %', p_row.provider using errcode = 'P0004';
  end if;

  select * into v_model from public.catalogue_models where id = p_row.model and is_active;
  if v_model.id is null then
    raise exception 'unknown model %', p_row.model using errcode = 'P0004';
  end if;
  if v_model.provider_id <> p_row.provider then
    raise exception '% is a % model and cannot run on %',
      v_model.label, v_model.provider_id, p_row.provider using errcode = 'P0004';
  end if;

  v_voice_id := v_voice->>'voice';
  if v_voice_id is not null and v_voice_id <> '' then
    if not exists (select 1 from public.catalogue_voices
                   where id = v_voice_id and provider_id = p_row.provider and is_active) then
      raise exception 'voice % is not available on %', v_voice_id, p_row.provider
        using errcode = 'P0004';
    end if;
  end if;

  v_trans_id := v_trans->>'provider';
  if v_trans_id is not null and v_trans_id <> '' then
    if not exists (select 1 from public.catalogue_transcribers
                   where id = v_trans_id and provider_id = p_row.provider and is_active) then
      raise exception 'transcriber % is not available on %', v_trans_id, p_row.provider
        using errcode = 'P0004';
    end if;
  end if;

  if not v_model.native_audio then
    if v_trans_id is null or v_trans_id = ''
       or exists (select 1 from public.catalogue_transcribers where id = v_trans_id and is_passthrough) then
      raise exception '% does not hear audio directly and needs a transcriber', v_model.label
        using errcode = 'P0004';
    end if;
  end if;

  v_mode := v_config->>'first_message_mode';
  if v_mode is not null and v_mode not in ('assistant-first', 'user-first') then
    raise exception 'first_message_mode must be assistant-first or user-first, not %', v_mode
      using errcode = 'P0004';
  end if;

  -- An agent that speaks first with nothing to say answers the phone in
  -- silence, which a caller cannot tell apart from a broken line.
  if coalesce(v_mode, 'assistant-first') = 'assistant-first'
     and coalesce(trim(p_row.first_message), '') = '' then
    raise exception 'first_message is required when the agent speaks first'
      using errcode = 'P0004';
  end if;

  perform public.assert_jsonb_number(v_config, 'max_tokens', 1, 4096);
  perform public.assert_jsonb_number(v_config, 'temperature', 0, 2);
  perform public.assert_jsonb_number(v_config, 'priming_ms', 0, 2000);
  perform public.assert_jsonb_number(v_config, 'silence_ms', 0, 5000);
  perform public.assert_jsonb_number(v_config, 'max_duration_s', 0, 7200);
  perform public.assert_jsonb_number(v_config, 'latency_threshold_ms', 0, 30000);
  perform public.assert_jsonb_number(v_voice, 'speed', 0.5, 2);

  perform public.assert_jsonb_boolean(v_config, 'mic_gate');
  perform public.assert_jsonb_boolean(v_config, 'alert_on_failure');
  perform public.assert_jsonb_boolean(v_config, 'alert_on_latency');
end;
$$;

grant execute on function public.validate_agent_config(public.agents) to authenticated;

-- The row update, the version number and the snapshot are written in one
-- transaction. Split apart, a crash between them leaves history disagreeing
-- with what is live — discovered only by someone trying to roll back.
create or replace function public.publish_agent(p_agent_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
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

  if not public.can_publish_agents(v_org_id) then
    raise exception 'your role may not publish agents' using errcode = 'P0003';
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
    status             = 'published',
    published_at       = now(),
    updated_at         = now()
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

-- Restoring takes the same path as publishing, so a rollback appends a version
-- rather than rewriting history. A rollback that erased its own trail would
-- make the audit log a lie.
create or replace function public.restore_agent_version(p_agent_id uuid, p_version integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_snapshot jsonb;
begin
  select snapshot into v_snapshot
  from public.agent_versions
  where agent_id = p_agent_id and version = p_version;

  if v_snapshot is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;

  return public.publish_agent(p_agent_id, v_snapshot);
end;
$$;

revoke all on function public.restore_agent_version(uuid, integer) from public;
grant execute on function public.restore_agent_version(uuid, integer) to authenticated;
