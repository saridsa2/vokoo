-- The id we show is not the id the provider wants.
--
-- `gemini-live-2.5-flash` is what a person picks from a list. Google's socket
-- wants `models/gemini-live-2.5-flash-preview`, and that string changes when
-- Google renames a preview — which should be a row edit, not a bridge deploy.
--
-- Kept separate rather than overloading `id`, because `id` is a foreign key in
-- every published agent and every version snapshot. A provider renaming its
-- model must not rewrite our history.

alter table public.catalogue_models add column if not exists provider_model_id text;

update public.catalogue_models set provider_model_id = case id
  when 'gemini-live-2.5-flash' then 'models/gemini-live-2.5-flash-preview'
  else id
end
where provider_model_id is null;

alter table public.catalogue_models alter column provider_model_id set not null;

-- Where a provider's realtime socket lives. Null means "the operator's own
-- stack", whose address is deployment configuration rather than a property of
-- the provider — a self-hosted endpoint moves with the hardware.
alter table public.catalogue_providers add column if not exists realtime_url text;

update public.catalogue_providers set realtime_url =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
where id = 'gemini';
