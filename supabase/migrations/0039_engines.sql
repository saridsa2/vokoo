-- Engines: how speech is made.
--
-- An engine is the chain a call runs through. Two shapes exist in rustvani and
-- nothing in the product could choose between them:
--
--   realtime   one model that hears and speaks — Gemini Live, OpenAI Realtime
--   cascading  a relay: speech to text, a model that decides, text to speech
--
-- Until now this was `PIPELINE_MODE` plus a handful of environment variables,
-- read once at process start and identical for every call. Which also meant the
-- model id lived in three places that could disagree — `agents.model`,
-- `LIVE_MODEL` in bridge.env, and a hardcoded fallback in Rust. On 31 August all
-- three said one thing while `catalogue_models` had no such row, and the console
-- showed "Unknown model" over a call path that worked.
--
-- The composition is data; the implementations stay in the binary. That is the
-- same division `catalogue_node_types` already uses for the flow vocabulary: a
-- new engine built from providers rustvani has is a row and needs no deploy, and
-- a new provider is a change to rustvani.

begin;

create table if not exists public.engines (
  id          uuid default gen_random_uuid()
              constraint engines_pkey primary key,
  org_id      uuid not null
              constraint engines_org_id_fkey
              references public.organizations(id) on delete cascade,
  name        text not null,
  slug        text not null,
  description text not null default '',
  mode        text not null,
  -- The composition. For `realtime`: `{"realtime": {"provider", "model", "voice"}}`.
  -- For `cascading`: `{"stt": {…}, "llm": {…}, "tts": {…}, "vad": {…}}`.
  -- Shapeless on purpose — the stages a mode has are rustvani's business, and a
  -- column per stage would need a migration every time one is added.
  config      jsonb not null default '{}'::jsonb,
  status      text not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint engines_mode_check check (mode in ('realtime', 'cascading')),
  constraint engines_status_check check (status in ('draft', 'published')),
  constraint engines_org_id_slug_key unique (org_id, slug)
);

alter table public.engines enable row level security;
drop policy if exists org_member_access on public.engines;
create policy org_member_access on public.engines for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
grant select, insert, update, delete on public.engines to authenticated;

drop trigger if exists set_engines_updated_at on public.engines;
create trigger set_engines_updated_at
  before update on public.engines
  for each row execute function public.set_updated_at();

-- An agent runs on one engine. Nullable, because an agent that names none keeps
-- the behaviour it has today: whatever the bridge's environment says. Removing
-- that fallback before every agent has an engine would take the phone down.
alter table public.agents
  add column if not exists engine_id uuid
  constraint agents_engine_id_fkey references public.engines(id) on delete set null;

comment on column public.agents.engine_id is
  'How this agent hears and speaks. Null falls back to the bridge environment.';

-- The engine that describes what is already running, so the first call after
-- this reads from the database rather than from env and behaves identically.
insert into public.engines (org_id, name, slug, description, mode, config, status)
select
  o.id,
  'Gemini Live (native audio)',
  'gemini-live-native-audio',
  'One model that hears and speaks. Lowest latency, and the only shape that currently calls tools.',
  'realtime',
  jsonb_build_object('realtime', jsonb_build_object(
    'provider', 'gemini',
    -- What `LIVE_MODEL` and `LIVE_VOICE` hold on the server as this is written.
    -- The seed has to match, or moving the choice into the database would change
    -- the model the phone answers on as a side effect of a migration.
    'model', 'gemini-3.1-flash-live-preview',
    'voice', 'Aoede'
  )),
  'published'
from public.organizations o
on conflict (org_id, slug) do nothing;

-- Every agent that has no engine gets the one that matches what it is doing.
update public.agents a
   set engine_id = e.id
  from public.engines e
 where e.org_id = a.org_id
   and e.slug = 'gemini-live-native-audio'
   and a.engine_id is null;

commit;
