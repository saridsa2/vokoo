-- The platform supplies the intelligence, and sells it by the engine.
--
-- Two changes that belong together, because the second is only honest once the
-- first is true: if a tenant can bring its own keys, a price per engine is a
-- price for something they might not be buying from us.
--
-- ## 1. The keys become the platform's
--
-- Every `vendor_credentials` row belonged to Vayuveda and **there were no
-- platform rows at all** — which is why a second workspace resolved `(none)`
-- and could not have answered a call. Vayuveda is the test bed, so its keys are
-- the platform's keys.
--
-- `org_id = null` is the established shape here: the number pool (0086) and the
-- platform keys (0084) already mean "held by the operator, invisible to every
-- tenant". `secret_ref` is untouched, so nothing goes near the vault and no key
-- is re-entered or re-encrypted — only who owns the row changes.
--
-- Reversible by setting `org_id` back, which is why it is a move rather than a
-- copy-and-delete.

update vendor_credentials
   set org_id     = null,
       updated_at = now()
 where org_id is not null;

-- ---- Nobody brings their own -----------------------------------------------

-- `resolve_vendor_secret` already gates a tenant's own key on this capability
-- and falls through to the platform's when it is absent. So withdrawing it is
-- the whole of the switch: no bridge change, nothing on the call path, and a
-- workspace that somehow still has a key of its own cannot be run on it.
delete from plan_entitlements
 where kind = 'capability' and item_id in ('byo_intelligence', 'byo_carrier');

-- And no per-tenant override can put it back by accident.
delete from organization_entitlements
 where kind = 'capability' and item_id in ('byo_intelligence', 'byo_carrier');

-- ---- 2. An engine has a price ----------------------------------------------
--
-- **Per minute of connected call, on the engine that carried it.**
--
-- The rate card prices what a *vendor* charges us — tokens, characters, audio
-- seconds — and every one of those rates is deliberately null until somebody
-- reads it off a vendor's page. That is the right shape for knowing our cost
-- and the wrong shape for an invoice: a customer cannot be billed in Sarvam
-- characters, and three of our four engines meter nothing a rate card can price
-- at all, because the realtime handlers carry no billing collector.
--
-- A minute on an engine is the one quantity that exists for **every** engine
-- shape. `billing_sessions` already stamps `engine_id` and `duration_secs` on
-- every session it writes — 48 of 48 carry an engine, and the realtime ones
-- carry durations even though they record no tokens. So this prices what is
-- already measured rather than waiting on a producer that does not exist.
--
-- The rate card stays. It answers what a call *cost* us, which is margin;
-- this answers what a call is *sold* for, which is revenue. They are different
-- questions and neither replaces the other.

alter table engines
    add column if not exists price_per_minute numeric(12, 4),
    add column if not exists price_per_call   numeric(12, 4),
    add column if not exists price_currency   text not null default 'INR';

comment on column engines.price_per_minute is
    'What a minute on this engine is sold for. NULL means nobody has priced it — which is not the same as free, and `engine_price` reports it as unpriced rather than as zero.';

comment on column engines.price_per_call is
    'A connect fee charged once per call, on top of the minutes. NULL means none, which is different from a price of zero only in that nothing is claimed.';

-- Rounding up, because that is how connected time is sold and because billing
-- a 4-second wrong number as zero is a decision nobody made deliberately.
-- Kept in one function so the invoice and the operator's own screens cannot
-- disagree about what a session costs.
create or replace function engine_charge(p_engine uuid, p_seconds double precision)
returns numeric
language sql
stable
as $$
    select case
        when e.price_per_minute is null and e.price_per_call is null then null
        else coalesce(e.price_per_call, 0)
           + coalesce(e.price_per_minute, 0) * ceil(coalesce(p_seconds, 0) / 60.0)::numeric
    end
      from engines e
     where e.id = p_engine;
$$;

comment on function engine_charge is
    'What one session on an engine is sold for. NULL when the engine carries no price at all — an unpriced engine and a free one are different facts.';

-- ---- What a workspace is sold ----------------------------------------------

-- Per session, so a disputed invoice can be taken apart line by line. An
-- aggregate that cannot be decomposed is a number somebody has to trust.
create or replace view engine_charges
with (security_invoker = true) as
select b.session_id,
       b.org_id,
       b.engine_id,
       e.name         as engine_name,
       b.started_at,
       b.duration_secs,
       e.price_currency               as currency,
       engine_charge(b.engine_id, b.duration_secs) as charge
  from billing_sessions b
  join engines e on e.id = b.engine_id;

comment on view engine_charges is
    'One row per session: what it is sold for, and NULL where the engine has no price. `security_invoker` so it obeys the RLS of the tables under it — a view without that line runs as its owner and hands every organisation''s rows to any signed-in user (migration 0056 found exactly that four times).';

grant select on engine_charges to authenticated;

-- The operator's summary. Guarded rather than left to the view's RLS, because
-- an operator is a member of no workspace and would otherwise read nothing.
create or replace function operator_engine_revenue(p_days integer default 30)
returns table (
    engine_id   uuid,
    engine_name text,
    org_id      uuid,
    org_name    text,
    sessions    bigint,
    minutes     numeric,
    currency    text,
    charged     numeric,
    unpriced    bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    return query
    select e.id,
           e.name,
           o.id,
           o.name,
           count(b.session_id),
           round((coalesce(sum(b.duration_secs), 0) / 60.0)::numeric, 1),
           e.price_currency,
           coalesce(sum(engine_charge(e.id, b.duration_secs)), 0)::numeric,
           -- Sessions the price list cannot yet put a figure against. Counted
           -- rather than folded into the total as zero.
           count(*) filter (where engine_charge(e.id, b.duration_secs) is null)
      from billing_sessions b
      join engines e       on e.id = b.engine_id
      left join organizations o on o.id = b.org_id
     where b.started_at > now() - make_interval(days => greatest(p_days, 1))
     group by e.id, e.name, o.id, o.name, e.price_currency
     order by 8 desc nulls last, 5 desc;
end;
$$;

revoke all on function operator_engine_revenue(integer) from public, anon;
grant execute on function operator_engine_revenue(integer) to authenticated;

create or replace function operator_set_engine_price(
    p_engine       uuid,
    p_per_minute   numeric,
    p_per_call     numeric,
    p_currency     text default 'INR'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    -- A negative price is a refund per minute, which is not a thing anybody
    -- means to type. Zero is allowed and means deliberately free.
    if coalesce(p_per_minute, 0) < 0 or coalesce(p_per_call, 0) < 0 then
        raise exception 'a price cannot be negative';
    end if;

    update engines
       set price_per_minute = p_per_minute,
           price_per_call   = p_per_call,
           price_currency   = coalesce(nullif(btrim(p_currency), ''), 'INR'),
           updated_at       = now()
     where id = p_engine;

    if not found then
        raise exception 'no such engine';
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_engine_price(uuid, numeric, numeric, text) from public, anon;
grant execute on function operator_set_engine_price(uuid, numeric, numeric, text) to authenticated;

-- Every engine, priced or not, for the operator's price list. A tenant never
-- reads this: what an engine is made of is the platform's, and so is what it
-- costs to run.
create or replace function operator_engines()
returns table (
    id               uuid,
    org_id           uuid,
    org_name         text,
    name             text,
    mode             text,
    status           text,
    config           jsonb,
    price_per_minute numeric,
    price_per_call   numeric,
    price_currency   text,
    sessions_30d     bigint,
    minutes_30d      numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    return query
    select e.id, e.org_id, o.name, e.name, e.mode, e.status, e.config,
           e.price_per_minute, e.price_per_call, e.price_currency,
           coalesce(u.sessions, 0),
           coalesce(u.minutes, 0)
      from engines e
      left join organizations o on o.id = e.org_id
      left join (
            select engine_id,
                   count(*) as sessions,
                   round((sum(duration_secs) / 60.0)::numeric, 1) as minutes
              from billing_sessions
             where started_at > now() - interval '30 days'
             group by engine_id
      ) u on u.engine_id = e.id
     order by o.name, e.name;
end;
$$;

revoke all on function operator_engines() from public, anon;
grant execute on function operator_engines() to authenticated;
