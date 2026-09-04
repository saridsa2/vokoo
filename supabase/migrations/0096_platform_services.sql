-- What the platform sells besides minutes.
--
-- Per-engine pricing (0090) covers a call: a minute on an engine, which is the
-- one quantity every engine shape produces. It does not cover the things that
-- happen around a call — reading a finished one into a shape, and whatever
-- comes after it.
--
-- ## Why not `billing_sessions`
--
-- That pipeline is keyed on `session_id` and written by handlers while a call
-- is live. A post-call reading runs after the session has ended and been
-- checkpointed, so attributing it there would mean reopening a closed row —
-- and the reading is not part of the call's audio path in any case. It is a
-- separate service, sold separately, so it gets its own ledger.
--
-- ## Priced per invocation, not per token
--
-- One reading, one unit. A customer can count readings; nobody can check a
-- token count, and pricing on tokens would re-import exactly the vendor
-- metering problem per-engine pricing was chosen to escape — where three of
-- four engines meter nothing a rate card can price.

create table if not exists platform_services (
    id          text primary key,
    label       text not null,
    -- What one unit is, in the customer's words. It appears on an invoice.
    unit        text not null,
    description text not null default '',
    price       numeric(12, 4),
    currency    text not null default 'INR',
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table platform_services is
    'Priced things that are not a minute on an engine. NULL price means unpriced, which is reported as unpriced rather than as free.';

alter table platform_services enable row level security;

-- A tenant does not read the price list. What it is charged appears on its own
-- usage; what everything costs is the platform's business.
create policy platform_services_operator_only on platform_services
    for all to authenticated
    using (is_platform_admin())
    with check (is_platform_admin());

insert into platform_services (id, label, unit, description)
values (
    'intelligence.read',
    'Call reading',
    'per reading',
    'A finished call read into a structured shape by the workspace''s model.'
)
on conflict (id) do nothing;

-- ---- The ledger ------------------------------------------------------------

create table if not exists platform_service_usage (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid not null references organizations(id) on delete cascade,
    service_id  text not null references platform_services(id),
    -- The call it belongs to, when there is one. A reading always has one; a
    -- future service might not, which is why this is nullable rather than a
    -- second table.
    call_id     uuid references calls(id) on delete set null,
    quantity    numeric(12, 4) not null default 1,
    -- Which provider actually did the work. Not used for pricing — the price
    -- is ours and does not move when we change model — but it is the only way
    -- to work out the margin on a service later.
    provider    text not null default '',
    model       text not null default '',
    occurred_at timestamptz not null default now()
);

create index if not exists platform_service_usage_org
    on platform_service_usage (org_id, occurred_at desc);

comment on table platform_service_usage is
    'One row per billable use of a platform service. Written by the bridge, which is the only process that knows a reading happened.';

alter table platform_service_usage enable row level security;

-- A workspace may see its own usage: it is what they are billed for. It may
-- not see the price, which lives on `platform_services` above.
create policy platform_service_usage_own on platform_service_usage
    for select to authenticated
    using (is_org_member(org_id));

create policy platform_service_usage_operator on platform_service_usage
    for all to authenticated
    using (is_platform_admin())
    with check (is_platform_admin());

-- The bridge writes with `service_role`, which bypasses RLS. Said here because
-- there is deliberately no insert policy for `authenticated`: nothing a browser
-- can reach may add a billable row.

-- ---- What it comes to ------------------------------------------------------

create or replace function operator_service_revenue(p_days integer default 30)
returns table (
    service_id text,
    label      text,
    unit       text,
    org_id     uuid,
    org_name   text,
    uses       bigint,
    quantity   numeric,
    currency   text,
    charged    numeric,
    unpriced   bigint
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
    select s.id, s.label, s.unit, o.id, o.name,
           count(u.id),
           coalesce(sum(u.quantity), 0)::numeric,
           s.currency,
           -- NULL price contributes nothing and is counted separately, so an
           -- unpriced service is never reported as a free one.
           coalesce(sum(u.quantity * s.price) filter (where s.price is not null), 0)::numeric,
           count(u.id) filter (where s.price is null)
      from platform_services s
      left join platform_service_usage u
             on u.service_id = s.id
            and u.occurred_at > now() - make_interval(days => greatest(p_days, 1))
      left join organizations o on o.id = u.org_id
     group by s.id, s.label, s.unit, s.currency, o.id, o.name
     order by 9 desc nulls last, 6 desc;
end;
$$;

revoke all on function operator_service_revenue(integer) from public, anon;
grant execute on function operator_service_revenue(integer) to authenticated;

create or replace function operator_set_service_price(p_service text, p_price numeric, p_currency text default 'INR')
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;
    if p_price is not null and p_price < 0 then
        raise exception 'a price cannot be negative';
    end if;

    update platform_services
       set price = p_price,
           currency = coalesce(nullif(btrim(p_currency), ''), 'INR'),
           updated_at = now()
     where id = p_service;

    if not found then
        raise exception 'no such service';
    end if;
    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_service_price(text, numeric, text) from public, anon;
grant execute on function operator_set_service_price(text, numeric, text) to authenticated;
