-- What a call cost, and what each engine costs to run.
--
-- The usage half of this already existed and was switched off. rustvani carries
-- a `BillingCollector` trait, a `SessionBilling` accumulator with a background
-- drain, a `BillingStorage` back-end and per-provider instrumentation in
-- openai, sarvam, deepgram and gnani — all compiled into the running binary
-- (`db-postgres` is in `default`), and all receiving `None` because the bridge
-- never supplied a collector. Nothing here re-implements that. These are the
-- tables it writes into, plus the part it has no opinion about: price.
--
-- The two `billing_*` tables match rustvani's own `SCHEMA_SQL` column for
-- column, so its INSERTs work unchanged. They are declared here rather than
-- left to its `run_migrations` so they are versioned with every other table and
-- carry the row-level security every other table carries — an upstream
-- `CREATE TABLE IF NOT EXISTS` would have made them the only tables in the
-- database readable by anyone who reached PostgREST.

-- ---------------------------------------------------------------- usage

create table if not exists public.billing_sessions (
    session_id         uuid        primary key,
    started_at         timestamptz,
    ended_at           timestamptz,
    duration_secs      float8,
    finish_reason      text,
    llm_input_tokens   integer     not null default 0,
    llm_output_tokens  integer     not null default 0,
    llm_calls          integer     not null default 0,
    tts_chars          integer     not null default 0,
    tts_calls          integer     not null default 0,
    stt_audio_ms       float8      not null default 0,
    stt_calls          integer     not null default 0,
    metadata           jsonb       not null default '{}',
    transcript_json    jsonb       not null default '[]',
    -- 'active' (in flight, not yet billable), 'complete' (clean end, exact),
    -- 'crashed' (settled at the last checkpoint).
    status             text        not null default 'active',
    last_checkpoint_at timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    -- Derived rather than written, because the writer is upstream code that
    -- knows nothing about organisations. It sets `metadata`; this reads the
    -- tenant out of it so row-level security has a column to stand on.
    org_id uuid generated always as ((metadata ->> 'org_id')::uuid) stored,
    -- Likewise the engine, which is the dimension "cost per engine" needs.
    engine_id uuid generated always as ((metadata ->> 'engine_id')::uuid) stored
);

create table if not exists public.billing_events (
    id                bigserial   primary key,
    -- Assigned by the drain task, which is what makes a retried checkpoint
    -- idempotent rather than a double charge.
    event_id          uuid,
    session_id        uuid        not null references public.billing_sessions(session_id) on delete cascade,
    event_type        text        not null,
    provider          text,
    model             text,
    input_tokens      integer,
    output_tokens     integer,
    estimated         boolean,
    char_count        integer,
    voice             text,
    audio_duration_ms float8,
    occurred_at       timestamptz not null,
    raw_json          jsonb
);

create index if not exists billing_sessions_started_at on public.billing_sessions (started_at);
create index if not exists billing_sessions_status     on public.billing_sessions (status, last_checkpoint_at);
create index if not exists billing_sessions_org        on public.billing_sessions (org_id, started_at desc);
create index if not exists billing_sessions_engine     on public.billing_sessions (engine_id, started_at desc);
create unique index if not exists billing_events_event_id   on public.billing_events (event_id);
create index if not exists billing_events_session_id        on public.billing_events (session_id);
create index if not exists billing_events_occurred_at       on public.billing_events (occurred_at);

alter table public.billing_sessions enable row level security;
alter table public.billing_events   enable row level security;

drop policy if exists org_member_access on public.billing_sessions;
create policy org_member_access on public.billing_sessions
    using (is_org_member(org_id)) with check (is_org_member(org_id));

-- An event has no org of its own; it belongs to whoever owns the session.
drop policy if exists org_member_access on public.billing_events;
create policy org_member_access on public.billing_events
    using (exists (
        select 1 from public.billing_sessions s
        where s.session_id = billing_events.session_id and is_org_member(s.org_id)
    ));

-- ---------------------------------------------------------------- price

-- What a vendor charges, per unit of the thing it actually meters.
--
-- No two vendors meter the same way: OpenAI bills tokens in and out
-- separately, ElevenLabs and Sarvam bill characters of synthesised text,
-- transcription bills audio duration, and the carrier bills the call. So the
-- unit is part of the rate rather than assumed.
--
-- `model` null means "any model this vendor runs for this unit". An exact
-- match wins over it, so a rate card can start coarse and get specific without
-- rewriting anything.
create table if not exists public.catalogue_vendor_rates (
    id             uuid primary key default gen_random_uuid(),
    vendor_id      text not null references public.catalogue_vendors(id) on delete cascade,
    -- 'stt' | 'llm' | 'tts' | 'realtime' | 'carrier'
    stage          text not null,
    model          text,
    unit           text not null check (unit in (
                       'input_token', 'output_token', 'character',
                       'audio_second', 'call_second')),
    -- Null means nobody has entered a price. Deliberately distinct from zero:
    -- a call priced at nothing and a call nobody has priced are different
    -- facts, and reporting the second as the first is how an invoice goes out
    -- wrong. Every view below preserves that distinction.
    rate_per_unit  numeric(20, 10),
    currency       text not null default 'USD',
    effective_from date not null default current_date,
    notes          text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create unique index if not exists vendor_rates_unique
    on public.catalogue_vendor_rates (vendor_id, stage, coalesce(model, ''), unit, effective_from);

alter table public.catalogue_vendor_rates enable row level security;
drop policy if exists catalogue_vendor_rates_read on public.catalogue_vendor_rates;
create policy catalogue_vendor_rates_read on public.catalogue_vendor_rates
    for select to authenticated using (true);

-- The rows our engines actually consume, left **unpriced on purpose**.
--
-- Seeding real numbers here would mean writing prices from memory into a table
-- that produces invoices. Every one of these needs a figure read off the
-- vendor's own pricing page and entered deliberately; until then the views
-- below report the call as unpriced rather than as free.
insert into public.catalogue_vendor_rates (vendor_id, stage, unit, notes) values
    ('openai',     'llm',      'input_token',  'openai.com/api/pricing — per 1M input tokens, divided by 1e6'),
    ('openai',     'llm',      'output_token', 'openai.com/api/pricing — per 1M output tokens, divided by 1e6'),
    ('openai',     'realtime', 'input_token',  'openai.com/api/pricing — realtime audio input'),
    ('openai',     'realtime', 'output_token', 'openai.com/api/pricing — realtime audio output'),
    ('gemini',     'realtime', 'input_token',  'ai.google.dev/pricing — Live API input'),
    ('gemini',     'realtime', 'output_token', 'ai.google.dev/pricing — Live API output'),
    ('sarvam',     'stt',      'audio_second', 'sarvam.ai pricing — transcription, per second of audio'),
    ('sarvam',     'tts',      'character',    'sarvam.ai pricing — per character synthesised'),
    ('deepgram',   'stt',      'audio_second', 'deepgram.com/pricing — per second of audio'),
    ('deepgram',   'tts',      'character',    'deepgram.com/pricing — per character synthesised'),
    ('elevenlabs', 'tts',      'character',    'elevenlabs.io/pricing — per character; credits convert per plan'),
    ('kookoo',     'carrier',  'call_second',  'the Ozonetel contract — per second of connected call')
on conflict do nothing;

-- ---------------------------------------------------------------- cost

-- Every billable quantity, one row per (event, unit).
--
-- An LLM round bills twice at two different rates, so a table with one cost
-- column per event cannot express it. Splitting into units first makes pricing
-- a single join and adding a unit a single `union all`.
create or replace view public.billing_usage as
    select session_id, provider, model, 'input_token'::text as unit,
           input_tokens::numeric as quantity, occurred_at
      from public.billing_events where coalesce(input_tokens, 0) > 0
    union all
    select session_id, provider, model, 'output_token',
           output_tokens::numeric, occurred_at
      from public.billing_events where coalesce(output_tokens, 0) > 0
    union all
    select session_id, provider, coalesce(model, voice), 'character',
           char_count::numeric, occurred_at
      from public.billing_events where coalesce(char_count, 0) > 0
    union all
    select session_id, provider, model, 'audio_second',
           (audio_duration_ms / 1000.0)::numeric, occurred_at
      from public.billing_events where coalesce(audio_duration_ms, 0) > 0;

-- Usage with a price against it, where one exists.
--
-- The rate is chosen by the most specific row that applies: an exact model
-- match first, then the vendor's catch-all for that unit. `is_priced` says
-- which rows carry a real figure, and it is the column that stops an unpriced
-- vendor from quietly reading as free.
create or replace view public.billing_priced_usage as
    select u.session_id,
           u.provider,
           u.model,
           u.unit,
           u.quantity,
           u.occurred_at,
           r.rate_per_unit,
           r.currency,
           (r.rate_per_unit is not null) as is_priced,
           u.quantity * r.rate_per_unit  as cost
      from public.billing_usage u
      left join lateral (
          select rate.rate_per_unit, rate.currency
            from public.catalogue_vendor_rates rate
           where rate.vendor_id = u.provider
             and rate.unit = u.unit
             and (rate.model is null or rate.model = u.model)
           order by (rate.model is not null) desc, rate.effective_from desc
           limit 1
      ) r on true;

-- What one call cost, per currency.
--
-- Per currency because vendors bill in their own and nothing here converts:
-- an exchange rate nobody supplied is a number this file would be inventing,
-- and a wrong total is worse than two right subtotals.
create or replace view public.call_costs as
    select s.session_id,
           s.org_id,
           s.engine_id,
           s.started_at,
           s.status,
           coalesce(p.currency, 'USD')          as currency,
           sum(p.cost)                          as cost,
           count(*) filter (where not p.is_priced) as unpriced_items,
           -- Named so a reader knows which vendors to go and price.
           array_agg(distinct p.provider) filter (where not p.is_priced) as unpriced_vendors
      from public.billing_sessions s
      join public.billing_priced_usage p on p.session_id = s.session_id
     group by s.session_id, s.org_id, s.engine_id, s.started_at, s.status, coalesce(p.currency, 'USD');

-- What each engine costs to run, which is the question that decides whether a
-- relay is worth its extra hops.
create or replace view public.engine_costs as
    select e.id   as engine_id,
           e.org_id,
           e.name as engine_name,
           e.mode,
           c.currency,
           count(distinct c.session_id)                     as calls,
           sum(c.cost)                                      as total_cost,
           avg(c.cost)                                      as cost_per_call,
           sum(s.duration_secs)                             as total_seconds,
           -- The comparable number: two engines with different call lengths
           -- are only comparable per minute of conversation.
           case when sum(s.duration_secs) > 0
                then sum(c.cost) / (sum(s.duration_secs) / 60.0) end as cost_per_minute,
           sum(c.unpriced_items)                            as unpriced_items
      from public.engines e
      join public.call_costs c       on c.engine_id = e.id
      join public.billing_sessions s on s.session_id = c.session_id
     group by e.id, e.org_id, e.name, e.mode, c.currency;

grant select on public.billing_usage, public.billing_priced_usage,
                public.call_costs, public.engine_costs to authenticated;
