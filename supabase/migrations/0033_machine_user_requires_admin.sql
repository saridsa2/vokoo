-- `machine_user_for_org` checks who is asking.
--
-- Migration 0032 created it `security definer` — it has to be, since writing to
-- `auth.users` is not something an application role may do — and granted execute
-- to `authenticated`. It took the organisation as an argument and never asked
-- whether the caller belonged to it. Any logged-in user could therefore call it
-- with any organisation's id and have a row inserted into `auth.users` and a
-- `developer` membership inserted into an organisation they have nothing to do
-- with.
--
-- That is not a direct escalation: the attacker cannot authenticate as the
-- principal they created, because that needs an API key and minting one is
-- gated on `is_org_admin`. It is an unauthorised write into somebody else's
-- membership list, an unbounded way to create `auth.users` rows, and a phantom
-- member appearing in an organisation whose admins did not ask for one. It is
-- also one refactor away from being a real escalation, which is the reason a
-- definer function is expected to check its caller rather than rely on every
-- future caller checking first.
--
-- It also fixes an ordering flaw in the control plane: `mint_api_key` calls this
-- before the insert that row-level security checks, so a mint refused for a
-- non-admin still created the principal and the membership on its way to being
-- refused. With the check here, nothing is written before the refusal.

begin;

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
  -- Before any write. `is_org_admin` reads `auth.uid()`, so a call with no
  -- identity — the service role included — is refused rather than trusted;
  -- nothing calls this server-side today, and a path that needs to should say
  -- so deliberately rather than inherit permission by accident.
  --
  -- 42501 is `insufficient_privilege`, which the control plane already
  -- translates to 403 rather than reporting a database fault.
  if not public.is_org_admin(p_org_id) then
    raise exception 'not authorized to create a machine user for this organisation'
      using errcode = '42501';
  end if;

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

commit;
