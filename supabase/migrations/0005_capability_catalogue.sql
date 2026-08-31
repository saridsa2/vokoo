-- What the platform can actually do, as data.
--
-- Until now this knowledge lived as literals in three places in the console --
-- a PROVIDERS array, a MODELS array, a VOICES array -- plus a hardcoded
-- "Self-hosted" badge on the Compliance tab. They disagreed, which is how an
-- assistant set to Google Gemini could display a green badge asserting that
-- caller audio stays on the operator's own hardware. That is the one claim this
-- product exists to make, and the screen made it falsely.
--
-- One catalogue instead, read by everything: the console renders from it, the
-- publish validation joins against it, and the telephony bridge can resolve
-- against it. Adding a model becomes a row rather than a deploy of three
-- components that then have to agree.
--
-- These tables are global, not organisation-scoped. What a model can do is a
-- property of the model, not of who is using it. Every authenticated user can
-- read them; nobody can write them through the API, because a catalogue an
-- operator can edit is a catalogue that stops describing reality.

create table if not exists public.catalogue_providers (
  id                  text primary key,
  label               text not null,
  summary             text not null,
  -- Where caller audio is processed. The whole DPDP argument reduces to this
  -- column, so it is a column and not a derived guess.
  inference_location  text not null,
  -- True when inference runs on hardware the operator controls. Stored rather
  -- than inferred from `inference_location` so a future self-hosted location
  -- (a second datacentre, an on-premise box) does not have to be special-cased
  -- everywhere the question is asked.
  is_sovereign        boolean not null,
  sort_order          integer not null default 0,
  is_active           boolean not null default true
);

create table if not exists public.catalogue_models (
  id                  text primary key,
  provider_id         text not null references public.catalogue_providers(id) on delete cascade,
  label               text not null,
  summary             text not null,
  -- A native-audio model hears the caller directly: accent, tone and
  -- code-switching survive instead of being flattened into a transcript. It
  -- also means nothing detects the spoken language, which the Transcriber tab
  -- has to say at the point of choosing.
  native_audio        boolean not null default false,
  supports_tools      boolean not null default false,
  supports_structured_output boolean not null default false,
  context_tokens      integer,
  -- 'local' or 'network'. Latency thresholds calibrated for a process on the
  -- operator's own hardware are wrong once there is a hop to a provider.
  latency_class       text not null default 'local',
  sort_order          integer not null default 0,
  is_active           boolean not null default true
);

create table if not exists public.catalogue_voices (
  id                  text primary key,
  provider_id         text not null references public.catalogue_providers(id) on delete cascade,
  label               text not null,
  engine              text not null,
  -- BCP-47-ish tags. Held as an array because the Hindi problem is a
  -- membership test: one shipped engine covers twelve languages and Hindi is
  -- not among them, so the model produces a correct Hindi reply and it is
  -- rendered as noise. That cost a live call to find.
  languages           text[] not null default '{}',
  sort_order          integer not null default 0,
  is_active           boolean not null default true
);

create table if not exists public.catalogue_transcribers (
  id                  text primary key,
  provider_id         text not null references public.catalogue_providers(id) on delete cascade,
  label               text not null,
  summary             text not null,
  -- 'none' is a real option, not the absence of one: with no transcriber the
  -- model receives caller audio directly.
  is_passthrough      boolean not null default false,
  languages           text[] not null default '{}',
  sort_order          integer not null default 0,
  is_active           boolean not null default true
);

alter table public.catalogue_providers    enable row level security;
alter table public.catalogue_models       enable row level security;
alter table public.catalogue_voices       enable row level security;
alter table public.catalogue_transcribers enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'catalogue_providers', 'catalogue_models', 'catalogue_voices', 'catalogue_transcribers'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_read', v_table);
    -- Read-only to every signed-in user, and there is deliberately no insert,
    -- update or delete policy: writes go through migrations.
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      v_table || '_read', v_table
    );
    execute format('grant select on public.%I to authenticated', v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- seed data

insert into public.catalogue_providers (id, label, summary, inference_location, is_sovereign, sort_order)
values
  ('local',  'Local',
   'Inference runs on hardware you control. Caller audio never leaves your infrastructure.',
   'self_hosted', true, 0),
  ('gemini', 'Google Gemini',
   'Caller audio is sent to Google Cloud for processing. Review this against your data protection obligations before using it for patient or customer calls.',
   'google_cloud', false, 1)
on conflict (id) do update set
  label = excluded.label,
  summary = excluded.summary,
  inference_location = excluded.inference_location,
  is_sovereign = excluded.is_sovereign,
  sort_order = excluded.sort_order;

insert into public.catalogue_models
  (id, provider_id, label, summary, native_audio, supports_tools, supports_structured_output, context_tokens, latency_class, sort_order)
values
  ('gemma-4-12b', 'local', 'Gemma 4 12B',
   'Hears caller audio directly. No transcriber needed.', true, false, false, 128000, 'local', 0),
  ('qwen3-4b', 'local', 'Qwen3 4B Instruct',
   'Text model. Needs a transcriber in front of it.', false, true, true, 32768, 'local', 1),
  ('gemini-live-2.5-flash', 'gemini', 'Gemini 2.5 Flash Live',
   'Native audio and function calling, processed by Google.', true, true, true, 1000000, 'network', 0)
on conflict (id) do update set
  provider_id = excluded.provider_id,
  label = excluded.label,
  summary = excluded.summary,
  native_audio = excluded.native_audio,
  supports_tools = excluded.supports_tools,
  supports_structured_output = excluded.supports_structured_output,
  context_tokens = excluded.context_tokens,
  latency_class = excluded.latency_class,
  sort_order = excluded.sort_order;

insert into public.catalogue_voices (id, provider_id, label, engine, languages, sort_order)
values
  ('qwen3:Aiden',      'local',  'Aiden',  'Qwen3-TTS', array['en'],       0),
  ('qwen3:Serena',     'local',  'Serena', 'Qwen3-TTS', array['en'],       1),
  ('kokoro:bm_fable',  'local',  'Fable',  'Kokoro',    array['en-GB'],    2),
  ('kokoro:af_heart',  'local',  'Heart',  'Kokoro',    array['en-US'],    3),
  ('kokoro:hf_alpha',  'local',  'Alpha',  'Kokoro',    array['hi'],       4),
  ('gemini:Aoede',     'gemini', 'Aoede',  'Google',    array['en','hi'],  0),
  ('gemini:Puck',      'gemini', 'Puck',   'Google',    array['en','hi'],  1),
  ('gemini:Charon',    'gemini', 'Charon', 'Google',    array['en','hi'],  2),
  ('gemini:Kore',      'gemini', 'Kore',   'Google',    array['en','hi'],  3)
on conflict (id) do update set
  provider_id = excluded.provider_id,
  label = excluded.label,
  engine = excluded.engine,
  languages = excluded.languages,
  sort_order = excluded.sort_order;

insert into public.catalogue_transcribers (id, provider_id, label, summary, is_passthrough, languages, sort_order)
values
  ('none',     'local',  'None', 'The model hears caller audio directly.', true, array[]::text[], 0),
  ('parakeet', 'local',  'Parakeet TDT', 'Runs locally. 25 European languages.', false, array['en','de','fr','es','it'], 1),
  ('whisper',  'local',  'Whisper', 'Runs locally. Broad multilingual coverage.', false, array['en','hi','de','fr','es'], 2),
  ('none@gemini', 'gemini', 'None', 'Gemini receives caller audio directly; a separate transcriber is not used.', true, array[]::text[], 0)
on conflict (id) do update set
  provider_id = excluded.provider_id,
  label = excluded.label,
  summary = excluded.summary,
  is_passthrough = excluded.is_passthrough,
  languages = excluded.languages,
  sort_order = excluded.sort_order;

-- ------------------------------------------------------- catalogue as one read
--
-- The console needs the whole registry to render a single screen, so it is one
-- function rather than four requests that can arrive out of order and render a
-- provider whose models have not loaded yet.
create or replace function public.capability_catalogue()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'providers', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.sort_order)
      from public.catalogue_providers p where p.is_active
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.sort_order)
      from public.catalogue_models m where m.is_active
    ), '[]'::jsonb),
    'voices', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.sort_order)
      from public.catalogue_voices v where v.is_active
    ), '[]'::jsonb),
    'transcribers', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.sort_order)
      from public.catalogue_transcribers t where t.is_active
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.capability_catalogue() from public;
grant execute on function public.capability_catalogue() to authenticated;

-- ------------------------------------------------- validation against the catalogue
--
-- Replaces the config-only validation from 0004. That version could check that
-- a number was a number; it could not check that a Kokoro voice is impossible
-- on Gemini, because Postgres had no catalogue to check against. It does now.
create or replace function public.validate_assistant_config(p_row public.assistants)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_config  jsonb := coalesce(p_row.config, '{}'::jsonb);
  v_voice   jsonb := coalesce(p_row.voice_config, '{}'::jsonb);
  v_trans   jsonb := coalesce(p_row.transcriber_config, '{}'::jsonb);
  v_mode    text;
  v_model   public.catalogue_models;
  v_voice_id text;
  v_trans_id text;
begin
  if coalesce(trim(p_row.name), '') = '' then
    raise exception 'name is required' using errcode = 'P0004';
  end if;

  if not exists (select 1 from public.catalogue_providers where id = p_row.provider and is_active) then
    raise exception 'unknown provider %', p_row.provider using errcode = 'P0004';
  end if;

  select * into v_model from public.catalogue_models
  where id = p_row.model and is_active;

  if v_model.id is null then
    raise exception 'unknown model %', p_row.model using errcode = 'P0004';
  end if;

  if v_model.provider_id <> p_row.provider then
    raise exception '% is a % model and cannot run on %',
      v_model.label, v_model.provider_id, p_row.provider using errcode = 'P0004';
  end if;

  -- The voice is checked against the provider, not the model. Engine and voice
  -- are one decision: a voice that belongs to a self-hosted engine cannot be
  -- spoken by a remote provider, and publishing that combination would produce
  -- a call where the model replies and nothing renders it.
  v_voice_id := v_voice->>'voice';
  if v_voice_id is not null and v_voice_id <> '' then
    if not exists (
      select 1 from public.catalogue_voices
      where id = v_voice_id and provider_id = p_row.provider and is_active
    ) then
      raise exception 'voice % is not available on %', v_voice_id, p_row.provider
        using errcode = 'P0004';
    end if;
  end if;

  v_trans_id := v_trans->>'provider';
  if v_trans_id is not null and v_trans_id <> '' then
    if not exists (
      select 1 from public.catalogue_transcribers
      where id = v_trans_id and provider_id = p_row.provider and is_active
    ) then
      raise exception 'transcriber % is not available on %', v_trans_id, p_row.provider
        using errcode = 'P0004';
    end if;
  end if;

  -- A text model with nothing transcribing for it receives silence. The call
  -- connects, the caller speaks, and the assistant never answers.
  if not v_model.native_audio then
    if v_trans_id is null or v_trans_id = ''
       or exists (select 1 from public.catalogue_transcribers
                  where id = v_trans_id and is_passthrough) then
      raise exception '% does not hear audio directly and needs a transcriber', v_model.label
        using errcode = 'P0004';
    end if;
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

grant execute on function public.validate_assistant_config(public.assistants) to authenticated;
