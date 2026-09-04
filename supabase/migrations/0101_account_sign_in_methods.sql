-- Which way an account signs in, so the form can ask for the right thing.
--
-- ## The signal did not exist
--
-- The obvious test — does `auth.users.encrypted_password` have a value — is
-- true for everybody. GoTrue writes a random bcrypt hash when it creates an
-- account from a magic link, so an account that has never had a password
-- carries a 60-character `$2a$` hash indistinguishable from one whose owner
-- chose theirs. Measured, not assumed: `pop@sarvathra.ai` had never signed in
-- and had exactly that.
--
-- Branching on it would have shown a password field to precisely the people
-- who do not have one.
--
-- So the marker is ours. A row here means somebody deliberately set a password
-- — an operator on a support call, or the member themselves — and its absence
-- means the account has only ever been reachable by link.

create table if not exists account_passwords (
    user_id  uuid primary key references auth.users(id) on delete cascade,
    set_at   timestamptz not null default now(),
    -- Who set it. An operator-set password is a temporary one read out over a
    -- phone call, and worth being able to tell apart from one its owner chose.
    set_by   text not null default 'self' check (set_by in ('self', 'operator'))
);

comment on table account_passwords is
    'Accounts that have deliberately been given a password. `auth.users.encrypted_password` cannot answer this — GoTrue writes a random hash for every magic-link account.';

alter table account_passwords enable row level security;

-- Nobody reads this directly. The two functions below are the only way in, and
-- both are definers with their own guards.
create policy account_passwords_none on account_passwords
    for all to authenticated using (false) with check (false);

-- Backfill: the two accounts that have actually signed in with a password.
-- Everything else is link-only until somebody sets one.
insert into account_passwords (user_id, set_by)
select id, 'self' from auth.users
 where last_sign_in_at is not null
   and encrypted_password is not null
on conflict do nothing;

-- ---- What the sign-in form asks -------------------------------------------

-- **This is an account-enumeration oracle, deliberately.** It is what makes a
-- progressive sign-in possible, and it was built knowing the cost.
--
-- The cost is reduced rather than accepted whole:
--
--   * An address with no account answers **exactly as a link-only account
--     does**. So the only fact this leaks is "this address has a password" —
--     never "this address exists". Since every invited member is link-only,
--     the great majority of real accounts are indistinguishable from
--     addresses that were never heard of.
--   * The control plane rate-limits it per client. See `auth_methods` there;
--     an oracle nobody can call quickly is worth much less.
--
-- What it does not do is confirm or deny an account. A caller learns whether
-- to draw a password field, which is the whole requirement.
create or replace function account_sign_in_methods(p_email text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    has_password boolean;
begin
    select exists (
        select 1
          from auth.users u
          join account_passwords a on a.user_id = u.id
         where lower(u.email) = lower(btrim(p_email))
    ) into has_password;

    -- A link is always offered: for an account that has one it is the way in,
    -- and for an address with no account it is what makes the two answers
    -- identical.
    return json_build_object('password', has_password, 'link', true);
end;
$$;

revoke all on function account_sign_in_methods(text) from public;
-- `anon`, because the caller has not signed in yet — that is the point.
grant execute on function account_sign_in_methods(text) to anon, authenticated;

-- ---- Recording that a password was set -------------------------------------

-- The operator's route already sets a password; it now records that it did, or
-- the form would keep offering a link to somebody who has one.
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

    -- An operator must not be able to take another operator's account through
    -- a customer-support route.
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

    -- ---- added in 0101 ----
    insert into account_passwords (user_id, set_at, set_by)
    values (p_user, now(), 'operator')
    on conflict (user_id) do update set set_at = now(), set_by = 'operator';

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_set_member_password(uuid, uuid, text) from public, anon;
grant execute on function operator_set_member_password(uuid, uuid, text) to authenticated;

-- Somebody setting their own, which had no route at all. Until now a member
-- given a temporary password over the phone had no way to replace it.
create or replace function set_my_password(p_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    me uuid := auth.uid();
begin
    if me is null then
        raise exception 'not signed in';
    end if;
    if p_password is null or length(p_password) < 12 then
        raise exception 'a password must be at least 12 characters';
    end if;

    update auth.users
       set encrypted_password = crypt(p_password, gen_salt('bf')),
           updated_at = now()
     where id = me;

    insert into account_passwords (user_id, set_at, set_by)
    values (me, now(), 'self')
    on conflict (user_id) do update set set_at = now(), set_by = 'self';

    return json_build_object('ok', true);
end;
$$;

revoke all on function set_my_password(text) from public, anon;
grant execute on function set_my_password(text) to authenticated;

comment on function set_my_password is
    'Set your own password. The only route a member has to replace a temporary one an operator read out to them.';
