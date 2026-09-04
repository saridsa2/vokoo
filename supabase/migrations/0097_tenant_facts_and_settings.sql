-- Two figures on the tenant screen were false, and one tab was read-only.
--
-- ## The false ones
--
-- `COMPLETED 0 — 0% of them` against 65 calls, and `ENGINES 0` on a workspace
-- whose every agent runs on one. Both were written here and both were wrong for
-- the same kind of reason: a filter that named a value the data does not use.
--
--   status = 'completed'   the column holds 'ended', 'in-progress',
--                          'unconfigured'. There is no 'completed', so the
--                          answer was always zero.
--   engines.org_id = org   engines became the platform's in 0091. Every tenant
--                          now counts zero of them, forever.
--
-- The second is the worse mistake: 0089 was right when written and 0091 broke
-- it two migrations later without anything failing. A wrong number is worse
-- than a missing one — it is read and believed.

drop function if exists operator_tenant_usage(uuid, integer);
create or replace function operator_tenant_usage(p_org uuid, p_days integer default 30)
returns table (
    day            date,
    calls          bigint,
    answered       bigint,
    seconds        bigint
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
    with span as (
        select generate_series(
            (current_date - (greatest(least(p_days, 365), 1) - 1)),
            current_date,
            interval '1 day'
        )::date as day
    )
    select s.day,
           count(c.id),
           -- **"answered", read off the carrier's own word.** `status` is
           -- 'ended' for a call that ran; `answered_at` does not exist. A call
           -- that got as far as an agent and produced any duration was
           -- answered — which is the question somebody is asking when they
           -- look at this column.
           count(c.id) filter (where c.status = 'ended' and coalesce(c.duration_seconds, 0) > 0),
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

-- ---- Configuration, with the engine access that replaces Entitlements ------

create or replace function operator_tenant_config(p_org uuid)
returns json
language plpgsql
stable
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
        -- **Engines the workspace may use, not a count of ones it owns.**
        -- It owns none — they are the platform's. What matters is which it is
        -- entitled to, which is what its agents can actually be pointed at.
        'engines', coalesce((
            select json_agg(json_build_object(
                'id', e.id,
                'name', coalesce(e.public_name, e.name),
                'allowed', org_may(p_org, 'engine', e.id::text),
                'in_use', exists (select 1 from agents a
                                   where a.org_id = p_org and a.engine_id = e.id)
            ) order by coalesce(e.public_name, e.name))
              from engines e
             where e.org_id is null and e.status = 'published'
        ), '[]'::json),
        'agents',    (select count(*) from agents   where org_id = p_org),
        'flows',     (select count(*) from flows    where org_id = p_org),
        'published_flows',
                     (select count(*) from flows    where org_id = p_org and status = 'published'),
        'tools',     (select count(*) from tools    where org_id = p_org),
        'members',   (select count(*) from memberships where org_id = p_org),
        'numbers',   coalesce((
                        select json_agg(json_build_object(
                            'id', p.id, 'number', p.number, 'label', p.label,
                            'carrier', p.carrier,
                            'bound', exists (select 1 from number_flows nf
                                              where nf.phone_number_id = p.id)
                        ) order by p.number)
                          from phone_numbers p where p.org_id = p_org
                     ), '[]'::json),
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

-- ---- Settings an operator may change on a customer's behalf ----------------

-- Named columns, not a blanket patch. A function that writes whatever keys it
-- is handed is one typo away from a route that can set `plan` or `status`,
-- which have their own function and their own consequences.
create or replace function operator_set_tenant_settings(p_org uuid, p_patch jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    -- An escalation number that is not dialable strands the caller it exists
    -- to rescue, and nothing would say so until a call failed.
    if p_patch ? 'escalation_number'
       and coalesce(btrim(p_patch ->> 'escalation_number'), '') <> ''
       and btrim(p_patch ->> 'escalation_number') !~ '^\+?[0-9]{7,15}$'
    then
        raise exception 'an escalation number must be 7 to 15 digits';
    end if;

    if p_patch ? 'retention_days'
       and (p_patch ->> 'retention_days') is not null
       and (p_patch ->> 'retention_days')::int < 1
    then
        raise exception 'retention must be at least a day, or empty to keep everything';
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
           timezone = case when p_patch ? 'timezone'
                           then coalesce(nullif(btrim(p_patch ->> 'timezone'), ''), timezone)
                           else timezone end,
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

comment on function operator_set_tenant_settings is
    'Settings an operator changes on a customer''s behalf. Plan and status are deliberately not here — they have their own function because they have their own consequences.';

-- ---- Retiring the dead entitlement kinds -----------------------------------

-- `model` and `provider` rows are read by nothing: denying a model changes no
-- behaviour anywhere, because no catalogue filters on them. They made a tab of
-- 24 controls of which one ever worked, and that one — `byo_intelligence` —
-- was withdrawn in 0090.
--
-- Deleted rather than left, because a control that does nothing teaches
-- somebody that the whole screen does nothing.
delete from plan_entitlements where kind in ('model', 'provider', 'engine_stage', 'carrier');
delete from organization_entitlements where kind in ('model', 'provider', 'engine_stage', 'carrier');

-- ---- Which engines a plan or a tenant may reach ----------------------------

create or replace function operator_set_engine_access(p_org uuid, p_engine uuid, p_allowed boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    if p_allowed is null then
        -- Back to whatever the plan says. The third state is the point: with
        -- only allow and deny, revoking something a plan grants would mean
        -- editing that plan for everybody on it.
        delete from organization_entitlements
         where org_id = p_org and kind = 'engine' and item_id = p_engine::text;
    else
        insert into organization_entitlements (org_id, kind, item_id, allowed)
        values (p_org, 'engine', p_engine::text, p_allowed)
        on conflict (org_id, kind, item_id) do update set allowed = excluded.allowed;
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_engine_access(uuid, uuid, boolean) from public, anon;
grant execute on function operator_set_engine_access(uuid, uuid, boolean) to authenticated;
