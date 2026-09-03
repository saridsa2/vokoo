-- The operator layer: who runs the platform, as distinct from who uses it.
--
-- Every table in this database gates on `is_org_member(org_id)`, which means a
-- person who runs the platform and belongs to no tenant sees **nothing**. That
-- is the correct default and it is why this is a layer rather than a role: an
-- operator is not a very powerful member, they are somebody outside the tenancy
-- model entirely.
--
-- ## Which makes every function here a deliberate bypass of RLS
--
-- This project has been cut twice by exactly that. `resolve_vendor_secret` was
-- a `security definer` granted to `anon` and returned decrypted provider keys
-- for any org id (0046). Four cost views ran as their owner because
-- `security_invoker` was not set, and showed every organisation's spend to any
-- signed-in user (0056). Neither announced itself.
--
-- So the rules every function below follows, without exception:
--
--   * `is_platform_admin()` is the **first statement** in the body.
--   * granted to `authenticated`, revoked from `public` and `anon`.
--   * returns facts *about* a tenant — counts, plan, status — and never its
--     content. No transcript, no recording, no caller number. That is the
--     "outside only" decision, enforced by what the functions select rather
--     than by anybody remembering it.
--
-- ## Entitlements: a plan carries a set, a tenant may override it
--
-- `organizations.plan` already existed as free text. It becomes a real row, a
-- plan carries the catalogue items it allows, and an override handles the
-- exception — so onboarding is choosing a plan, and a pricing change is one row
-- rather than a sweep over every customer.

-- ---- Who runs the platform -------------------------------------------------

create table if not exists platform_admins (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    -- Why this person has it. An empty audit trail is what a list of uuids
    -- becomes after the third person is added.
    note       text not null default '',
    created_at timestamptz not null default now()
);

comment on table platform_admins is
    'People who run the platform. Deliberately not a membership role: an operator belongs to no tenant, so RLS shows them nothing and every operator query is an explicit definer bypass.';

alter table platform_admins enable row level security;

-- No policy at all, on purpose. Nothing reads this table through PostgREST —
-- only `is_platform_admin()` does, as a definer — so a policy would be a door
-- where there should be a wall.

create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
    select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

revoke all on function is_platform_admin() from public, anon;
grant execute on function is_platform_admin() to authenticated;

-- ---- Plans -----------------------------------------------------------------

create table if not exists plans (
    id         text primary key,
    label      text not null,
    summary    text not null default '',
    sort_order integer not null default 0,
    is_active  boolean not null default true
);

insert into plans (id, label, summary, sort_order) values
    ('starter', 'Starter', 'One number, the models everybody gets.', 0),
    ('growth',  'Growth',  'More numbers and the full model catalogue.', 1)
on conflict (id) do nothing;

-- Not a foreign key on `organizations.plan`, yet. Every existing row says
-- 'starter' and would pass, but adding the constraint is a separate decision
-- from adding the table, and a migration that does both fails as one.
comment on table plans is
    'What a tenant is sold. Carries the catalogue it may reach; a tenant overrides the exceptions.';

-- ---- What a plan allows, and what a tenant is allowed instead ---------------

-- `kind` is the catalogue a row points at. Constrained rather than free, because
-- a typo'd kind is an entitlement that silently matches nothing — which reads
-- as "this tenant may use everything" if the filter is written as an exclusion,
-- and as "nothing" if it is written as an inclusion. Neither is discoverable.
create table if not exists plan_entitlements (
    plan_id text not null references plans (id) on delete cascade,
    kind    text not null check (kind in ('provider', 'model', 'engine_stage', 'carrier')),
    item_id text not null,
    primary key (plan_id, kind, item_id)
);

create table if not exists organization_entitlements (
    org_id  uuid not null references organizations (id) on delete cascade,
    kind    text not null check (kind in ('provider', 'model', 'engine_stage', 'carrier')),
    item_id text not null,
    -- **Three states, not two.** A row saying `false` is "this tenant may not,
    -- whatever their plan says"; a row saying `true` is "this tenant may, even
    -- though their plan does not"; no row is "ask the plan". Two states would
    -- make revoking something a plan grants impossible without editing the plan
    -- for everybody on it.
    allowed boolean not null,
    primary key (org_id, kind, item_id)
);

alter table organization_entitlements enable row level security;

-- A tenant may *read* what it is entitled to — the console filters its own
-- catalogue with this — and may never write it. That is the operator's.
drop policy if exists organization_entitlements_read on organization_entitlements;
create policy organization_entitlements_read on organization_entitlements
    for select to authenticated
    using (is_org_member(org_id));

-- ---- Suspending a tenant ---------------------------------------------------

alter table organizations add column if not exists status text not null default 'active';

do $$
begin
    alter table organizations add constraint organizations_status_check
        check (status in ('active', 'suspended'));
exception
    when duplicate_object then null;
end $$;

comment on column organizations.status is
    'suspended keeps everything and stops the tenant being served. NOT YET ENFORCED — the bridge must refuse a call for a suspended organisation.';

-- ---- What a tenant may actually reach --------------------------------------

-- Plan set, plus what the tenant was granted, minus what it was denied.
--
-- `security invoker` deliberately — the opposite of everything else in this
-- file. A tenant reads its *own* entitlements to filter its own catalogue, so
-- this must run as the caller and be bounded by the RLS policy above. A definer
-- here would be migration 0056 again, with every tenant's entitlements readable
-- by any signed-in user.
create or replace view my_entitlements
with (security_invoker = true)
as
select o.id as org_id,
       e.kind,
       e.item_id
  from organizations o
  join plan_entitlements e on e.plan_id = o.plan
 where not exists (
       select 1 from organization_entitlements x
        where x.org_id = o.id and x.kind = e.kind
          and x.item_id = e.item_id and x.allowed = false)
union
select x.org_id, x.kind, x.item_id
  from organization_entitlements x
 where x.allowed = true;

grant select on my_entitlements to authenticated;

comment on view my_entitlements is
    'What a tenant may reach: its plan''s set, less its denials, plus its grants. security_invoker, so RLS still applies.';

-- ---- The operator's own view of every tenant -------------------------------

create or replace function operator_tenants()
returns table (
    id            uuid,
    name          text,
    slug          text,
    plan          text,
    status        text,
    created_at    timestamptz,
    members       bigint,
    agents        bigint,
    numbers       bigint,
    calls_30d     bigint,
    -- Facts about a tenant, never its content. No caller number, no transcript,
    -- no recording — that is the "outside only" decision, enforced by what this
    -- selects rather than by anybody remembering it.
    last_call_at  timestamptz
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
    select o.id, o.name, o.slug, o.plan, o.status, o.created_at,
           (select count(*) from memberships m where m.org_id = o.id),
           (select count(*) from agent_extensions a where a.org_id = o.id),
           (select count(*) from phone_numbers p where p.org_id = o.id),
           (select count(*) from calls c
             where c.org_id = o.id and c.started_at > now() - interval '30 days'),
           (select max(c.started_at) from calls c where c.org_id = o.id)
      from organizations o
     order by o.created_at;
end;
$$;

revoke all on function operator_tenants() from public, anon;
grant execute on function operator_tenants() to authenticated;

-- Change a tenant's plan or suspend it.
-- **`returns json`, not `void`.** A void function answers PostgREST with an
-- empty body, and the control plane's client tries to decode one — so the write
-- succeeded and the console threw "error decoding response body". The failure
-- looks like the write failing and is the opposite of it, which is the worst
-- shape a bug takes.
create or replace function operator_set_tenant(p_org uuid, p_plan text, p_status text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;
    if p_plan is not null and not exists (select 1 from plans where id = p_plan) then
        raise exception 'no such plan: %', p_plan;
    end if;

    update organizations
       set plan       = coalesce(p_plan, plan),
           status     = coalesce(p_status, status),
           updated_at = now()
     where id = p_org;

    if not found then
        raise exception 'no such organisation';
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_tenant(uuid, text, text) from public, anon;
grant execute on function operator_set_tenant(uuid, text, text) to authenticated;

-- Grant or deny one catalogue item to one tenant, or clear the override.
-- `returns json` for the same reason as above.
create or replace function operator_set_entitlement(
    p_org uuid, p_kind text, p_item text, p_allowed boolean
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

    if p_allowed is null then
        -- Back to whatever the plan says. Deleting rather than storing a third
        -- value, so "no opinion" is the absence of a row and cannot drift from
        -- the plan.
        delete from organization_entitlements
         where org_id = p_org and kind = p_kind and item_id = p_item;
        return json_build_object('ok', true, 'state', 'inherit');
    end if;

    insert into organization_entitlements (org_id, kind, item_id, allowed)
    values (p_org, p_kind, p_item, p_allowed)
    on conflict (org_id, kind, item_id) do update set allowed = excluded.allowed;

    return json_build_object('ok', true, 'state', case when p_allowed then 'grant' else 'deny' end);
end;
$$;

revoke all on function operator_set_entitlement(uuid, text, text, boolean) from public, anon;
grant execute on function operator_set_entitlement(uuid, text, text, boolean) to authenticated;

-- ---- Seed --------------------------------------------------------------

-- The starter plan allows what exists today, so turning entitlements on changes
-- nothing for the tenant already running. A migration that quietly narrows what
-- a live line may reach is one that takes a working call path away.
insert into plan_entitlements (plan_id, kind, item_id)
select 'starter', 'provider', id from catalogue_providers
union all
select 'starter', 'model', id from catalogue_models
union all
select 'growth', 'provider', id from catalogue_providers
union all
select 'growth', 'model', id from catalogue_models
on conflict do nothing;

-- The first operator: whoever owns the workspace that exists.
insert into platform_admins (user_id, note)
select u.id, 'Seeded with the operator layer'
  from auth.users u
 where u.email = 's.satya.suman@gmail.com'
on conflict (user_id) do nothing;

-- What one tenant may reach, as the operator needs to see it.
--
-- `my_entitlements` is `security_invoker` and bounded by membership, which is
-- right for a tenant reading its own and useless to an operator, who is a
-- member of nothing. So this is the definer counterpart: the same computation,
-- reached through the platform-admin guard instead.
--
-- It returns every catalogue item with its *state*, not only the allowed ones:
-- a screen has to show what could be granted as well as what is, and computing
-- the difference in the console would be a second implementation of the rule.
create or replace function operator_entitlements(p_org uuid)
returns table (
    kind      text,
    item_id   text,
    label     text,
    -- What the plan says on its own.
    by_plan   boolean,
    -- The tenant's own override: true granted, false denied, null none.
    override  boolean,
    -- What the two come to. This is the answer; the two above are why.
    effective boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    tenant_plan text;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    select o.plan into tenant_plan from organizations o where o.id = p_org;
    if tenant_plan is null then
        raise exception 'no such organisation';
    end if;

    return query
    with items as (
        select 'provider'::text as kind, p.id, p.label from catalogue_providers p
        union all
        select 'model'::text, m.id, m.label from catalogue_models m
    )
    select i.kind,
           i.id,
           i.label,
           exists (select 1 from plan_entitlements e
                    where e.plan_id = tenant_plan and e.kind = i.kind and e.item_id = i.id),
           x.allowed,
           coalesce(
               x.allowed,
               exists (select 1 from plan_entitlements e
                        where e.plan_id = tenant_plan and e.kind = i.kind and e.item_id = i.id)
           )
      from items i
      left join organization_entitlements x
             on x.org_id = p_org and x.kind = i.kind and x.item_id = i.id
     order by i.kind, i.label;
end;
$$;

revoke all on function operator_entitlements(uuid) from public, anon;
grant execute on function operator_entitlements(uuid) to authenticated;
