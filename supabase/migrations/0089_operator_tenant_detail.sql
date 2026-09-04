-- What an operator can know about one tenant.
--
-- `operator_tenants()` answers "who are my customers" — one row each, enough
-- for a card. Opening one asks different questions: how much are they using,
-- what will they be billed, how is their workspace configured. Those are three
-- tabs and three shapes, so they are three functions rather than one row that
-- has to carry all of it.
--
-- ## The line this must not cross
--
-- Facts *about* a tenant, never its content. No transcript, no recording, no
-- caller number, no agent prompt. That is enforced here, by what these
-- functions select, rather than by what a screen chooses to render — a screen
-- can be widened by anybody; changing this is a migration somebody reviews.
--
-- Counts and durations are aggregates over calls. An aggregate over rows an
-- operator may not read is still not the rows: "412 calls, 9.3 hours" tells
-- you nothing anybody said.

-- ---- Usage -----------------------------------------------------------------

-- Calls per day, for a chart.
--
-- Days with no calls are **returned as zero rather than omitted**. A series
-- that skips empty days draws a line straight from Monday to Friday and reads
-- as steady use across a week that had none — the gap is the finding, and it
-- has to be in the data for the chart to show it.
-- Dropped first: the column list is part of the signature, so a `create or
-- replace` that renames one is refused rather than applied.
drop function if exists operator_tenant_usage(uuid, integer);
create or replace function operator_tenant_usage(p_org uuid, p_days integer default 30)
returns table (
    day            date,
    calls          bigint,
    completed      bigint,
    seconds        bigint
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
    with span as (
        select generate_series(
            (current_date - (greatest(least(p_days, 365), 1) - 1)),
            current_date,
            interval '1 day'
        )::date as day
    )
    select s.day,
           count(c.id),
           count(c.id) filter (where c.status = 'completed'),
           -- `duration_seconds` is what the carrier reported and what
           -- billing counts; deriving it from the timestamps would disagree
           -- with the invoice on any call whose stream outlived the caller.
           coalesce(sum(c.duration_seconds)::bigint, 0)
      from span s
      left join calls c
             on c.org_id = p_org
            and c.started_at >= s.day
            and c.started_at <  s.day + interval '1 day'
     group by s.day
     order by s.day;
end;
$$;

revoke all on function operator_tenant_usage(uuid, integer) from public, anon;
grant execute on function operator_tenant_usage(uuid, integer) to authenticated;

-- ---- Billing ---------------------------------------------------------------

-- What this tenant has run up, and what nobody has priced yet.
--
-- **`unpriced` is returned beside `cost`, always.** Every rate in
-- `catalogue_vendor_rates` is deliberately null until somebody reads a figure
-- off a vendor's own page, so a cost of zero is nearly always "nothing has been
-- priced" rather than "this was free. Returning the two separately is what
-- stops a screen reporting the second as the first, which is how a wrong
-- invoice goes out.
create or replace function operator_tenant_billing(p_org uuid, p_days integer default 30)
returns table (
    sessions          bigint,
    currency          text,
    cost              numeric,
    unpriced_items    bigint,
    unpriced_vendors  text[]
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
    select count(*)::bigint,
           coalesce(max(cc.currency), 'INR'),
           coalesce(sum(cc.cost), 0)::numeric,
           coalesce(sum(cc.unpriced_items), 0)::bigint,
           coalesce(
               (select array_agg(distinct vendor)
                  from call_costs inner_cc,
                       unnest(inner_cc.unpriced_vendors) vendor
                 where inner_cc.org_id = p_org
                   and inner_cc.started_at > now() - make_interval(days => greatest(p_days, 1))),
               '{}'::text[]
           )
      from call_costs cc
     where cc.org_id = p_org
       and cc.started_at > now() - make_interval(days => greatest(p_days, 1));
end;
$$;

revoke all on function operator_tenant_billing(uuid, integer) from public, anon;
grant execute on function operator_tenant_billing(uuid, integer) to authenticated;

-- ---- Configuration ---------------------------------------------------------

-- How the workspace is set up, as one row.
--
-- Deliberately *counts and settings*, not lists. An operator deciding whether a
-- tenant is provisioned correctly needs to know there are two engines and a
-- bound number; reading the engines themselves would be reading how the
-- customer built their product.
--
-- The exception is the number, which is the platform's own property lent to
-- them — so it is named rather than counted.
create or replace function operator_tenant_config(p_org uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    result json;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    select json_build_object(
        'timezone',              o.timezone,
        'escalation_number',     o.escalation_number,
        'retention_days',        o.retention_days,
        'intelligence_provider', o.intelligence_provider,
        'intelligence_model',    o.intelligence_model,
        'max_concurrent_calls',  o.max_concurrent_calls,
        'record_calls',          o.record_calls,
        'byo_intelligence',      org_may(p_org, 'capability', 'byo_intelligence'),
        'engines',   (select count(*) from engines  where org_id = p_org),
        'agents',    (select count(*) from agents   where org_id = p_org),
        'flows',     (select count(*) from flows    where org_id = p_org),
        'published_flows',
                     (select count(*) from flows    where org_id = p_org and status = 'published'),
        'tools',     (select count(*) from tools    where org_id = p_org),
        'members',   (select count(*) from memberships where org_id = p_org),
        -- The platform's own property, so it is named.
        'numbers',   coalesce((
                        select json_agg(json_build_object(
                            'id', p.id, 'number', p.number, 'label', p.label,
                            'carrier', p.carrier,
                            'bound', exists (select 1 from number_flows nf
                                              where nf.phone_number_id = p.id)
                        ) order by p.number)
                          from phone_numbers p where p.org_id = p_org
                     ), '[]'::json),
        -- Which provider keys this workspace can actually run on. A workspace
        -- with none resolves `(none)` at call time and hears silence, which is
        -- the single most useful thing to see when a new tenant does not work.
        'own_keys',  (select count(*) from vendor_credentials where org_id = p_org)
    )
    into result
    from organizations o
    where o.id = p_org;

    if result is null then
        raise exception 'no such organisation';
    end if;

    return result;
end;
$$;

revoke all on function operator_tenant_config(uuid) from public, anon;
grant execute on function operator_tenant_config(uuid) to authenticated;

comment on function operator_tenant_config is
    'How a workspace is set up, as counts and settings. Never its content — the exception is the phone number, which is the platform''s own property lent to the tenant.';
