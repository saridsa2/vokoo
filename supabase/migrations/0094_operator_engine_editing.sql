-- Composing an engine is an operator's job, so it needs operator routes.
--
-- 0091 took `engines` out of the console's generic resource list, because a
-- generic route selects `*` and `config` is the model names. That left the
-- engine editor reading a route that no longer exists — correct for a tenant,
-- and it also removed the only way anybody could edit an engine at all.
--
-- These are the operator's own way back in. Guarded on `is_platform_admin()`
-- like every other `operator_*` function, and they return the whole row,
-- because the whole row is what the person composing it is entitled to see.

-- ---- Reading ---------------------------------------------------------------

create or replace function operator_engine(p_id uuid)
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
        'id', e.id,
        'name', e.name,
        'slug', e.slug,
        'description', e.description,
        'public_name', e.public_name,
        'public_description', e.public_description,
        'mode', e.mode,
        'config', e.config,
        'status', e.status,
        'price_per_minute', e.price_per_minute,
        'price_per_call', e.price_per_call,
        'price_currency', e.price_currency,
        'updated_at', e.updated_at,
        -- What it has carried, so the person setting a price can see the
        -- volume the price applies to without leaving the screen.
        'sessions_30d', coalesce((select count(*) from billing_sessions b
                                   where b.engine_id = e.id
                                     and b.started_at > now() - interval '30 days'), 0),
        'minutes_30d', coalesce((select round((sum(b.duration_secs) / 60.0)::numeric, 1)
                                   from billing_sessions b
                                  where b.engine_id = e.id
                                    and b.started_at > now() - interval '30 days'), 0),
        -- Which workspaces would lose it. Naming them matters before a
        -- withdrawal: `status` back to draft takes it off every agent using it.
        'used_by', coalesce((select json_agg(distinct o.name)
                               from agents a join organizations o on o.id = a.org_id
                              where a.engine_id = e.id), '[]'::json)
    )
    into result
    from engines e
    where e.id = p_id;

    if result is null then
        raise exception 'no such engine';
    end if;

    return result;
end;
$$;

revoke all on function operator_engine(uuid) from public, anon;
grant execute on function operator_engine(uuid) to authenticated;

-- The list gains what the operator screen shows beside the price.
drop function if exists operator_engines();
create or replace function operator_engines()
returns table (
    id                 uuid,
    name               text,
    slug               text,
    description        text,
    public_name        text,
    public_description text,
    mode               text,
    status             text,
    price_per_minute   numeric,
    price_per_call     numeric,
    price_currency     text,
    sessions_30d       bigint,
    minutes_30d        numeric,
    workspaces         bigint
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
    select e.id, e.name, e.slug, e.description, e.public_name, e.public_description,
           e.mode, e.status,
           e.price_per_minute, e.price_per_call, e.price_currency,
           coalesce(u.sessions, 0),
           coalesce(u.minutes, 0),
           coalesce((select count(distinct a.org_id) from agents a where a.engine_id = e.id), 0)
      from engines e
      left join (
            select engine_id,
                   count(*) as sessions,
                   round((sum(duration_secs) / 60.0)::numeric, 1) as minutes
              from billing_sessions
             where started_at > now() - interval '30 days'
             group by engine_id
      ) u on u.engine_id = e.id
     order by e.public_name nulls last, e.name;
end;
$$;

revoke all on function operator_engines() from public, anon;
grant execute on function operator_engines() to authenticated;

-- ---- Writing ---------------------------------------------------------------

-- One writer, taking a patch.
--
-- A column list rather than `p_patch` applied wholesale: an engine carries a
-- price and an id, and a function that writes whatever keys it is handed is one
-- typo away from a route that can set them. Only what is named here moves.
--
-- Price is deliberately **not** here — `operator_set_engine_price` owns it,
-- because it is the one field with a rule (no negatives) and folding it in
-- would put that rule somewhere it can be forgotten.
create or replace function operator_update_engine(p_id uuid, p_patch jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    new_status text := p_patch ->> 'status';
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    if new_status is not null and new_status not in ('draft', 'published') then
        raise exception 'status must be draft or published';
    end if;

    -- Publishing an engine nobody has named for customers would put it in
    -- every tenant's picker under whatever it is called internally. 0092 made
    -- `available_engines` skip those; this stops it being published in that
    -- state at all, so the operator finds out here rather than wondering why
    -- it never appears.
    if new_status = 'published'
       and coalesce(nullif(btrim(coalesce(p_patch ->> 'public_name',
                                          (select public_name from engines where id = p_id))), ''), '') = ''
    then
        raise exception 'give it a customer-facing name before publishing it';
    end if;

    update engines
       set name               = coalesce(p_patch ->> 'name', name),
           description        = coalesce(p_patch ->> 'description', description),
           -- Nullable on purpose: clearing the public name withdraws an engine
           -- from every picker without unpublishing it.
           public_name        = case when p_patch ? 'public_name'
                                     then nullif(btrim(p_patch ->> 'public_name'), '')
                                     else public_name end,
           public_description = case when p_patch ? 'public_description'
                                     then nullif(btrim(p_patch ->> 'public_description'), '')
                                     else public_description end,
           mode               = coalesce(p_patch ->> 'mode', mode),
           config             = coalesce(p_patch -> 'config', config),
           status             = coalesce(new_status, status),
           updated_at         = now()
     where id = p_id;

    if not found then
        raise exception 'no such engine';
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_update_engine(uuid, jsonb) from public, anon;
grant execute on function operator_update_engine(uuid, jsonb) to authenticated;

create or replace function operator_create_engine(p_name text, p_mode text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    new_id   uuid;
    new_slug text;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    if p_mode not in ('realtime', 'cascading') then
        raise exception 'an engine is realtime or cascading';
    end if;

    new_slug := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
    new_slug := btrim(new_slug, '-');
    if new_slug = '' then
        raise exception 'give it a name';
    end if;

    if exists (select 1 from engines where slug = new_slug and org_id is null) then
        raise exception 'an engine called that already exists';
    end if;

    -- A draft, and with no public name — so it cannot reach a caller or a
    -- picker until somebody has configured it and named it.
    insert into engines (org_id, name, slug, description, mode, config, status)
    values (null, btrim(p_name), new_slug, '', p_mode, '{}'::jsonb, 'draft')
    returning id into new_id;

    -- Every plan may reach it once published. Narrowing is deliberate; a new
    -- engine invisible to every plan for a reason nobody wrote down is not.
    insert into plan_entitlements (plan_id, kind, item_id)
    select p.id, 'engine', new_id::text from plans p
    on conflict do nothing;

    return json_build_object('id', new_id, 'slug', new_slug);
end;
$$;

revoke all on function operator_create_engine(text, text) from public, anon;
grant execute on function operator_create_engine(text, text) to authenticated;
