-- Plans could be edited and not created.
--
-- Four were inserted by 0099 and there has never been a way to add a fifth, so
-- the only route to a new plan was SQL — the same shape as flows before 0095,
-- and packs, and schemas. A list you can edit every row of and never add one to
-- is a list somebody filled in by hand once.
--
-- ## Why an in-use plan stops being editable
--
-- `billing_periods` snapshots `price`, `included_minutes` and
-- `overage_per_minute` when it opens, so editing a plan has never rewritten a
-- period already running or closed. The history is safe either way.
--
-- What is not safe is the *next* period. A workspace on Clinic agreed to
-- ₹12,000 for 1,470 minutes; changing the row changes what they are charged
-- next month, silently, with nothing recording that the deal moved. There is no
-- plan version and no contract amendment to point at afterwards.
--
-- So: a plan nobody is on is a draft and fully editable; a plan with a customer
-- on it is a promise. Raising a price means a new plan and moving the workspace
-- to it at a period boundary, which is a decision somebody makes deliberately
-- rather than a number they change in a table.
--
-- **`is_active` stays editable**, deliberately and as the only exception.
-- Withdrawing a plan from new sign-ups is how one is retired, and every plan
-- worth retiring is one somebody is already on — locking that field would make
-- the lock mean "this plan is offered forever".
--
-- ## Entitlements come with the plan
--
-- A plan with no `plan_entitlements` rows grants nothing, so `org_may` answers
-- false for every engine and `available_engines` offers a workspace on it
-- nothing at all. A plan created without them is a plan that cannot answer a
-- call, and there was no way to see that: `operator_plans` did not report them.
-- It does now, and creating a plan takes its engines in the same call.

-- ---- What the operator sees ------------------------------------------------

-- Two columns are added to what this returns, and Postgres will not replace a
-- function whose OUT parameters change. Dropped first, which is safe: nothing
-- holds a reference to it but the control plane's `rpc` call, by name.
drop function if exists operator_plans();

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
    effective_per_min  numeric,
    -- The engines this plan includes, by public name. Named rather than
    -- counted: "3 engines" does not answer whether the one this customer needs
    -- is among them.
    engines            text[],
    -- Whether the commercial terms are settled. Returned rather than derived
    -- from `workspaces > 0` in the console, so the rule has one statement and
    -- the screen cannot disagree with what the database will do.
    is_locked          boolean
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
                then round(p.price / p.included_minutes, 2) end,
           coalesce((
               select array_agg(e.public_name order by e.public_name)
                 from plan_entitlements pe
                 join engines e on e.id::text = pe.item_id
                where pe.plan_id = p.id and pe.kind = 'engine'
                  and e.public_name is not null
           ), array[]::text[]),
           exists (select 1 from organizations o where o.plan = p.id)
      from plans p
     order by p.sort_order, p.id;
end;
$$;

revoke all on function operator_plans() from public, anon;
grant execute on function operator_plans() to authenticated;

-- ---- Adding one ------------------------------------------------------------

create or replace function operator_create_plan(p_id text, p_patch jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    slug     text := lower(btrim(coalesce(p_id, '')));
    engines  text[] := coalesce(
        array(select jsonb_array_elements_text(p_patch -> 'engines')),
        array[]::text[]
    );
    engine   text;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    -- The id is stored on `organizations.plan` and read by `plan_entitlements`,
    -- so it is an identifier rather than a name — and it can never be changed,
    -- because changing it would orphan every workspace on it.
    if slug !~ '^[a-z][a-z0-9-]{1,30}$' then
        raise exception 'a plan id is lowercase letters, digits and hyphens, starting with a letter';
    end if;
    if exists (select 1 from plans where id = slug) then
        raise exception 'a plan called % already exists', slug;
    end if;
    if coalesce(btrim(p_patch ->> 'label'), '') = '' then
        raise exception 'a plan needs a name somebody can read';
    end if;
    if (p_patch ->> 'price')::numeric < 0
       or (p_patch ->> 'overage_per_minute')::numeric < 0 then
        raise exception 'a price cannot be negative';
    end if;

    insert into plans (
        id, label, summary, price, currency, included_minutes,
        included_numbers, overage_per_minute, is_active, sort_order
    )
    values (
        slug,
        btrim(p_patch ->> 'label'),
        coalesce(p_patch ->> 'summary', ''),
        nullif(p_patch ->> 'price', '')::numeric,
        coalesce(nullif(p_patch ->> 'currency', ''), 'INR'),
        nullif(p_patch ->> 'included_minutes', '')::int,
        coalesce(nullif(p_patch ->> 'included_numbers', '')::int, 1),
        nullif(p_patch ->> 'overage_per_minute', '')::numeric,
        -- Inactive until somebody says otherwise. A plan appears the moment it
        -- is created, and one created half-filled should not be sellable while
        -- its engines are still being chosen.
        coalesce((p_patch ->> 'is_active')::boolean, false),
        coalesce(nullif(p_patch ->> 'sort_order', '')::int,
                 (select coalesce(max(sort_order), 0) + 1 from plans))
    );

    foreach engine in array engines loop
        if not exists (select 1 from public.engines e
                        where e.id::text = engine and e.org_id is null) then
            raise exception 'engine % is not a platform engine', engine;
        end if;
        insert into plan_entitlements (plan_id, kind, item_id)
        values (slug, 'engine', engine)
        on conflict do nothing;
    end loop;

    return json_build_object('ok', true, 'id', slug);
end;
$$;

revoke all on function operator_create_plan(text, jsonb) from public, anon;
grant execute on function operator_create_plan(text, jsonb) to authenticated;

-- ---- Editing one, while it is still a draft --------------------------------

create or replace function operator_set_plan(p_plan text, p_patch jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    in_use  boolean;
    engines text[];
    engine  text;
    -- Everything a customer agreed to. `is_active` is not here on purpose.
    terms   text[] := array[
        'label', 'summary', 'price', 'currency', 'included_minutes',
        'included_numbers', 'overage_per_minute', 'sort_order', 'engines'
    ];
    field   text;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    select exists (select 1 from organizations o where o.plan = p_plan) into in_use;

    if in_use then
        foreach field in array terms loop
            if p_patch ? field then
                raise exception
                    'somebody is on this plan, so its terms are settled. Create a new plan and move the workspace to it at the end of its billing period.';
            end if;
        end loop;
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
           sort_order = coalesce(nullif(p_patch ->> 'sort_order', '')::int, sort_order),
           is_active = coalesce((p_patch ->> 'is_active')::boolean, is_active)
     where id = p_plan;

    if not found then
        raise exception 'no such plan';
    end if;

    -- Replaced wholesale rather than merged: the field is the complete list of
    -- what this plan includes, and a merge would make removing an engine
    -- impossible to express.
    if p_patch ? 'engines' then
        engines := coalesce(
            array(select jsonb_array_elements_text(p_patch -> 'engines')),
            array[]::text[]
        );
        delete from plan_entitlements
         where plan_id = p_plan and kind = 'engine'
           and not (item_id = any (engines));
        foreach engine in array engines loop
            if not exists (select 1 from public.engines e
                            where e.id::text = engine and e.org_id is null) then
                raise exception 'engine % is not a platform engine', engine;
            end if;
            insert into plan_entitlements (plan_id, kind, item_id)
            values (p_plan, 'engine', engine)
            on conflict do nothing;
        end loop;
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_plan(text, jsonb) from public, anon;
grant execute on function operator_set_plan(text, jsonb) to authenticated;
