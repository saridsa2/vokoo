-- The price list was readable by every tenant.
--
-- `plans` predates prices: it held a label, a summary and a sort order, and
-- had no row-level security because there was nothing on it worth guarding.
-- 0099 put `price`, `included_minutes` and `overage_per_minute` on the same
-- table and did not revisit that.
--
-- Measured, not reasoned about: a plain member of Vayuveda selected 4 rows.
--
-- This is the same shape as the catalogue leak in 0093 — a grant that was
-- correct when written and became wrong when the table's contents changed. It
-- is worth naming as a pattern, because neither was a cross-tenant bug and
-- neither would be found by looking for one: **the question to ask of any
-- table gaining a column is who could already read it.**

alter table plans enable row level security;

create policy plans_operator_only on plans
    for all to authenticated
    using (is_platform_admin())
    with check (is_platform_admin());

comment on table plans is
    'The price list. Operator-only: a customer knowing every tier''s rate is a commercial disclosure, and `included_minutes` beside `price` gives away the margin structure.';

-- `org_terms` and `open_billing_period` read `plans` and are `security
-- definer`, so they are unaffected — which is the point of them being definers.
-- A tenant learns its own terms from `billing_period_usage`, which returns the
-- figures for its own workspace and nothing about anybody else's tier.

-- ---- A workspace with no period must still appear ---------------------------

-- `cross join lateral` dropped every workspace whose `billing_period_usage`
-- returned no rows — which is exactly the workspace an operator needs to see,
-- because it is the one nothing is being counted for.
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
      -- LEFT, so a workspace with no open period comes back with nulls and the
      -- screen can say so. Absence is the finding.
      left join lateral billing_period_usage(o.id) u on true
     order by u.total desc nulls last, o.name;
end;
$$;

revoke all on function operator_billing_periods() from public, anon;
grant execute on function operator_billing_periods() to authenticated;

-- ---- A new workspace gets a period ------------------------------------------

-- Provisioning opened none, so a workspace was billed against nothing until
-- somebody noticed and pressed a button.
--
-- **The rest of this function is unchanged.** It is reproduced in full because
-- Postgres has no way to add a statement to an existing body — and reproduced
-- rather than rewritten, because the version already deployed lowercases the
-- slug, explains its own constraint, and returns `owner_email` for the console
-- to echo back. Writing a fresh one from the signature would have quietly lost
-- all three.
create or replace function operator_create_tenant(
    p_name        text,
    p_slug        text,
    p_owner_email text default null,
    p_plan        text default 'starter'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    new_org uuid;
    cleaned_slug text := lower(btrim(p_slug));
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    if btrim(coalesce(p_name, '')) = '' then
        raise exception 'a workspace needs a name';
    end if;

    -- The slug becomes half of every agent's SIP endpoint name and cannot be
    -- changed afterwards, so it is checked here rather than discovered when a
    -- registration fails. Letters, digits and hyphens: anything else ends up in
    -- a PJSIP endpoint id.
    if cleaned_slug !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then
        raise exception 'a slug is 3-32 characters of lowercase letters, digits and hyphens';
    end if;

    if exists (select 1 from organizations where slug = cleaned_slug) then
        raise exception 'that slug is taken';
    end if;

    if p_plan is not null and not exists (select 1 from plans where id = p_plan) then
        raise exception 'no such plan: %', p_plan;
    end if;

    insert into organizations (name, slug, plan)
    values (btrim(p_name), cleaned_slug, coalesce(p_plan, 'starter'))
    returning id into new_org;

    -- The owner, by address. `user_id` stays null until they sign in, which is
    -- the state 0078 exists for — before it, a workspace could not have an
    -- owner who had not yet arrived.
    if btrim(coalesce(p_owner_email, '')) <> '' then
        insert into memberships (org_id, role, invited_email, display_name)
        values (new_org, 'owner', lower(btrim(p_owner_email)), '');
    end if;

    -- ---- added in 0100 ----
    -- A period from the first day, so the workspace is never being used
    -- against no allowance. Nothing rolls these monthly yet; that job is named
    -- on the Plans screen rather than left to be discovered in October.
    perform open_billing_period(new_org);

    return json_build_object(
        'id', new_org,
        'slug', cleaned_slug,
        'owner_email', nullif(lower(btrim(coalesce(p_owner_email, ''))), '')
    );
end;
$$;

revoke all on function operator_create_tenant(text, text, text, text) from public, anon;
grant execute on function operator_create_tenant(text, text, text, text) to authenticated;
