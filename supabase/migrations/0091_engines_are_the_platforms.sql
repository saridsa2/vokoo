-- Engines belong to the platform, and a tenant never sees what they are made of.
--
-- An engine is which model hears, which thinks, which speaks, and in what
-- order. That is the product — `Hindi relay (Sarvam)` exists because Sarvam
-- beat ElevenLabs at both ends on real calls, which is a finding somebody paid
-- for. A tenant stitches call flows; it does not compose engines and does not
-- read the model names inside one.
--
-- `org_id = null` is the shape this codebase has now used three times for the
-- same idea — the number pool (0086), the platform keys (0084, 0090) and now
-- engines: held by the operator, invisible to every tenant, lent by assignment.
--
-- ## Nothing on the call path changes
--
-- The bridge reads engines with `service_role`, which is not subject to RLS,
-- and reaches one through `agents.engine_id` — a foreign key to a row, not to a
-- row *in an organisation*. So folding the owner away leaves every published
-- engine answering exactly as it did.

-- ---- The fold --------------------------------------------------------------

alter table engines alter column org_id drop not null;

comment on column engines.org_id is
    'Always NULL: an engine is the platform''s. The column survives so the shape matches phone_numbers and vendor_credentials, and so a bespoke engine for one customer remains expressible without a migration.';

update engines set org_id = null, updated_at = now() where org_id is not null;

-- `engines_org_id_slug_key` treats NULLs as distinct, so it stops enforcing
-- anything the moment every row is a platform row. Two engines called the same
-- thing is how somebody points an agent at the wrong one.
create unique index if not exists engines_platform_slug
    on engines (slug) where org_id is null;

-- ---- A tenant may not read one ---------------------------------------------

-- `config` carries `{"tts": {"model": "bulbul:v3", "voice": "priya"}}`. Hiding
-- that in the console while leaving the table readable would hide it from the
-- screen and not from the API, which is not hiding it.
--
-- What a tenant needs is the *name* of the engine its agent runs on, and that
-- comes from `available_engines` below.
drop policy if exists org_member_access on engines;

create policy engines_operator_only on engines
    for all to authenticated
    using (is_platform_admin())
    with check (is_platform_admin());

-- ---- Which engines a workspace may use -------------------------------------

-- An entitlement, reusing the machinery that already exists rather than a
-- second assignment table. `kind = 'engine'`, `item_id` is the engine's id, and
-- `org_may` already resolves override → plan → false.
--
-- It also makes the Entitlements tab mean something. Every other kind there is
-- read by nothing; this one decides what a customer can actually run on.
alter table plan_entitlements drop constraint if exists plan_entitlements_kind_check;
alter table plan_entitlements add constraint plan_entitlements_kind_check
    check (kind = any (array['provider', 'model', 'engine_stage', 'carrier', 'capability', 'engine']));

alter table organization_entitlements drop constraint if exists organization_entitlements_kind_check;
alter table organization_entitlements add constraint organization_entitlements_kind_check
    check (kind = any (array['provider', 'model', 'engine_stage', 'carrier', 'capability', 'engine']));

-- Every plan starts with every published engine, so the fold changes nothing
-- anybody can observe. Narrowing a plan is then a deliberate act rather than
-- something that happened to every customer during a migration.
insert into plan_entitlements (plan_id, kind, item_id)
select p.id, 'engine', e.id::text
  from plans p
 cross join engines e
 where e.status = 'published'
on conflict do nothing;

-- ---- What a tenant is allowed to see ---------------------------------------

-- The engines a workspace may point an agent at.
--
-- **Deliberately no `config` and no `mode`.** `config` is the model names, and
-- `mode` is `realtime` or `cascading` — which is an implementation fact ("one
-- model" versus "three services") that a customer choosing a voice does not
-- need and can shop on. What comes back is a name and a description, which is
-- what a picker needs.
create or replace function available_engines(p_org uuid)
returns table (id uuid, name text, description text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not (is_org_member(p_org) or is_platform_admin() or caller_is_service_role()) then
        raise exception 'not a member of that organisation';
    end if;

    return query
    select e.id, e.name, e.description
      from engines e
     where e.status = 'published'
       and org_may(p_org, 'engine', e.id::text)
     order by e.name;
end;
$$;

revoke all on function available_engines(uuid) from public, anon;
grant execute on function available_engines(uuid) to authenticated, service_role;

comment on function available_engines is
    'The engines a workspace may attach to an agent: a name and a description, never the models inside. What an engine is made of is the platform''s.';

-- ---- Pricing follows the engine --------------------------------------------

-- 0090 put the price on the engine while engines were still per-workspace, so
-- two customers on "Hindi relay" had two independent prices by accident. With
-- one row per engine there is one price list, which is what a price list is.
--
-- A price for one customer stays expressible — an engine row with an `org_id`
-- and its own price — but it now has to be created on purpose.
comment on column engines.price_per_minute is
    'What a minute on this engine is sold for, across every workspace on it. NULL means unpriced, which `engine_charge` reports as NULL rather than as free.';
