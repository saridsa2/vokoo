-- Sarvam retired `bulbul:v2`, and v3 has different speakers.
--
-- Seeded from the crate's `Default::default()`, which still names v2. On a real
-- call Sarvam answered:
--
--   400: Model 'bulbul:v2' has been deprecated. Please use 'bulbul:v3' instead.
--
-- Nothing was synthesised and the caller heard silence, while every other step
-- of the relay worked. So v2 is withdrawn rather than left as an option that
-- fails only when somebody is on the line.
--
-- The speaker list changes with the model, which this table cannot express: it
-- holds one set of voices per (stage, provider). Both v3 models share the
-- V3_SPEAKERS list in `src/services/tts/sarvam.rs`, so with v2 gone the single
-- list is correct again. If a fourth model arrives with its own speakers, this
-- needs to become voices-per-model.

begin;

update public.catalogue_engine_stages set
  models = '[{"id":"bulbul:v3","label":"Bulbul v3"},{"id":"bulbul:v3-beta","label":"Bulbul v3 beta"}]'::jsonb,
  voices = '[{"id":"priya","label":"Priya"},{"id":"ritu","label":"Ritu"},{"id":"neha","label":"Neha"},{"id":"kavya","label":"Kavya"},{"id":"ishita","label":"Ishita"},{"id":"shreya","label":"Shreya"},{"id":"simran","label":"Simran"},{"id":"roopa","label":"Roopa"},{"id":"aditya","label":"Aditya"},{"id":"rahul","label":"Rahul"},{"id":"rohan","label":"Rohan"},{"id":"amit","label":"Amit"},{"id":"varun","label":"Varun"},{"id":"kabir","label":"Kabir"}]'::jsonb
where id = 'tts:sarvam';

-- The engine that just failed, moved onto a model that exists and a speaker
-- that exists on it.
update public.engines
   set config = jsonb_set(
                  jsonb_set(config, '{tts,model}', '"bulbul:v3"'),
                  '{tts,voice}', '"priya"')
 where slug = 'hindi-relay';

commit;
