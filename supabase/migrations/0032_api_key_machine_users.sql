-- API keys, and the principal they act as.
--
-- `api_keys` has existed since the schema was laid down and has never had a row
-- or a reader. What blocked it was not the table: RLS asks *which person* is
-- calling — `is_org_member` joins `memberships` on `auth.uid()` — and a key
-- belongs to an organisation, not a person. There is no `auth.uid()` for an org.
--
-- Three ways out were considered. Minting a JWT for the org needs `is_org_member`
-- to stop reading `auth.uid()`, which edits the predicate guarding every table in
-- the system. Pointing the key at its creator makes a CI credential die when
-- somebody leaves and inherit permissions nobody granted it.
--
-- This is the third: the key acts as a **machine user** in the organisation. RLS
-- is untouched, `auth.uid()` resolves to a real row, and the key is a principal
-- that can be listed, audited and revoked like any other member.

begin;

-- ---------------------------------------------------------------------------
-- The principal
-- ---------------------------------------------------------------------------

alter table public.api_keys
  add column if not exists user_id uuid
  constraint api_keys_user_id_fkey references auth.users(id) on delete cascade;

comment on column public.api_keys.user_id is
  'The machine user this key acts as. RLS resolves auth.uid() to this row, so a key is a member of exactly one organisation.';

-- `security definer` because creating the principal requires writing to
-- `auth.users`, which no application role may do directly.
create or replace function public.machine_user_for_org(p_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email   text := format('svc.%s@machine.vokoo.internal', p_org_id);
begin
  -- Idempotent: minting a second key for an organisation reuses the principal
  -- rather than accumulating one machine user per key. Keys are revoked
  -- individually; the identity they share outlives any one of them.
  select m.user_id into v_user_id
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org_id and u.email = v_email
   limit 1;

  if v_user_id is not null then
    return v_user_id;
  end if;

  v_user_id := gen_random_uuid();

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user_id, 'authenticated', 'authenticated', v_email, now(),
    jsonb_build_object('provider', 'vokoo_machine', 'org_id', p_org_id),
    jsonb_build_object('display_name', 'API keys'),
    now(), now()
  );

  -- 'developer', not 'owner' or 'admin'. A key can read and write the things an
  -- SDK pushes — tools, functions, flows — and `is_org_admin` keeps it away from
  -- memberships and from minting further keys. A leaked key must not be able to
  -- issue its own replacement and outlive being revoked.
  insert into public.memberships (org_id, user_id, role, display_name)
  values (p_org_id, v_user_id, 'developer', 'API keys')
  on conflict (org_id, user_id) do nothing;

  return v_user_id;
end;
$$;

revoke all on function public.machine_user_for_org(uuid) from public;
grant execute on function public.machine_user_for_org(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Minting a key is an admin act
-- ---------------------------------------------------------------------------

-- The table shipped with one policy covering every command, so any member could
-- mint. Combined with a machine user that is itself a member, that is a way for
-- a leaked key to issue its own replacement and survive revocation. Reading
-- stays open to members — a key's prefix and last use are not secrets, and the
-- secret itself is not stored.
drop policy if exists org_member_access on public.api_keys;
-- Dropped before creating so the migration can be re-run after a failure later
-- in the file. A migration that only works on a clean database is one you
-- cannot fix forward.
drop policy if exists api_keys_select on public.api_keys;
drop policy if exists api_keys_manage on public.api_keys;

create policy api_keys_select on public.api_keys
  for select to authenticated
  using (is_org_member(org_id));

create policy api_keys_manage on public.api_keys
  for all to authenticated
  using (is_org_admin(org_id))
  with check (is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- Presenting a key
-- ---------------------------------------------------------------------------

-- Called before the caller has any identity, so it runs as definer and is
-- reachable with the anon key. That is deliberate: the alternative is giving the
-- control plane the service role key so it can read `api_keys` past RLS, and a
-- process that holds the service key can read every table in every organisation.
-- This one can answer exactly one question.
--
-- `p_hash` is sha256(key). A key is 32 random bytes, so there is no dictionary
-- to attack and a slow KDF would buy nothing while costing latency on every
-- request. The lookup is by prefix, which is indexed and not secret.
create or replace function public.resolve_api_key(p_prefix text, p_hash text)
returns table (org_id uuid, user_id uuid, scopes text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_org    uuid;
  v_user   uuid;
  v_scopes text[];
begin
  -- Locals throughout, assigned to the OUT parameters only at the end. Reading
  -- `user_id` inside a query against `memberships` is ambiguous between the OUT
  -- parameter and the column, and Postgres rejects the function at call time
  -- rather than at definition time.
  select k.id, k.org_id, k.user_id, k.scopes
    into v_id, v_org, v_user, v_scopes
    from public.api_keys k
   where k.prefix = p_prefix
     and k.key_hash = p_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now())
   limit 1;

  if v_id is null then
    return;
  end if;

  -- A key whose principal was removed from the organisation stops working, so
  -- deleting the machine user is a second way to revoke every key at once.
  if not exists (
    select 1 from public.memberships m where m.user_id = v_user and m.org_id = v_org
  ) then
    return;
  end if;

  -- Written on every accepted presentation. This is the only signal that tells
  -- somebody a key they forgot about is still in use.
  update public.api_keys set last_used_at = now() where id = v_id;

  org_id := v_org;
  user_id := v_user;
  scopes := v_scopes;
  return next;
end;
$$;

revoke all on function public.resolve_api_key(text, text) from public;
grant execute on function public.resolve_api_key(text, text) to anon, authenticated, service_role;

commit;
