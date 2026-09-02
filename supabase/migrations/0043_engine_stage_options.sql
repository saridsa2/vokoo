-- What each step of an engine can be set to.
--
-- The engine builder offered models from `catalogue_models`, which describes
-- models an *agent* can run on: two Gemini entries and two local ones. A relay
-- step on Deepgram or Sarvam therefore had an empty, disabled Model select, and
-- the engine could not be finished in the console at all.
--
-- These belong here rather than in `catalogue_models` because they are not the
-- same kind of thing. `catalogue_models` rows carry `native_audio`,
-- `supports_tools` and `latency_class`, and the agent capability rules read
-- them; a transcriber model and a voice model have none of those properties,
-- and adding them there would put "nova-3" in the agent's model list.
--
-- Values are taken from the crate, not invented: the speaker lists are
-- `V2_SPEAKERS` / `V3_SPEAKERS` in `src/services/tts/sarvam.rs`, the defaults are
-- each config's `Default::default()`. The first entry of each list is what
-- `src/vokoo/engine.rs` falls back to when an engine leaves the field empty.

begin;

alter table public.catalogue_engine_stages
  add column if not exists models jsonb not null default '[]'::jsonb,
  add column if not exists voices jsonb not null default '[]'::jsonb;

comment on column public.catalogue_engine_stages.models is
  'Options for this step''s model field: [{"id","label"}]. Empty means the field is free text.';
comment on column public.catalogue_engine_stages.voices is
  'Options for this step''s voice field: [{"id","label"}]. Empty hides the field.';

update public.catalogue_engine_stages set models = v.models, voices = v.voices
from (values
  ('stt:deepgram',
   '[{"id":"nova-3","label":"Nova 3"},{"id":"nova-2","label":"Nova 2"},{"id":"enhanced","label":"Enhanced"},{"id":"base","label":"Base"}]'::jsonb,
   '[]'::jsonb),

  ('stt:sarvam',
   '[{"id":"saaras:v3","label":"Saaras v3"},{"id":"saarika:v2.5","label":"Saarika v2.5 (legacy)"},{"id":"saaras:v2.5","label":"Saaras v2.5 (legacy)"}]'::jsonb,
   '[]'::jsonb),

  -- Gnani and SixtyDB take a language, not a model choice.
  ('stt:gnani',   '[]'::jsonb, '[]'::jsonb),
  ('stt:sixtydb', '[]'::jsonb, '[]'::jsonb),

  ('llm:openai',
   '[{"id":"gpt-4.1-mini","label":"GPT-4.1 mini"},{"id":"gpt-4.1","label":"GPT-4.1"},{"id":"gpt-4o-mini","label":"GPT-4o mini"},{"id":"gpt-4o","label":"GPT-4o"}]'::jsonb,
   '[]'::jsonb),

  ('llm:sarvam',
   '[{"id":"sarvam-30b","label":"Sarvam 30B"},{"id":"sarvam-m","label":"Sarvam M"},{"id":"sarvam-105b","label":"Sarvam 105B"}]'::jsonb,
   '[]'::jsonb),

  ('tts:deepgram',
   '[]'::jsonb,
   '[{"id":"aura-2-helena-en","label":"Helena"},{"id":"aura-2-thalia-en","label":"Thalia"},{"id":"aura-2-andromeda-en","label":"Andromeda"},{"id":"aura-2-apollo-en","label":"Apollo"},{"id":"aura-2-arcas-en","label":"Arcas"}]'::jsonb),

  ('tts:sarvam',
   '[{"id":"bulbul:v2","label":"Bulbul v2"},{"id":"bulbul:v3","label":"Bulbul v3"},{"id":"bulbul:v3-beta","label":"Bulbul v3 beta"}]'::jsonb,
   '[{"id":"anushka","label":"Anushka"},{"id":"manisha","label":"Manisha"},{"id":"vidya","label":"Vidya"},{"id":"arya","label":"Arya"},{"id":"abhilash","label":"Abhilash"},{"id":"karun","label":"Karun"},{"id":"hitesh","label":"Hitesh"}]'::jsonb),

  -- Piper picks its voice from the model files on disk, so there is nothing to
  -- choose here until the server says which ones it has.
  ('tts:piper', '[]'::jsonb, '[]'::jsonb)
) as v(id, models, voices)
where catalogue_engine_stages.id = v.id;

-- Realtime steps keep using `catalogue_models` and `catalogue_voices`: a
-- realtime model is a model an agent runs on, which is exactly what those two
-- tables describe.

commit;
