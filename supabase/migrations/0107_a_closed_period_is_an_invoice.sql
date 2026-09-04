-- A workspace's plan could be changed at any moment, including halfway through
-- a month it had not paid for.
--
-- The rule wanted is "not while an invoice is pending", and there was no
-- invoice: `billing_periods` is `open` or `closed` and carries no notion of
-- having been paid. So the fact is added rather than the rule being bent to fit
-- what happened to exist.
--
-- **A closed period is the invoice.** It already holds everything one needs —
-- the dates, the plan, the price agreed, the allowance and the overage rate,
-- all snapshotted when it opened. Closing it is drawing the line under a
-- month's usage. What was missing is the other end: whether the money arrived.
--
-- ## Why an open period does not block
--
-- Every active workspace always has exactly one — the partial unique index
-- guarantees it — so blocking on an open period would mean a plan could never
-- be changed at all. An open period is a month in progress, not a bill.
--
-- ## What happens to a period when the plan changes
--
-- Nothing, deliberately. The open period keeps the terms it opened with,
-- because those are the terms the customer was on while they made those calls.
-- The new plan takes effect when the next period opens. That is the whole
-- reason the snapshot exists.

alter table billing_periods
    add column if not exists settled_at timestamptz,
    -- Who recorded it. A payment marked by hand is a claim somebody made, and
    -- an unattributed one cannot be questioned later.
    add column if not exists settled_by uuid references auth.users(id);

comment on column billing_periods.settled_at is
    'When this period was recorded as paid. Null on a closed period means an invoice is pending, which blocks a plan change. Meaningless on an open period, which is not yet a bill.';

-- Only a closed period can be settled, and a settled one must say when.
alter table billing_periods drop constraint if exists billing_periods_settled_when_closed;
alter table billing_periods add constraint billing_periods_settled_when_closed
    check (settled_at is null or status = 'closed');

-- ---- Is anything owed ------------------------------------------------------

-- One statement of the rule, so the console, the plan change and any later job
-- cannot disagree about it.
create or replace function org_has_pending_invoice(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from billing_periods
         where org_id = p_org
           and status = 'closed'
           and settled_at is null
    );
$$;

revoke all on function org_has_pending_invoice(uuid) from public, anon;
grant execute on function org_has_pending_invoice(uuid) to authenticated;

-- ---- Recording that one was paid -------------------------------------------

create or replace function operator_settle_period(p_period uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    period record;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    select * into period from billing_periods where id = p_period;
    if period is null then
        raise exception 'no such billing period';
    end if;
    if period.status <> 'closed' then
        raise exception 'that period is still open. Close it before recording payment.';
    end if;
    if period.settled_at is not null then
        -- Not an error worth raising as a failure, but not silent either: two
        -- people marking the same invoice paid should not overwrite who did.
        return json_build_object('ok', true, 'already_settled', true);
    end if;

    update billing_periods
       set settled_at = now(),
           settled_by = auth.uid()
     where id = p_period;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_settle_period(uuid) from public, anon;
grant execute on function operator_settle_period(uuid) to authenticated;

-- ---- The plan cannot move while money is owed ------------------------------

create or replace function operator_set_tenant(p_org uuid, p_plan text, p_status text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    current_plan text;
    owed         integer;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;
    if p_plan is not null and not exists (select 1 from plans where id = p_plan) then
        raise exception 'no such plan: %', p_plan;
    end if;

    select plan into current_plan from organizations where id = p_org;
    if current_plan is null then
        raise exception 'no such organisation';
    end if;

    -- ---- added in 0107 ----
    -- Only when the plan actually moves. Suspending a workspace must stay
    -- possible while it owes money — that is when it is most likely to be
    -- wanted, and refusing it would make an unpaid invoice protect the account
    -- it is owed by.
    if p_plan is not null and p_plan <> current_plan then
        select count(*) into owed from billing_periods
         where org_id = p_org and status = 'closed' and settled_at is null;
        if owed > 0 then
            raise exception
                '% closed period(s) are unpaid. Record payment on the workspace''s Billing tab, then change the plan.', owed;
        end if;
    end if;

    update organizations
       set plan       = coalesce(p_plan, plan),
           status     = coalesce(p_status, status),
           updated_at = now()
     where id = p_org;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_tenant(uuid, text, text) from public, anon;
grant execute on function operator_set_tenant(uuid, text, text) to authenticated;

-- ---- What the screens read -------------------------------------------------

-- **`operator_billing_periods()` is deliberately left alone.** It reports one
-- row per workspace for the *open* period and LEFT joins, so a workspace with
-- no open period comes back as nulls and the Plans screen says so. Widening it
-- to every period would turn that into one row per month and lose the finding.
--
-- `billing_period_usage(p_org)` cannot help here either: it selects the open
-- period itself, so it can answer "this month" and nothing else. The same
-- arithmetic, for a period somebody names.
create or replace function billing_period_total(p_period uuid)
returns table (
    used_minutes    numeric,
    overage_minutes numeric,
    overage_charge  numeric,
    total           numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    p record;
begin
    select * into p from billing_periods where id = p_period;
    if p is null then
        return;
    end if;
    if not (is_org_member(p.org_id) or is_platform_admin() or caller_is_service_role()) then
        raise exception 'not permitted to read that workspace';
    end if;

    return query
    with used as (
        select coalesce(sum(ceil(b.duration_secs / 60.0)), 0)::numeric as minutes
          from billing_sessions b
         where b.org_id = p.org_id
           and b.started_at >= p.starts_at
           and b.started_at <  p.ends_at
    )
    select used.minutes,
           -- An unmetered plan has no overage, which is different from an
           -- overage of zero: one is a contract, the other is a customer who
           -- stayed inside their allowance.
           case when p.included_minutes is null then null
                else greatest(used.minutes - p.included_minutes, 0) end,
           case when p.included_minutes is null or p.overage_per_minute is null then null
                else greatest(used.minutes - p.included_minutes, 0) * p.overage_per_minute end,
           coalesce(p.price, 0)
             + case when p.included_minutes is null or p.overage_per_minute is null then 0
                    else greatest(used.minutes - p.included_minutes, 0) * p.overage_per_minute end
      from used;
end;
$$;

revoke all on function billing_period_total(uuid) from public, anon;
grant execute on function billing_period_total(uuid) to authenticated;

-- Every period one workspace has had, which is what its Billing tab shows and
-- where an invoice is marked paid. A closed period with no `settled_at` is the
-- thing blocking a plan change, so it has to be visible somewhere.
create or replace function operator_tenant_periods(p_org uuid)
returns table (
    id               uuid,
    starts_at        timestamptz,
    ends_at          timestamptz,
    plan_id          text,
    price            numeric,
    currency         text,
    included_minutes integer,
    used_minutes     numeric,
    overage_minutes  numeric,
    total            numeric,
    status           text,
    settled_at       timestamptz
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
    select b.id, b.starts_at, b.ends_at, b.plan_id, b.price, b.currency,
           b.included_minutes, t.used_minutes, t.overage_minutes, t.total,
           b.status, b.settled_at
      from billing_periods b
      left join lateral billing_period_total(b.id) t on true
     where b.org_id = p_org
     -- Newest first: the month in progress, then the one before it.
     order by b.starts_at desc;
end;
$$;

revoke all on function operator_tenant_periods(uuid) from public, anon;
grant execute on function operator_tenant_periods(uuid) to authenticated;
