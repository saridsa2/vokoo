-- The vendors an engine can need a key for.
--
-- `catalogue_vendors` had two rows — Gemini and KooKoo — because those were the
-- only two the call path had ever used. An engine built on Sarvam or Deepgram
-- resolves its key with `resolve_vendor_secret(org, vendor)` like every other
-- provider does, and with no catalogue row the console has no way to offer
-- connecting one. The engine would save, list, publish, and fail at connect.
--
-- Piper is deliberately absent: it runs from model files on the server and has
-- no account to connect.

begin;

insert into public.catalogue_vendors (id, label, kind, description, help_url, sort_order) values
  ('openai',   'OpenAI',   'inference',
   'Chat models and the Realtime API. Any OpenAI-compatible endpoint uses this key, including a model on your own hardware.',
   'https://platform.openai.com/api-keys', 2),
  ('deepgram', 'Deepgram', 'inference',
   'English transcription and voices.',
   'https://console.deepgram.com', 3),
  ('sarvam',   'Sarvam',   'inference',
   'Indian-language transcription, models and voices, including code-mixed speech.',
   'https://dashboard.sarvam.ai', 4),
  ('gnani',    'Gnani',    'inference',
   'Indian-language transcription.',
   null, 5),
  ('sixtydb',  'SixtyDB',  'inference',
   'Indian-language transcription.',
   null, 6)
on conflict (id) do update set
  label = excluded.label,
  kind = excluded.kind,
  description = excluded.description,
  help_url = excluded.help_url,
  sort_order = excluded.sort_order;

-- Which vendor each step of an engine bills to. Nullable, because a step that
-- runs on your own hardware needs no account — that is the whole difference
-- between Piper and the rest.
alter table public.catalogue_engine_stages
  add column if not exists vendor_id text;

update public.catalogue_engine_stages set vendor_id = v.vendor from (values
  ('realtime:gemini', 'gemini'),
  ('realtime:openai', 'openai'),
  ('stt:sarvam',      'sarvam'),
  ('stt:deepgram',    'deepgram'),
  ('stt:gnani',       'gnani'),
  ('stt:sixtydb',     'sixtydb'),
  ('llm:openai',      'openai'),
  ('llm:sarvam',      'sarvam'),
  ('tts:sarvam',      'sarvam'),
  ('tts:deepgram',    'deepgram')
) as v(id, vendor) where catalogue_engine_stages.id = v.id;

commit;
