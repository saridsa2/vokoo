-- The platform supplies the intelligence; a tenant may bring its own.
--
-- Until now a tenant was the customer of every provider: `vendor_credentials`
-- is keyed on `org_id`, and all seven keys on this installation belong to
-- Vayuveda. That was right when there was one tenant who happened to be the
-- operator. It is wrong as a product — a clinic has no Gemini account and
-- should not be asked to open one — and it is why a newly provisioned
-- workspace could do nothing at all.
--
-- So the platform holds keys, a tenant's calls run on them, and bringing your
-- own becomes a capability rather than the only way.
--
-- ## Two capabilities, not one
--
-- `byo_intelligence` covers the models — who hears, thinks and speaks.
-- `byo_carrier` covers telephony, which is a separate commercial relationship:
-- a workspace on the operator's DID pool uses the platform's KooKoo account,
-- and one that brings its own carrier uses theirs. A single switch would have
-- meant a tenant supplying its own Gemini key also had to supply a carrier.
--
-- Both are entitlements, so they inherit the machinery already built: a plan
-- carries them, a workspace overrides, and "no row" means ask the plan.

alter table plan_entitlements drop constraint if exists plan_entitlements_kind_check;
alter table plan_entitlements add constraint plan_entitlements_kind_check
    check (kind in ('provider', 'model', 'engine_stage', 'carrier', 'capability'));

alter table organization_entitlements drop constraint if exists organization_entitlements_kind_check;
alter table organization_entitlements add constraint organization_entitlements_kind_check
    check (kind in ('provider', 'model', 'engine_stage', 'carrier', 'capability'));

-- Growth may bring its own; Starter runs on ours. Deliberately not granted to
-- Starter: the whole point of the default plan is that a customer needs no
-- accounts anywhere.
insert into plan_entitlements (plan_id, kind, item_id) values
    ('growth', 'capability', 'byo_intelligence'),
    ('growth', 'capability', 'byo_carrier')
on conflict do nothing;

-- **Vayuveda keeps what it has.** It is a live line running on its own keys,
-- and a migration that moved it onto platform keys it does not have would take
-- a working call path away — the fault this file's own history keeps recording.
insert into organization_entitlements (org_id, kind, item_id, allowed)
select id, 'capability', 'byo_intelligence', true from organizations where slug = 'vayuveda'
union all
select id, 'capability', 'byo_carrier', true from organizations where slug = 'vayuveda'
on conflict (org_id, kind, item_id) do update set allowed = true;

-- ---- Keys the platform holds -----------------------------------------------

-- `org_id` becomes nullable, and null means "the platform's".
--
-- One table rather than two, because a second would be a second encryption
-- path, a second RLS story and a second thing to get wrong — and the vault
-- reference, the vendor list and the "never readable by the console" property
-- are identical either way.
alter table vendor_credentials alter column org_id drop not null;

comment on column vendor_credentials.org_id is
    'The tenant this key belongs to. NULL is the platform''s own key, used by any tenant not entitled to bring their own.';

-- Nullable breaks whatever uniqueness the not-null column was carrying:
-- Postgres treats nulls as distinct, so without these a vendor could acquire
-- several platform keys and resolution would pick one arbitrarily.
create unique index if not exists vendor_credentials_one_per_org
    on vendor_credentials (org_id, vendor) where org_id is not null;

create unique index if not exists vendor_credentials_one_platform
    on vendor_credentials (vendor) where org_id is null;

-- RLS: a platform key must be invisible to every tenant.
--
-- The existing policies are org-scoped, so a null `org_id` matches none of them
-- and the row is already unreachable — but that is a property of how the
-- policies happen to be written rather than something stated. Saying it means
-- a later policy cannot widen it by accident.
create policy vendor_credentials_no_platform_rows on vendor_credentials
    for select to authenticated
    using (org_id is not null and is_org_member(org_id));

-- ---- Does this workspace have this capability ------------------------------

-- The entitlement question, asked the same way everywhere.
--
-- `security definer` because the bridge asks it while resolving a key, and the
-- bridge acts as `service_role` rather than as a member — but it is also asked
-- by the console for its own organisation, so the guard is membership *or*
-- platform admin *or* the service role, and never simply true.
create or replace function org_may(p_org uuid, p_kind text, p_item text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not (
        coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
        or is_org_member(p_org)
        or is_platform_admin()
    ) then
        raise exception 'not permitted to read that organisation''s entitlements';
    end if;

    -- An explicit override wins over the plan, in both directions.
    return coalesce(
        (select x.allowed from organization_entitlements x
          where x.org_id = p_org and x.kind = p_kind and x.item_id = p_item),
        exists (select 1 from plan_entitlements e
                  join organizations o on o.plan = e.plan_id
                 where o.id = p_org and e.kind = p_kind and e.item_id = p_item),
        false
    );
end;
$$;

revoke all on function org_may(uuid, text, text) from public, anon;
grant execute on function org_may(uuid, text, text) to authenticated, service_role;

-- ---- Resolving a key, now that there are two places to look ----------------

-- The tenant's own key when they are entitled to one and have one; the
-- platform's otherwise.
--
-- **This function was migration 0046's security hole** — a `security definer`
-- granted to `anon`, returning decrypted provider keys for any org id. It is
-- service_role only since then, and the fallback raises the stakes rather than
-- lowering them: it can now return the *platform's* keys, so an accidental
-- grant here would leak every provider account rather than one tenant's.
--
-- The grant is therefore re-asserted at the end of this file rather than
-- assumed to have survived, and `anon` is revoked again explicitly.
--
-- The capability depends on the vendor: telephony is a different commercial
-- relationship from the models, so a tenant may bring its own carrier and still
-- run its models on ours, or the reverse.
create or replace function resolve_vendor_secret(p_org_id uuid, p_vendor text)
returns text
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
    capability text := case
        when p_vendor in ('kookoo', 'whatsapp', 'twilio', 'exotel') then 'byo_carrier'
        else 'byo_intelligence'
    end;
    found_secret text;
begin
    -- Their own, but only if they are allowed one. A workspace that is not
    -- entitled to bring its own key must not silently run on a key somebody
    -- pasted in before the entitlement was withdrawn.
    if p_org_id is not null and org_may(p_org_id, 'capability', capability) then
        select s.decrypted_secret into found_secret
          from public.vendor_credentials c
          join vault.decrypted_secrets s on s.id = c.secret_ref::uuid
         where c.org_id = p_org_id and c.vendor = p_vendor;

        if found_secret is not null then
            return found_secret;
        end if;
    end if;

    -- The platform's.
    select s.decrypted_secret into found_secret
      from public.vendor_credentials c
      join vault.decrypted_secrets s on s.id = c.secret_ref::uuid
     where c.org_id is null and c.vendor = p_vendor;

    return found_secret;
end;
$$;

revoke all on function resolve_vendor_secret(uuid, text) from public, anon, authenticated;
grant execute on function resolve_vendor_secret(uuid, text) to service_role;

comment on function resolve_vendor_secret is
    'A tenant''s own key when entitled and present, otherwise the platform''s. service_role only: this returns decrypted secrets, and since the platform fallback it can return every provider account rather than one tenant''s.';
