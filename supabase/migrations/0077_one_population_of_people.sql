-- One population of people, and the workspace's own settings.
--
-- ## An agent is not a second kind of person
--
-- `memberships` said who may use the console and `agent_extensions` said who
-- takes calls, and nothing joined them: two lists over the same staff, each
-- silent about the other. The Members screen showed uuid prefixes and no
-- extensions; the Team screen showed extensions belonging to nobody.
--
-- There is one population. A person is a member of the workspace; an extension
-- is something they may have. So `agent` becomes a role rather than a separate
-- register — a receptionist is a member who answers the phone, not an entry in
-- a parallel system.
--
-- **Why a new role rather than reusing `viewer`.** `viewer` means "may read the
-- console", which for a receptionist would be every flow, every call log and
-- every cost. `agent` grants the console nothing but their own credentials and
-- their own duty state.

alter table memberships drop constraint if exists memberships_role_check;
alter table memberships add constraint memberships_role_check
    check (role in ('owner', 'admin', 'developer', 'viewer', 'agent'));

comment on column memberships.role is
    'owner/admin configure; developer holds API keys; viewer reads; agent answers the phone and sees only their own credentials.';

-- The business's own clock.
--
-- The dashboard has been using the *viewer's* browser timezone and saying so,
-- because there was nothing to consult — which means two people in different
-- places see different numbers for "today" and both are right. A business has
-- one working day.
--
-- Nullable on purpose. Null is "nobody has said", which the console can answer
-- by falling back to the viewer's own zone; a default of 'UTC' would look like
-- a decision somebody made and would be wrong for every customer.
alter table organizations add column if not exists timezone text;

comment on column organizations.timezone is
    'IANA zone for the business day. Null means nobody has set one; readers fall back to the viewer''s own.';

-- Who the people are, with everything a screen needs about them.
--
-- **`security definer`, because emails live in `auth.users`** and PostgREST
-- serves only the `public` schema — a plain view over it would return nothing
-- to a caller who has no rights there, and a `security_invoker` one cannot help.
--
-- This project has been bitten twice by definer objects: `resolve_vendor_secret`
-- returned decrypted provider keys to `anon` (0046), and four cost views ran as
-- their owner and showed every organisation's spend to any signed-in user
-- (0056). So the guard is the first statement in the body, the grant is to
-- `authenticated` and never to `anon`, and the function takes the organisation
-- as an argument rather than trusting one in a header.
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
    -- A machine, not a person. API keys act as a real auth user so that a
    -- key-authenticated request reaches RLS as a member rather than bypassing
    -- it with the service role — which is right, and means the roster has a row
    -- in it that nobody works with. Named here so a screen can say so rather
    -- than listing a service account as a colleague.
    is_service    boolean
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
           u.email::text,
           coalesce(nullif(m.display_name, ''), a.display_name),
           m.role,
           m.created_at,
           a.id,
           a.extension,
           a.endpoint,
           a.status,
           u.email like 'svc.%@machine.vokoo.internal'
      from memberships m
      join auth.users u on u.id = m.user_id
      left join agent_extensions a
             on a.user_id = m.user_id and a.org_id = m.org_id
     where m.org_id = p_org
     order by m.created_at;
end;
$$;

revoke all on function org_people(uuid) from public, anon;
grant execute on function org_people(uuid) to authenticated;

comment on function org_people is
    'Everyone in one organisation: membership, email, and their extension if they have one. Definer because auth.users is not reachable through PostgREST; guarded by is_org_member.';
