-- Validate the jsonb configuration at publish time.
--
-- jsonb is unvalidated by the database, which is the price of not needing a
-- migration for every new voice. The cost is that a typo in a key or a string
-- where a number belongs is stored without complaint and only fails on a live
-- call — the worst place to discover it.
--
-- Publish is the right boundary for the check. Drafts stay permissive, so a
-- half-finished configuration can be saved; releasing one to real callers has
-- to pass. The check runs inside publish_assistant, so restore is covered by
-- the same code rather than by a second copy that can drift.
--
-- Only the keys the bridge actually reads are checked. Validating unknown keys
-- would reject configuration the bridge ignores anyway, and would have to be
-- edited every time a tab grows a field.

create or replace function public.validate_assistant_config(p_row public.assistants)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_config  jsonb := coalesce(p_row.config, '{}'::jsonb);
  v_voice   jsonb := coalesce(p_row.voice_config, '{}'::jsonb);
  v_mode    text;
begin
  if coalesce(trim(p_row.name), '') = '' then
    raise exception 'name is required' using errcode = 'P0004';
  end if;

  v_mode := v_config->>'first_message_mode';
  if v_mode is not null and v_mode not in ('assistant-first', 'user-first') then
    raise exception 'first_message_mode must be assistant-first or user-first, not %', v_mode
      using errcode = 'P0004';
  end if;

  -- Assistant-first with no greeting is a call that connects and says nothing.
  -- The caller hears silence and hangs up, which is indistinguishable from a
  -- broken line.
  if coalesce(v_mode, 'assistant-first') = 'assistant-first'
     and coalesce(trim(p_row.first_message), '') = '' then
    raise exception 'first_message is required when the assistant speaks first'
      using errcode = 'P0004';
  end if;

  -- Numeric keys are checked for type and for range. A string here is the
  -- common failure: jsonb keeps the quotes and the bridge reads "300" rather
  -- than 300.
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

create or replace function public.assert_jsonb_number(
  p_config jsonb,
  p_key    text,
  p_min    numeric,
  p_max    numeric
)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value jsonb := p_config -> p_key;
  v_number numeric;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return;  -- absent is valid; the bridge has a default for every key
  end if;

  if jsonb_typeof(v_value) <> 'number' then
    raise exception '% must be a number, not a %', p_key, jsonb_typeof(v_value)
      using errcode = 'P0004';
  end if;

  v_number := v_value::text::numeric;
  if v_number < p_min or v_number > p_max then
    raise exception '% must be between % and %, not %', p_key, p_min, p_max, v_number
      using errcode = 'P0004';
  end if;
end;
$$;

create or replace function public.assert_jsonb_boolean(p_config jsonb, p_key text)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value jsonb := p_config -> p_key;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return;
  end if;
  if jsonb_typeof(v_value) <> 'boolean' then
    raise exception '% must be true or false, not a %', p_key, jsonb_typeof(v_value)
      using errcode = 'P0004';
  end if;
end;
$$;

grant execute on function public.validate_assistant_config(public.assistants) to authenticated;
grant execute on function public.assert_jsonb_number(jsonb, text, numeric, numeric) to authenticated;
grant execute on function public.assert_jsonb_boolean(jsonb, text) to authenticated;

-- Republished with the validation call. The update happens first and the check
-- runs against the resulting row, so a rejection rolls the whole function back
-- and leaves the live assistant untouched.
create or replace function public.publish_assistant(
  p_assistant_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org_id     uuid;
  v_next       integer;
  v_row        public.assistants;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select org_id into v_org_id from public.assistants where id = p_assistant_id;
  if v_org_id is null then
    raise exception 'assistant not found' using errcode = 'P0002';
  end if;

  if not public.can_publish_assistants(v_org_id) then
    raise exception 'your role may not publish assistants' using errcode = 'P0003';
  end if;

  update public.assistants set
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
  where id = p_assistant_id
  returning * into v_row;

  perform public.validate_assistant_config(v_row);

  select coalesce(max(version), 0) + 1 into v_next
  from public.assistant_versions
  where assistant_id = p_assistant_id;

  insert into public.assistant_versions (org_id, assistant_id, version, snapshot, published_by)
  values (v_org_id, p_assistant_id, v_next, to_jsonb(v_row), auth.uid());

  return jsonb_build_object('assistant', to_jsonb(v_row), 'version', v_next);
end;
$$;

revoke all on function public.publish_assistant(uuid, jsonb) from public;
grant execute on function public.publish_assistant(uuid, jsonb) to authenticated;
