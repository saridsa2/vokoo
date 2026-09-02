-- The four engine stages join the catalogue they were always described as
-- being in.
--
-- CLAUDE.md says "The four `engine.*` node types are `is_addable: false`, so
-- the flow palette never offers them" — true of the console, and the console
-- was the only place they existed. They were never rows. The engine board drew
-- four nodes the database had never heard of, which is why `catalogue:check`
-- reported 24 node types on disk against 19 in the table.
--
-- Copied from `docs/flow-node-catalogue.json` rather than rewritten, so the
-- first sync after this is a no-op for them: the point is to move the
-- authority, not to change what an engine board draws.
insert into catalogue_node_types
  (id, node_type, label, description, provider_action, outcomes, fields,
   sort_order, is_active, suspends, is_addable, families)
values
  ('engine.listening', 'engine', 'Speech to text', 'Turns caller audio into text.', null, '[{"id": "next", "label": "transcript"}]'::jsonb, '[{"key": "provider", "label": "Provider", "type": "engine_provider", "required": true}, {"key": "model", "label": "Model", "type": "engine_model", "required": false}, {"key": "language", "label": "Language", "type": "text", "required": false, "hint": "BCP-47, e.g. hi-IN."}]'::jsonb, 100, true, false, false, '{engine}'::text[]),
  ('engine.realtime', 'engine', 'Speech to speech', 'One model receives caller audio and answers in speech. No transcript in between.', null, '[{"id": "next", "label": "audio"}]'::jsonb, '[{"key": "provider", "label": "Provider", "type": "engine_provider", "required": true}, {"key": "model", "label": "Model", "type": "engine_model", "required": false}, {"key": "voice", "label": "Voice", "type": "engine_voice", "required": false}, {"key": "temperature", "label": "Temperature", "type": "number", "required": false, "hint": "0\u20132. Lower stays on script."}, {"key": "max_tokens", "label": "Max reply tokens", "type": "number", "required": false, "hint": "Too low truncates replies mid-sentence."}]'::jsonb, 100, true, false, false, '{engine}'::text[]),
  ('engine.speaking', 'engine', 'Text to speech', 'Turns the reply into audio.', null, '[{"id": "next", "label": "audio"}]'::jsonb, '[{"key": "provider", "label": "Provider", "type": "engine_provider", "required": true}, {"key": "model", "label": "Model", "type": "engine_model", "required": false}, {"key": "voice", "label": "Voice", "type": "engine_voice", "required": false}]'::jsonb, 100, true, false, false, '{engine}'::text[]),
  ('engine.thinking', 'engine', 'Language model', 'Reads the transcript and decides what to say and which tools to call.', null, '[{"id": "next", "label": "reply text"}]'::jsonb, '[{"key": "provider", "label": "Provider", "type": "engine_provider", "required": true}, {"key": "model", "label": "Model", "type": "engine_model", "required": false}, {"key": "temperature", "label": "Temperature", "type": "number", "required": false, "hint": "0\u20132. Lower stays on script."}, {"key": "max_tokens", "label": "Max reply tokens", "type": "number", "required": false, "hint": "Too low truncates replies mid-sentence."}]'::jsonb, 100, true, false, false, '{engine}'::text[])
on conflict (id) do nothing;
