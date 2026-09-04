-- The people in a workspace, and a way to get one of them back in.
--
-- There was no way to help a locked-out customer. Accounts here are created by
-- an invitation, which is a magic link, so nobody has ever chosen a password —
-- and an operator had no route to set one or to send another link.
--
-- ## Passwords, and why they are written here rather than through GoTrue
--
-- Setting one through the auth admin API needs `service_role`, and the control
-- plane deliberately holds none: a process with that key can read every table
-- in every organisation. `auth.users.encrypted_password` is bcrypt, which
-- pgcrypto writes directly, so a guarded definer does the job without that key
-- existing anywhere in the request path.
--
-- ## What the guard has to stop
--
-- A platform admin setting a *platform admin's* password is privilege
-- escalation dressed as support: the second operator's account is how the first
-- one is held accountable. So this refuses on any account that administers the
-- platform, and on any account that is not a member of the workspace being
-- operated on.

create extension if not exists pgcrypto;

-- ---- Who is in a workspace -------------------------------------------------

create or replace function operator_members(p_org uuid)
returns table (
    membership_id  uuid,
    user_id        uuid,
    email          text,
    display_name   text,
    role           text,
    invited_email  text,
    last_sign_in   timestamptz,
    is_operator    boolean,
    joined         timestamptz
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
    select m.id,
           m.user_id,
           u.email::text,
           m.display_name,
           m.role,
           m.invited_email,
           u.last_sign_in_at,
           exists (select 1 from platform_admins a where a.user_id = m.user_id),
           m.created_at
      from memberships m
      left join auth.users u on u.id = m.user_id
     where m.org_id = p_org
     order by m.created_at;
end;
$$;

revoke all on function operator_members(uuid) from public, anon;
grant execute on function operator_members(uuid) to authenticated;

-- ---- Set a password --------------------------------------------------------

create or replace function operator_set_member_password(
    p_org        uuid,
    p_user       uuid,
    p_password   text
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

    -- Long enough that a support call does not hand somebody a guessable
    -- account. Checked here rather than in a screen, because a screen is not
    -- what enforces it.
    if p_password is null or length(p_password) < 12 then
        raise exception 'a password must be at least 12 characters';
    end if;

    if not exists (select 1 from memberships
                    where org_id = p_org and user_id = p_user) then
        raise exception 'that account is not a member of this workspace';
    end if;

    -- See the header: an operator must not be able to take another operator's
    -- account through a customer-support route.
    if exists (select 1 from platform_admins where user_id = p_user) then
        raise exception 'that account administers the platform — its password cannot be set here';
    end if;

    update auth.users
       set encrypted_password = crypt(p_password, gen_salt('bf')),
           updated_at = now()
     where id = p_user;

    if not found then
        raise exception 'no such account';
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_member_password(uuid, uuid, text) from public, anon;
grant execute on function operator_set_member_password(uuid, uuid, text) to authenticated;

comment on function operator_set_member_password is
    'Set a workspace member''s password. Refuses on any account that administers the platform: taking a fellow operator''s account through a support route is escalation, not support.';

-- ---- Remove somebody -------------------------------------------------------

create or replace function operator_remove_member(p_org uuid, p_membership uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    target uuid;
    owners integer;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    select user_id into target from memberships
     where id = p_membership and org_id = p_org;
    if not found then
        raise exception 'no such member of this workspace';
    end if;

    -- A workspace with no owner is one nobody can administer, and the only way
    -- back is an operator. Refusing here is cheaper than that conversation.
    select count(*) into owners from memberships
     where org_id = p_org and role = 'owner' and id <> p_membership;
    if owners = 0 and exists (select 1 from memberships
                               where id = p_membership and role = 'owner') then
        raise exception 'that is the last owner — make somebody else an owner first';
    end if;

    -- The membership goes; the account does not. They may belong to another
    -- workspace, and deleting an account to remove it from one is a far larger
    -- act than the operator asked for.
    delete from memberships where id = p_membership and org_id = p_org;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_remove_member(uuid, uuid) from public, anon;
grant execute on function operator_remove_member(uuid, uuid) to authenticated;
