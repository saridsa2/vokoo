-- A short form for the select trigger.
--
-- `catalogue_providers` and `catalogue_models` both carry a tagline of two or
-- three words beside the sentence, because a select trigger renders the label
-- and its supporting text on one line: a sentence there pushes the label out of
-- view, which is what the engine builder did on its first render.

begin;

alter table public.catalogue_engine_stages
  add column if not exists tagline text not null default '';

update public.catalogue_engine_stages set tagline = v.tagline
from (values
  ('realtime:gemini', 'Google Cloud'),
  ('realtime:openai', 'Untested'),
  ('stt:sarvam',      'Indian languages'),
  ('stt:deepgram',    'English'),
  ('stt:gnani',       'Indian languages'),
  ('stt:sixtydb',     'Indian languages'),
  ('llm:openai',      'Any OpenAI API'),
  ('llm:sarvam',      'Indian languages'),
  ('tts:sarvam',      'Indian languages'),
  ('tts:deepgram',    'English'),
  ('tts:piper',       'Self-hosted')
) as v(id, tagline)
where catalogue_engine_stages.id = v.id;

commit;
