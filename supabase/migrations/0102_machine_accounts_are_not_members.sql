-- A machine is not a member you can email.
--
-- `operator_members` listed every membership as a person, so Vayuveda's API-key
-- service account — `svc.<org>@machine.vokoo.internal`, display name "API
-- keys" — appeared in the Members tab offering "Send sign-in link" and "Set
-- password". Neither means anything: that address receives no mail and nothing
-- ever signs in as it. It exists so a pushed tool has an identity.
--
-- Identified by the address rather than by the role, because `developer` is a
-- role a person can hold too. The `@machine.vokoo.internal` domain is issued
-- by us and reaches nothing.
-- Dropped first: the column list is part of the signature, so adding one is
-- refused by `create or replace`.
drop function if exists operator_members(uuid);
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
    is_machine     boolean,
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
           coalesce(u.email like '%@machine.vokoo.internal', false),
           m.created_at
      from memberships m
      left join auth.users u on u.id = m.user_id
     where m.org_id = p_org
     order by m.created_at;
end;
$$;

revoke all on function operator_members(uuid) from public, anon;
grant execute on function operator_members(uuid) to authenticated;

-- And the password route refuses one outright, so the rule is not merely a
-- screen choosing what to draw.
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

    if p_password is null or length(p_password) < 12 then
        raise exception 'a password must be at least 12 characters';
    end if;

    if not exists (select 1 from memberships
                    where org_id = p_org and user_id = p_user) then
        raise exception 'that account is not a member of this workspace';
    end if;

    if exists (select 1 from platform_admins where user_id = p_user) then
        raise exception 'that account administers the platform — its password cannot be set here';
    end if;

    -- ---- added in 0102 ----
    if exists (select 1 from auth.users
                where id = p_user and email like '%@machine.vokoo.internal') then
        raise exception 'that is a service account, not a person — it has no password and no mailbox';
    end if;

    update auth.users
       set encrypted_password = crypt(p_password, gen_salt('bf')),
           updated_at = now()
     where id = p_user;

    if not found then
        raise exception 'no such account';
    end if;

    insert into account_passwords (user_id, set_at, set_by)
    values (p_user, now(), 'operator')
    on conflict (user_id) do update set set_at = now(), set_by = 'operator';

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_member_password(uuid, uuid, text) from public, anon;
grant execute on function operator_set_member_password(uuid, uuid, text) to authenticated;
