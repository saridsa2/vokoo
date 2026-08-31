-- A short form for controls, beside the long form for prose.
--
-- 0005 gave every catalogue row one `summary`, and the console used it in both
-- places. In a dropdown item and on the Compliance row that reads correctly. In
-- a select trigger it does not: the provider control ended up 532px wide
-- holding 165 characters of data-protection guidance, with the provider's own
-- name pushed out of view. The neighbouring control held 22 characters.
--
-- So: `tagline` is what a control can show — two or three words, no sentence.
-- `summary` stays the sentence, for the places with room to read one. One field
-- serving both jobs meant it did neither.

alter table public.catalogue_providers    add column if not exists tagline text;
alter table public.catalogue_models       add column if not exists tagline text;
alter table public.catalogue_transcribers add column if not exists tagline text;

update public.catalogue_providers set tagline = case id
  when 'local'  then 'Self-hosted'
  when 'gemini' then 'Google Cloud'
  else label
end;

update public.catalogue_models set tagline = case id
  when 'gemma-4-12b'           then 'Native audio · no transcriber'
  when 'qwen3-4b'              then 'Needs a transcriber'
  when 'gemini-live-2.5-flash' then 'Native audio · tools'
  else label
end;

update public.catalogue_transcribers set tagline = case id
  when 'none'        then 'Model hears audio directly'
  when 'parakeet'    then 'Local · 25 European languages'
  when 'whisper'     then 'Local · broad multilingual'
  when 'none@gemini' then 'Model hears audio directly'
  else label
end;

-- Backfill anything a future insert forgets, so a control can always render
-- something short rather than falling back to the paragraph.
update public.catalogue_providers    set tagline = label where tagline is null or tagline = '';
update public.catalogue_models       set tagline = label where tagline is null or tagline = '';
update public.catalogue_transcribers set tagline = label where tagline is null or tagline = '';

alter table public.catalogue_providers    alter column tagline set not null;
alter table public.catalogue_models       alter column tagline set not null;
alter table public.catalogue_transcribers alter column tagline set not null;

-- A tagline long enough to need truncation is not a tagline. Enforced rather
-- than documented, because the failure is silent: it renders, it just renders
-- badly, and nobody notices until a screenshot.
alter table public.catalogue_providers
  add constraint catalogue_providers_tagline_short check (length(tagline) <= 40);
alter table public.catalogue_models
  add constraint catalogue_models_tagline_short check (length(tagline) <= 40);
alter table public.catalogue_transcribers
  add constraint catalogue_transcribers_tagline_short check (length(tagline) <= 40);
