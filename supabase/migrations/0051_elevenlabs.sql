-- ElevenLabs as a speaking provider.
--
-- The handler is `src/services/tts/elevenlabs.rs`, behind `tts-elevenlabs`,
-- which is in the crate's default features. It fills the gap the current set
-- leaves: Deepgram Aura is the only non-Indian-language voice, and Piper is the
-- only self-hosted one.
--
-- Models and voices are seeded from what the API offers today and are the first
-- thing model discovery should replace — `bulbul:v2` was seeded the same way on
-- 1 September and Sarvam had retired it, which a caller found out on a live
-- call. Voice ids rather than names, because the id is what the URL takes.

begin;

insert into public.catalogue_vendors (id, label, kind, description, help_url, sort_order) values
  ('elevenlabs', 'ElevenLabs', 'inference',
   'English and multilingual voices, streamed.',
   'https://elevenlabs.io/app/settings/api-keys', 7)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  help_url = excluded.help_url;

insert into public.catalogue_engine_stages
  (id, stage, provider_id, label, tagline, summary, source_path, vendor_id, sort_order, models, voices)
values (
  'tts:elevenlabs', 'tts', 'elevenlabs', 'ElevenLabs', 'English, multilingual',
  'Streamed voices. Turbo is the model worth using on a call; the others are slower than a caller will wait.',
  'src/services/tts/elevenlabs.rs', 'elevenlabs', 3,
  '[{"id":"eleven_turbo_v2_5","label":"Turbo v2.5"},{"id":"eleven_flash_v2_5","label":"Flash v2.5"},{"id":"eleven_multilingual_v2","label":"Multilingual v2"}]'::jsonb,
  '[{"id":"21m00Tcm4TlvDq8ikWAM","label":"Rachel"},{"id":"EXAVITQu4vr4xnSDxMaL","label":"Sarah"},{"id":"FGY2WhTYpPnrIDTdsKH5","label":"Laura"},{"id":"IKne3meq5aSn9XLyUdCD","label":"Charlie"},{"id":"JBFqnCBsd6RMkjVDRZzb","label":"George"},{"id":"XB0fDUnXU5powFXDhCwa","label":"Charlotte"},{"id":"cgSgspJ2msm6clMCkdW9","label":"Jessica"},{"id":"pFZP5JQG7iQjIQuC4Bku","label":"Lily"}]'::jsonb
)
on conflict (id) do update set
  models = excluded.models,
  voices = excluded.voices,
  summary = excluded.summary,
  source_path = excluded.source_path,
  vendor_id = excluded.vendor_id;

commit;
