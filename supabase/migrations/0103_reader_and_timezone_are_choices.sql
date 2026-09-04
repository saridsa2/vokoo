-- Two settings that accept any string and must not.
--
-- ## Timezone
--
-- `organizations.timezone` is free text with no constraint. It is also the
-- definition of "today" for the whole workspace: opening hours in `runner.rs`,
-- the dashboard's daily counts, the boundary of a billing period.
--
-- `IST` or `asia/kolkata` is not rejected anywhere. A `business_hours` node
-- then takes the wrong branch and a caller at nine at night is told the clinic
-- is open. Nothing errors; somebody turns up at a closed door.
--
-- Postgres already knows every valid zone, so the check is a lookup rather than
-- a list we maintain.
--
-- ## Reader
--
-- `intelligence_provider` and `intelligence_model` are free text too, and were
-- read-only in the console — so the only way to set them was SQL, and the only
-- way to get them wrong was a typo that fails **after the caller has hung up**,
-- inside a post-call flow, where the sole evidence is a log line.
--
-- The set of valid providers lives in Rust: `host()` in `intelligence.rs`
-- accepts those serving the Anthropic Messages API — `anthropic` and
-- `minimax` — plus `openai` through the vendored SDK. Hard-coding that same
-- list into a dropdown would be two implementations that can disagree, which is
-- the fault this codebase keeps recording against itself. So it becomes a
-- column, and `host()` becomes the thing that reads it.

-- ---- Which providers and models can read a call ----------------------------

alter table catalogue_providers
    add column if not exists can_read boolean not null default false;

comment on column catalogue_providers.can_read is
    'This provider can read a finished call into a shape. Mirrors `host()` in intelligence.rs — that list and this column must not drift, so the code reads this rather than repeating it.';

alter table catalogue_models
    add column if not exists can_read boolean not null default false;

comment on column catalogue_models.can_read is
    'This model can read a finished call. Distinct from `supports_structured_output`: a reading is a forced tool call, which needs tool support and an API this project speaks. A realtime model supports neither in the way this path uses.';

update catalogue_providers set can_read = true  where id in ('anthropic', 'minimax', 'openai');
update catalogue_providers set can_read = false where id not in ('anthropic', 'minimax', 'openai');

-- Anthropic and MiniMax already list models a reader can use.
update catalogue_models set can_read = true
 where provider_id in ('anthropic', 'minimax');

-- **OpenAI's entries are all realtime models.** `catalogue_models` was built as
-- an engine catalogue: for OpenAI it holds `gpt-realtime-*` and nothing a
-- reader could call. Offering those would list models that cannot do the job.
-- The chat models a reading actually uses are added here.
insert into catalogue_models
    (id, provider_id, label, summary, supports_tools, supports_structured_output,
     latency_class, sort_order, is_active, tagline, provider_model_id, can_read)
values
    ('gpt-4.1-mini', 'openai', 'GPT-4.1 mini',
     'Fast and cheap. What the relay already thinks with.',
     true, true, 'fast', 10, true, 'Fast and cheap', 'gpt-4.1-mini', true),
    ('gpt-4.1', 'openai', 'GPT-4.1',
     'More capable and more expensive. For a shape a smaller model fills badly.',
     true, true, 'fast', 11, true, 'More capable', 'gpt-4.1', true)
on conflict (id) do update set can_read = excluded.can_read;

-- A realtime model is never a reader: the reading is a one-shot forced tool
-- call over HTTP, not a bidirectional audio session.
update catalogue_models set can_read = false where id like 'gpt-realtime%';

-- ---- What the console may offer --------------------------------------------

-- Every reader a workspace could be set to, and the models each offers.
--
-- Readable by any signed-in user rather than operator-only: the reader is a
-- workspace's own setting, and a tenant screen will offer it too.
create or replace function reader_choices()
returns table (
    provider_id    text,
    provider_label text,
    model_id       text,
    model_label    text,
    provider_model text
)
language sql
stable
security definer
set search_path = public
as $$
    select p.id, p.label, m.id, m.label, m.provider_model_id
      from catalogue_providers p
      join catalogue_models m on m.provider_id = p.id
     where p.can_read and p.is_active
       and m.can_read and m.is_active
     order by p.sort_order, p.label, m.sort_order, m.label;
$$;

revoke all on function reader_choices() from public, anon;
grant execute on function reader_choices() to authenticated;

-- ---- Timezones, from the one list that is already correct ------------------

-- `pg_timezone_names` is Postgres's own, so it cannot drift from what
-- `runner.rs` will accept when it computes a business day.
--
-- Filtered to region-qualified names: the table also carries obsolete aliases
-- (`Asia/Calcutta`), fixed offsets (`Etc/GMT+5`) and bare abbreviations, none
-- of which anybody should be picking from a list in 2026.
create or replace function timezone_choices()
returns table (name text, utc_offset text)
language sql
stable
security definer
set search_path = public
as $$
    select name,
           to_char(utc_offset, 'HH24:MI') as utc_offset
      from pg_timezone_names
     where name like '%/%'
       and name not like 'Etc/%'
       and name not like 'posix/%'
       and name not like 'right/%'
     order by name;
$$;

revoke all on function timezone_choices() from public, anon;
grant execute on function timezone_choices() to authenticated;

-- ---- Refuse a value rather than store it -----------------------------------

-- The screen offering a list is a courtesy. This is what makes it true: a
-- value typed past the dropdown, sent by an old client, or written by a script
-- is refused here.
create or replace function operator_set_tenant_settings(p_org uuid, p_patch jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    tz text := nullif(btrim(coalesce(p_patch ->> 'timezone', '')), '');
    rp text := nullif(btrim(coalesce(p_patch ->> 'intelligence_provider', '')), '');
    rm text := nullif(btrim(coalesce(p_patch ->> 'intelligence_model', '')), '');
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    if p_patch ? 'escalation_number'
       and coalesce(btrim(p_patch ->> 'escalation_number'), '') <> ''
       and btrim(p_patch ->> 'escalation_number') !~ '^\+?[0-9]{7,15}$'
    then
        raise exception 'an escalation number must be 7 to 15 digits';
    end if;

    if p_patch ? 'retention_days'
       and (p_patch ->> 'retention_days') is not null
       and (p_patch ->> 'retention_days') <> ''
       and (p_patch ->> 'retention_days')::int < 1
    then
        raise exception 'retention must be at least a day, or empty to keep everything';
    end if;

    -- Asked of Postgres itself, so this cannot disagree with what the bridge
    -- will accept when it works out a business day.
    if tz is not null and not exists (select 1 from pg_timezone_names where name = tz) then
        raise exception '% is not a timezone. Use a region name such as Asia/Kolkata.', tz;
    end if;

    if rp is not null and not exists (
        select 1 from catalogue_providers where id = rp and can_read and is_active
    ) then
        raise exception '% cannot read a call. It must serve an API this platform speaks.', rp;
    end if;

    if rm is not null then
        if rp is null then
            raise exception 'a reader model needs its provider named as well';
        end if;
        if not exists (
            select 1 from catalogue_models
             where id = rm and provider_id = rp and can_read and is_active
        ) then
            raise exception '% is not a model % offers for reading calls', rm, rp;
        end if;
    end if;

    update organizations
       set record_calls = case when p_patch ? 'record_calls'
                               then (p_patch ->> 'record_calls')::boolean
                               else record_calls end,
           retention_days = case when p_patch ? 'retention_days'
                                 then nullif(p_patch ->> 'retention_days', '')::int
                                 else retention_days end,
           escalation_number = case when p_patch ? 'escalation_number'
                                    then nullif(btrim(p_patch ->> 'escalation_number'), '')
                                    else escalation_number end,
           max_concurrent_calls = case when p_patch ? 'max_concurrent_calls'
                                       then nullif(p_patch ->> 'max_concurrent_calls', '')::int
                                       else max_concurrent_calls end,
           timezone = coalesce(tz, timezone),
           intelligence_provider = coalesce(rp, intelligence_provider),
           intelligence_model = coalesce(rm, intelligence_model),
           updated_at = now()
     where id = p_org;

    if not found then
        raise exception 'no such organisation';
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_tenant_settings(uuid, jsonb) from public, anon;
grant execute on function operator_set_tenant_settings(uuid, jsonb) to authenticated;

-- The timezone already stored has never been checked. Said rather than
-- corrected: changing a workspace's business day silently is worse than
-- reporting that it is wrong.
do $$
declare bad text;
begin
    for bad in
        select o.slug from organizations o
         where o.timezone is not null
           and not exists (select 1 from pg_timezone_names t where t.name = o.timezone)
    loop
        raise warning 'workspace % has an unrecognised timezone', bad;
    end loop;
end $$;
