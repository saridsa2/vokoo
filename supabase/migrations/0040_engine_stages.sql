-- What an engine can be built out of.
--
-- `engines.config` is shapeless on purpose, which leaves the console with no
-- way to know that "deepgram" is a transcriber rustvani has and "whisper" is
-- not. Offering a provider the binary cannot construct produces an engine that
-- looks fine in the list and fails at connect time on a real call.
--
-- So the stages are a catalogue, next to the ones that already describe models,
-- voices and node types. A row here is a claim that `src/services/<stage>/`
-- contains that provider. Adding a provider to rustvani adds a row; nothing
-- here creates a capability on its own.

begin;

create table if not exists public.catalogue_engine_stages (
  -- '<stage>:<provider>', e.g. 'stt:deepgram'.
  id          text primary key,
  -- Which position in the chain. 'realtime' is the whole chain by itself.
  stage       text not null,
  provider_id text not null,
  label       text not null,
  -- What choosing this costs the reader: where audio goes, what it needs.
  summary     text not null default '',
  -- The module in rustvani that implements it, so a reader can check the claim.
  source_path text not null default '',
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  constraint catalogue_engine_stages_stage_check
    check (stage in ('realtime', 'stt', 'llm', 'tts'))
);

-- The catalogue is the same for every organisation and carries no customer
-- data, so it is readable by any signed-in user and writable by nobody.
alter table public.catalogue_engine_stages enable row level security;
drop policy if exists catalogue_read on public.catalogue_engine_stages;
create policy catalogue_read on public.catalogue_engine_stages for select to authenticated using (true);
grant select on public.catalogue_engine_stages to authenticated;

insert into public.catalogue_engine_stages (id, stage, provider_id, label, summary, source_path, sort_order) values
  ('realtime:gemini', 'realtime', 'gemini', 'Gemini Live',
   'One model hears and speaks. Lowest latency, and the shape currently wired to the phone.',
   'src/services/realtime/gemini.rs', 0),
  ('realtime:openai', 'realtime', 'openai', 'OpenAI Realtime',
   'One model hears and speaks. Written but never exercised on a call.',
   'src/services/realtime/openai.rs', 1),

  ('stt:sarvam',   'stt', 'sarvam',   'Sarvam',   'Indian languages, including code-mixed speech.', 'src/services/stt/sarvam.rs', 0),
  ('stt:deepgram', 'stt', 'deepgram', 'Deepgram', 'Fast English transcription.',                    'src/services/stt/deepgram.rs', 1),
  ('stt:gnani',    'stt', 'gnani',    'Gnani',    'Indian languages.',                              'src/services/stt/gnani.rs', 2),
  ('stt:sixtydb',  'stt', 'sixtydb',  'SixtyDB',  'Indian languages.',                              'src/services/stt/sixtydb.rs', 3),

  ('llm:openai', 'llm', 'openai', 'OpenAI-compatible',
   'Any endpoint that speaks the chat completions API, including a model on your own hardware.',
   'src/services/llm/openai.rs', 0),
  ('llm:sarvam', 'llm', 'sarvam', 'Sarvam', 'Indian-language models.', 'src/services/llm/sarvam.rs', 1),

  ('tts:sarvam',   'tts', 'sarvam',   'Sarvam',   'Indian-language voices.',                'src/services/tts/sarvam.rs', 0),
  ('tts:deepgram', 'tts', 'deepgram', 'Deepgram', 'English voices.',                        'src/services/tts/deepgram.rs', 1),
  ('tts:piper',    'tts', 'piper',    'Piper',    'Runs on your own hardware. No audio leaves it.', 'src/services/tts/piper.rs', 2)
on conflict (id) do update set
  stage = excluded.stage,
  provider_id = excluded.provider_id,
  label = excluded.label,
  summary = excluded.summary,
  source_path = excluded.source_path,
  sort_order = excluded.sort_order;

-- Carried on the same endpoint as the rest of the catalogue, so the console
-- makes one request rather than one per vocabulary.
create or replace function public.capability_catalogue()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
                           from public.catalogue_providers p where p.is_active), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order)
                        from public.catalogue_models m where m.is_active), '[]'::jsonb),
    'voices', coalesce((select jsonb_agg(to_jsonb(v) order by v.sort_order)
                        from public.catalogue_voices v where v.is_active), '[]'::jsonb),
    'transcribers', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order)
                              from public.catalogue_transcribers t where t.is_active), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order)
                         from public.catalogue_vendors c where c.is_active), '[]'::jsonb),
    'nodeTypes', coalesce((select jsonb_agg(to_jsonb(n) order by n.sort_order)
                           from public.catalogue_node_types n where n.is_active), '[]'::jsonb),
    'engineStages', coalesce((select jsonb_agg(to_jsonb(s) order by s.stage, s.sort_order)
                              from public.catalogue_engine_stages s where s.is_active), '[]'::jsonb)
  );
$function$;

commit;
