-- What a plan costs, what it includes, and the month it is measured over.
--
-- `plans` carried a label, a summary and a sort order. The price and the
-- allowance lived in a spreadsheet, which is a fine place to work them out and
-- a bad place to keep them: nothing enforced them, nothing displayed them, and
-- the numbers in the two plan summaries were already untrue.
--
-- ## Price is configuration; cost is measurement
--
-- The line this migration holds. Prices go here, because somebody chooses
-- them. Costs stay in `catalogue_vendor_rates`, read off a vendor's own page,
-- and **margin is computed, never entered.** The moment a cost becomes an
-- editable field beside a price, somebody types one and every margin figure
-- afterwards is fiction.
--
-- ## Why a period, and why it is a row
--
-- Included minutes are meaningless without one. Everything measured up to now
-- has been "the last 30 days", which is a window, not a month: it never starts,
-- never ends, and never resets, so an allowance against it can neither be used
-- up nor renewed.
--
-- The period stores the price and the allowance **as they were when it opened**,
-- rather than joining to the plan. A price change mid-month must not rewrite a
-- month already being billed, and a customer moved between tiers must be
-- charged what each tier said while they were on it. A join gives the current
-- answer to a historical question.

-- ---- What a plan is sold for ----------------------------------------------

alter table plans
    add column if not exists price            numeric(12, 2),
    add column if not exists currency         text not null default 'INR',
    add column if not exists included_minutes integer,
    add column if not exists included_numbers integer not null default 1,
    -- What a minute beyond the allowance costs. Its own column rather than
    -- reusing the engine's retail price, because those answer different
    -- questions and the first attempt at this conflated them — producing an
    -- overage rate *below* the in-plan rate, which rewards a customer for
    -- going over.
    add column if not exists overage_per_minute numeric(12, 4);

comment on column plans.included_minutes is
    'Minutes included each period. NULL means unmetered, which is a real choice for a bespoke contract and not the same as zero.';

comment on column plans.overage_per_minute is
    'What a minute past the allowance costs. Should sit above the effective in-plan rate (price / included_minutes) or a heavy user is better off staying over than moving up a tier.';

-- The figures worked out against measured cost: INR 2.34/min on a booking call
-- that completed, plus 15% for a sample of two. Every tier holds roughly 60%
-- even if the customer uses every included minute.
update plans set
    price = 5000, included_minutes = 430, included_numbers = 1,
    overage_per_minute = 14, currency = 'INR',
    label = 'Solo',
    summary = 'One line, about seven calls a day. For a single practitioner.'
 where id = 'starter';

update plans set
    price = 12000, included_minutes = 1470, included_numbers = 1,
    overage_per_minute = 12, currency = 'INR',
    label = 'Clinic',
    summary = 'One line, about twenty-four calls a day.'
 where id = 'growth';

insert into plans (id, label, summary, sort_order, is_active,
                   price, currency, included_minutes, included_numbers, overage_per_minute)
values
    ('practice', 'Practice', 'Three lines, about thirty-six calls a day.', 2, true,
     20000, 'INR', 2180, 3, 11),
    ('group', 'Group', 'Five lines, about sixty-five calls a day.', 3, true,
     35000, 'INR', 3920, 5, 10)
on conflict (id) do nothing;

-- Every plan may reach every published engine, as 0091 established. Narrowing
-- a tier is deliberate; a new tier silently entitled to nothing is not.
insert into plan_entitlements (plan_id, kind, item_id)
select p.id, 'engine', e.id::text
  from plans p cross join engines e
 where e.status = 'published' and e.org_id is null
on conflict do nothing;

-- ---- A contract that overrides the tier ------------------------------------

-- The enterprise deal that does not fit a tier is the normal case, not the
-- exception. Same shape as `organization_entitlements`: absence means "ask the
-- plan", so there is no need to copy a tier's figures to change one of them.
create table if not exists organization_contracts (
    org_id             uuid primary key references organizations(id) on delete cascade,
    price              numeric(12, 2),
    currency           text,
    included_minutes   integer,
    included_numbers   integer,
    overage_per_minute numeric(12, 4),
    note               text not null default '',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

comment on table organization_contracts is
    'Per-tenant overrides of the plan. Every column is nullable and NULL means "ask the plan", so a contract that changes one figure says only that figure.';

alter table organization_contracts enable row level security;

create policy contracts_operator_only on organization_contracts
    for all to authenticated
    using (is_platform_admin())
    with check (is_platform_admin());

-- What a workspace is actually on, tier and contract resolved.
create or replace function org_terms(p_org uuid)
returns table (
    plan_id            text,
    plan_label         text,
    price              numeric,
    currency           text,
    included_minutes   integer,
    included_numbers   integer,
    overage_per_minute numeric,
    is_bespoke         boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select p.id, p.label,
           coalesce(c.price, p.price),
           coalesce(c.currency, p.currency),
           coalesce(c.included_minutes, p.included_minutes),
           coalesce(c.included_numbers, p.included_numbers),
           coalesce(c.overage_per_minute, p.overage_per_minute),
           c.org_id is not null
      from organizations o
      join plans p on p.id = o.plan
      left join organization_contracts c on c.org_id = o.id
     where o.id = p_org;
$$;

revoke all on function org_terms(uuid) from public, anon;
grant execute on function org_terms(uuid) to authenticated, service_role;

-- ---- The month itself ------------------------------------------------------

create table if not exists billing_periods (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references organizations(id) on delete cascade,
    starts_at          timestamptz not null,
    ends_at            timestamptz not null,
    -- Stamped at the moment the period opens. See the header: a join would
    -- answer a historical question with today's figures.
    plan_id            text not null,
    price              numeric(12, 2),
    currency           text not null default 'INR',
    included_minutes   integer,
    overage_per_minute numeric(12, 4),
    -- 'open' | 'closed'. A closed period is never recalculated: it has been
    -- invoiced, and a number that moves after it was sent is worse than a
    -- number that was wrong.
    status             text not null default 'open' check (status in ('open', 'closed')),
    closed_at          timestamptz,
    created_at         timestamptz not null default now()
);

create index if not exists billing_periods_org on billing_periods (org_id, starts_at desc);
-- One open period per workspace. Two would mean minutes counted against
-- whichever the query happened to find.
create unique index if not exists billing_periods_one_open
    on billing_periods (org_id) where status = 'open';

comment on table billing_periods is
    'The month an allowance is measured over. Terms are copied in at the start, so a mid-month price change never rewrites a month already being billed.';

alter table billing_periods enable row level security;

-- A workspace sees its own periods: it is what they are billed for.
create policy billing_periods_own on billing_periods
    for select to authenticated using (is_org_member(org_id));

create policy billing_periods_operator on billing_periods
    for all to authenticated
    using (is_platform_admin()) with check (is_platform_admin());

-- Open a period, closing whatever preceded it.
--
-- Idempotent: called again inside an open period it returns the one that is
-- already open rather than starting a second. Provisioning will be retried and
-- a monthly job will overlap itself eventually.
create or replace function open_billing_period(p_org uuid, p_at timestamptz default now())
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    terms   record;
    existing record;
    new_id  uuid;
    starts  timestamptz := date_trunc('month', p_at);
    ends    timestamptz := date_trunc('month', p_at) + interval '1 month';
begin
    if not (is_platform_admin() or caller_is_service_role()) then
        raise exception 'not a platform administrator';
    end if;

    select * into existing from billing_periods
     where org_id = p_org and status = 'open';

    if found and existing.starts_at = starts then
        return json_build_object('id', existing.id, 'opened', false);
    end if;

    if found then
        update billing_periods
           set status = 'closed', closed_at = now()
         where id = existing.id;
    end if;

    select * into terms from org_terms(p_org);
    if not found then
        raise exception 'that workspace is on no plan';
    end if;

    insert into billing_periods (org_id, starts_at, ends_at, plan_id, price,
                                 currency, included_minutes, overage_per_minute)
    values (p_org, starts, ends, terms.plan_id, terms.price, terms.currency,
            terms.included_minutes, terms.overage_per_minute)
    returning id into new_id;

    return json_build_object('id', new_id, 'opened', true,
                             'starts_at', starts, 'ends_at', ends);
end;
$$;

revoke all on function open_billing_period(uuid, timestamptz) from public, anon;
grant execute on function open_billing_period(uuid, timestamptz) to authenticated, service_role;

-- ---- What has been used against it -----------------------------------------

-- Minutes used in the open period, and what is owed beyond the allowance.
--
-- Minutes come from `billing_sessions`, which is where a call's duration
-- actually lands — not from `calls`, whose `in-progress` rows never settle.
create or replace function billing_period_usage(p_org uuid)
returns table (
    period_id          uuid,
    starts_at          timestamptz,
    ends_at            timestamptz,
    plan_id            text,
    price              numeric,
    currency           text,
    included_minutes   integer,
    used_minutes       numeric,
    overage_minutes    numeric,
    overage_per_minute numeric,
    overage_charge     numeric,
    total              numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not (is_org_member(p_org) or is_platform_admin() or caller_is_service_role()) then
        raise exception 'not permitted to read that workspace';
    end if;

    return query
    with p as (
        select * from billing_periods
         where org_id = p_org and status = 'open'
         order by starts_at desc limit 1
    ),
    used as (
        select coalesce(sum(ceil(b.duration_secs / 60.0)), 0)::numeric as minutes
          from billing_sessions b, p
         where b.org_id = p_org
           and b.started_at >= p.starts_at
           and b.started_at <  p.ends_at
    )
    select p.id, p.starts_at, p.ends_at, p.plan_id, p.price, p.currency,
           p.included_minutes,
           used.minutes,
           -- An unmetered plan has no overage, which is different from an
           -- overage of zero: one is a contract, the other is a customer who
           -- happened to stay inside their allowance.
           case when p.included_minutes is null then null
                else greatest(used.minutes - p.included_minutes, 0) end,
           p.overage_per_minute,
           case when p.included_minutes is null or p.overage_per_minute is null then null
                else greatest(used.minutes - p.included_minutes, 0) * p.overage_per_minute end,
           coalesce(p.price, 0)
             + case when p.included_minutes is null or p.overage_per_minute is null then 0
                    else greatest(used.minutes - p.included_minutes, 0) * p.overage_per_minute end
      from p, used;
end;
$$;

revoke all on function billing_period_usage(uuid) from public, anon;
grant execute on function billing_period_usage(uuid) to authenticated, service_role;

-- Every workspace's current period, for the operator.
create or replace function operator_billing_periods()
returns table (
    org_id             uuid,
    org_name           text,
    plan_id            text,
    price              numeric,
    currency           text,
    included_minutes   integer,
    used_minutes       numeric,
    overage_minutes    numeric,
    overage_charge     numeric,
    total              numeric,
    starts_at          timestamptz,
    ends_at            timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    return query
    select o.id, o.name, u.plan_id, u.price, u.currency, u.included_minutes,
           u.used_minutes, u.overage_minutes, u.overage_charge, u.total,
           u.starts_at, u.ends_at
      from organizations o
      cross join lateral billing_period_usage(o.id) u
     order by u.total desc nulls last, o.name;
end;
$$;

revoke all on function operator_billing_periods() from public, anon;
grant execute on function operator_billing_periods() to authenticated;

-- ---- Setting the terms -----------------------------------------------------

create or replace function operator_set_plan(p_plan text, p_patch jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    if (p_patch ? 'price' and (p_patch ->> 'price')::numeric < 0)
       or (p_patch ? 'overage_per_minute' and (p_patch ->> 'overage_per_minute')::numeric < 0)
    then
        raise exception 'a price cannot be negative';
    end if;

    update plans
       set label = coalesce(p_patch ->> 'label', label),
           summary = coalesce(p_patch ->> 'summary', summary),
           price = case when p_patch ? 'price'
                        then nullif(p_patch ->> 'price', '')::numeric else price end,
           currency = coalesce(nullif(p_patch ->> 'currency', ''), currency),
           included_minutes = case when p_patch ? 'included_minutes'
                                   then nullif(p_patch ->> 'included_minutes', '')::int
                                   else included_minutes end,
           included_numbers = coalesce(nullif(p_patch ->> 'included_numbers', '')::int, included_numbers),
           overage_per_minute = case when p_patch ? 'overage_per_minute'
                                     then nullif(p_patch ->> 'overage_per_minute', '')::numeric
                                     else overage_per_minute end,
           is_active = coalesce((p_patch ->> 'is_active')::boolean, is_active)
     where id = p_plan;

    if not found then
        raise exception 'no such plan';
    end if;
    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_plan(text, jsonb) from public, anon;
grant execute on function operator_set_plan(text, jsonb) to authenticated;

create or replace function operator_plans()
returns table (
    id                 text,
    label              text,
    summary            text,
    price              numeric,
    currency           text,
    included_minutes   integer,
    included_numbers   integer,
    overage_per_minute numeric,
    is_active          boolean,
    sort_order         integer,
    workspaces         bigint,
    effective_per_min  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    return query
    select p.id, p.label, p.summary, p.price, p.currency, p.included_minutes,
           p.included_numbers, p.overage_per_minute, p.is_active, p.sort_order,
           (select count(*) from organizations o where o.plan = p.id),
           -- What a minute inside the plan actually costs the customer. Shown
           -- because the overage rate must sit above it, and the first attempt
           -- at this pricing got that backwards.
           case when coalesce(p.included_minutes, 0) > 0
                then round(p.price / p.included_minutes, 2) end
      from plans p
     order by p.sort_order, p.id;
end;
$$;

revoke all on function operator_plans() from public, anon;
grant execute on function operator_plans() to authenticated;
