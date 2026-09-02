-- `validate_agent_config` refused an agent whose engine was correct.
--
-- Regenerated from the live definition with one guard added, rather than
-- rewritten: the numeric bounds at the end are load-bearing and losing one in a
-- rewrite would be silent.

begin;

CREATE OR REPLACE FUNCTION public.validate_agent_config(p_row agents)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  -- Everything about how this agent sounds belongs to its engine, when it has
  -- one: the provider, the model, the voice and the transcriber are written
  -- onto the row from `engines.config` and are a record of that choice, not a
  -- choice made here. `engine_publish` already refuses an engine with a missing
  -- provider or an unconnected key, against `catalogue_engine_stages`.
  --
  -- Checking them again here, against `catalogue_providers` and
  -- `catalogue_models`, is a second opinion from a table that knows only
  -- `local` and `gemini`. On 1 September that opinion refused a correct agent
  -- with "unknown provider openai" — the agent was on a published relay whose
  -- thinking step is OpenAI, which is a provider the platform does offer.
  --
  -- So with an engine attached, skip to the checks that are still the agent's:
  -- its name, how it opens, and the numeric bounds below.
  if p_row.engine_id is null then

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
      raise exception 'voice % is not available on %', v_voice_id, p_row.provider using errcode = 'P0004';
    end if;
  end if;

  v_trans_id := v_trans->>'transcriber';
  if v_trans_id is not null and v_trans_id <> '' then
    if not exists (select 1 from public.catalogue_transcribers
                   where id = v_trans_id and provider_id = p_row.provider and is_active) then
      raise exception 'transcriber % is not available on %', v_trans_id, p_row.provider using errcode = 'P0004';
    end if;
  end if;

  if not v_model.native_audio then
    if v_trans_id is null or v_trans_id = ''
       or exists (select 1 from public.catalogue_transcribers where id = v_trans_id and is_passthrough) then
      raise exception '% does not hear audio directly and needs a transcriber', v_model.label
        using errcode = 'P0004';
    end if;
  end if;

  end if;

  v_mode := v_config->>'first_message_mode';
  if v_mode is not null and v_mode not in ('agent-first', 'user-first') then
    raise exception 'first_message_mode must be agent-first or user-first, not %', v_mode
      using errcode = 'P0004';
  end if;
  if coalesce(v_mode, 'agent-first') = 'agent-first'
     and coalesce(trim(p_row.first_message), '') = '' then
    raise exception 'first_message is required when the agent speaks first' using errcode = 'P0004';
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
$function$

;

commit;
