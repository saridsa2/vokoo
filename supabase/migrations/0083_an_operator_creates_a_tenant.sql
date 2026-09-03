-- An operator creates a tenant.
--
-- The portal could list, price, restrict and suspend workspaces and could not
-- make one — which is the only thing a provisioning portal must do. Creating
-- one by hand meant SQL, so the screen described a job it could not perform.
--
-- ## An owner who does not exist yet
--
-- A new tenant needs somebody to own it, and that person has no account: they
-- are being handed a workspace, not signing up for one. Migration 0078 already
-- made that state expressible — `memberships.user_id` is nullable and
-- `invited_email` finally means something — so this creates the organisation
-- and an owner membership carrying an address, and `claim_membership()`
-- attaches the person the first time they sign in.
--
-- Which means **the invitation is an email, not a password handed over**. That
-- is the difference between provisioning a customer and provisioning a
-- receptionist, and it is why this and the mail server landed together.

create or replace function operator_create_tenant(
    p_name text,
    p_slug text,
    p_owner_email text,
    p_plan text
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

    return json_build_object(
        'id', new_org,
        'slug', cleaned_slug,
        'owner_email', nullif(lower(btrim(coalesce(p_owner_email, ''))), '')
    );
end;
$$;

revoke all on function operator_create_tenant(text, text, text, text) from public, anon;
grant execute on function operator_create_tenant(text, text, text, text) to authenticated;

comment on function operator_create_tenant is
    'Create a workspace and an owner membership for an address that may have no account yet. The person is attached by claim_membership() when they first sign in.';
