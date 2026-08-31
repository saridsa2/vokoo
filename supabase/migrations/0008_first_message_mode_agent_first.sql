-- `assistant-first` becomes `agent-first`.
--
-- The stored value follows the rename because the label built from it reads
-- "Assistant speaks first", which is now the wrong word on screen. Done as data
-- plus validation together so no row is ever left holding a value the check
-- would reject.
--
-- Version snapshots are rewritten too. They are an audit trail of configuration,
-- not of vocabulary, and leaving the old spelling there would make a restored
-- version fail validation for a reason that has nothing to do with the release.

update public.agents
set config = jsonb_set(config, '{first_message_mode}', '"agent-first"')
where config->>'first_message_mode' = 'assistant-first';

update public.agent_versions
set snapshot = jsonb_set(
      snapshot,
      '{config,first_message_mode}',
      '"agent-first"'
    )
where snapshot->'config'->>'first_message_mode' = 'assistant-first';

-- Validation follows the value.
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
  if v_mode is not null and v_mode not in ('agent-first', 'user-first') then
    raise exception 'first_message_mode must be agent-first or user-first, not %', v_mode
      using errcode = 'P0004';
  end if;

  -- An agent that speaks first with nothing to say answers the phone in
  -- silence, which a caller cannot tell apart from a broken line.
  if coalesce(v_mode, 'agent-first') = 'agent-first'
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
