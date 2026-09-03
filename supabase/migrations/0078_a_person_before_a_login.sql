-- A person can be in the workspace before they have a login.
--
-- `memberships.user_id` was `not null`, which made a membership a fact about an
-- *account* rather than about a person. Two consequences, both of which have
-- been visible:
--
--   * "Invite Member" could not be built. There was no row shape for somebody
--     who has been added and has not signed in, so the button did nothing.
--   * `invited_email` was a column nothing could ever fill — it existed for
--     exactly this state and the constraint forbade the state.
--
-- The one that matters for this product: **a receptionist does not need a
-- login.** They need an extension and the desktop app, which carries its own
-- SIP credentials. Requiring an auth account before they can be given an
-- extension is requiring a thing their job never touches.
--
-- So a membership is a person, and `user_id` is "they have signed in". Null
-- means added and not yet arrived.

alter table memberships alter column user_id drop not null;

comment on column memberships.user_id is
    'Their auth account, once they have one. Null means added to the workspace and not yet signed in — which is what invited_email is for.';

-- Two people cannot hold one account, and one email cannot be added twice.
--
-- The old shape needed neither: `user_id` was required, so it carried
-- uniqueness implicitly. With it nullable, both have to be said. Partial
-- indexes rather than plain uniques, because many rows may legitimately have a
-- null user and Postgres treats nulls as distinct.
create unique index if not exists memberships_one_account
    on memberships (org_id, user_id) where user_id is not null;

create unique index if not exists memberships_one_invite
    on memberships (org_id, lower(invited_email)) where invited_email is not null;

-- An extension belongs to a person, not to an account.
--
-- `agent_extensions.user_id` references `auth.users`, so an extension could
-- only be given to somebody who had already signed in — the same constraint one
-- table along, and the reason the live `4001` belongs to nobody. It points at
-- the membership now, which exists from the moment somebody is added.
--
-- `user_id` stays, and is not redundant: `my_agent_extension` keys on
-- `auth.uid()` so that a person fetches their own credentials, and the bridge's
-- escalation finds an endpoint by auth user. Keeping both means an extension
-- can be handed out on day one and still be *theirs* the day they sign in.
alter table agent_extensions
    add column if not exists membership_id uuid references memberships (id) on delete set null;

comment on column agent_extensions.membership_id is
    'The person. Set when the extension is created; user_id follows when they sign in.';

create index if not exists agent_extensions_membership_idx
    on agent_extensions (membership_id);

-- Attach the extensions that already exist to the person they name.
--
-- Only where the auth user already matches — never by guessing from a display
-- name. `4001` has no user and stays unattached, which the console shows as
-- "belonging to nobody" rather than quietly assigning it to somebody.
update agent_extensions a
   set membership_id = m.id
  from memberships m
 where m.org_id = a.org_id
   and m.user_id is not null
   and m.user_id = a.user_id
   and a.membership_id is null;

-- Signing in claims the membership that was waiting for you.
--
-- Without this, somebody added by email and then signing up would get an
-- account with no organisation and an empty console, while their row sat there
-- holding their extension. Matching on the address is what closes that.
--
-- Case-insensitive, because an address is, and somebody typing `Priya@` into
-- the invite box and `priya@` at signup is the same person.
create or replace function claim_membership()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    update memberships
       set user_id      = new.id,
           invited_email = null,
           updated_at   = now()
     where user_id is null
       and lower(invited_email) = lower(new.email);

    -- And any extension held for them, so their softphone can fetch its own
    -- credentials the first time they sign in.
    update agent_extensions a
       set user_id = new.id
      from memberships m
     where m.user_id = new.id
       and a.membership_id = m.id
       and a.user_id is null;

    return new;
end;
$$;

drop trigger if exists claim_membership_on_signup on auth.users;
create trigger claim_membership_on_signup
    after insert on auth.users
    for each row execute function claim_membership();

comment on function claim_membership is
    'On signup, attach the person to the membership added for their email, and to any extension held for them.';

-- `org_people` has to survive a person having no account.
--
-- It inner-joined `auth.users`, which was right when every membership had one
-- and drops the row now that they need not. Somebody added and not yet signed
-- in would simply not appear on the screen that added them.
--
-- The address falls back to `invited_email`, which is the whole point of that
-- column: before they sign in it is the only way to name them.
--
-- The extension joins on `membership_id` rather than `user_id`, because that is
-- the link that exists from the moment they are added.
create or replace function org_people(p_org uuid)
returns table (
    membership_id uuid,
    user_id       uuid,
    email         text,
    display_name  text,
    role          text,
    joined_at     timestamptz,
    extension_id  uuid,
    extension     text,
    endpoint      text,
    agent_status  text,
    is_service    boolean,
    -- They have been added and have not signed in. A screen shows this rather
    -- than an empty column, because "no account yet" and "no name" look the
    -- same and are not.
    is_pending    boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if not is_org_member(p_org) then
        raise exception 'not a member of this organisation';
    end if;

    return query
    select m.id,
           m.user_id,
           coalesce(u.email::text, m.invited_email),
           coalesce(nullif(m.display_name, ''), a.display_name),
           m.role,
           m.created_at,
           a.id,
           a.extension,
           a.endpoint,
           a.status,
           coalesce(u.email like 'svc.%@machine.vokoo.internal', false),
           m.user_id is null
      from memberships m
      left join auth.users u on u.id = m.user_id
      left join agent_extensions a
             on a.membership_id = m.id and a.org_id = m.org_id
     where m.org_id = p_org
     order by m.created_at;
end;
$$;

revoke all on function org_people(uuid) from public, anon;
grant execute on function org_people(uuid) to authenticated;
