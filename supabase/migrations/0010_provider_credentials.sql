-- Provider keys, kept somewhere a person can manage them.
--
-- Until now the Gemini key and the KooKoo key would have lived in a service
-- file on the VPS, added by editing `.env` over SSH. That is not a product, and
-- it means every customer needs an engineer to connect their own accounts.
--
-- The shape here is one-way: a member with the right role can *write* a secret
-- and can never read it back. `authenticated` has no grant on the function that
-- decrypts. Only the service role — the bridge, at call time — can resolve one.
-- So a compromised console session can replace a key but cannot exfiltrate one.
--
-- The secret itself lives in `vault.secrets`, encrypted with a key held outside
-- the table, and `provider_credentials.secret_ref` holds the id. That column was
-- named `ref` from the start; this fills it in.

-- ------------------------------------------------------ what can be connected

create table if not exists public.catalogue_credentials (
  id          text primary key,
  label       text not null,
  -- 'inference' or 'telephony'. The console groups by this, because connecting
  -- a phone carrier and connecting a model provider are different errands.
  kind        text not null,
  description text not null,
  help_url    text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true
);

alter table public.catalogue_credentials enable row level security;
drop policy if exists catalogue_credentials_read on public.catalogue_credentials;
create policy catalogue_credentials_read on public.catalogue_credentials
  for select to authenticated using (true);
grant select on public.catalogue_credentials to authenticated;

insert into public.catalogue_credentials (id, label, kind, description, help_url, sort_order)
values
  ('gemini', 'Google Gemini', 'inference',
   'Needed for agents whose provider is Google Gemini. Caller audio is sent to Google while such an agent is on a call.',
   'https://aistudio.google.com/apikey', 0),
  ('kookoo', 'KooKoo / Ozonetel', 'telephony',
   'Needed to act on a live call — transfer to a person, conference, hold, or stop recording. Without it a flow can talk but cannot do anything to the call.',
   'https://kookoo.in/', 1)
on conflict (id) do update set
  label = excluded.label, kind = excluded.kind,
  description = excluded.description, help_url = excluded.help_url,
  sort_order = excluded.sort_order;

-- ------------------------------------------------------------------ who may

-- Deliberately narrower than publishing. A developer may release an agent to
-- callers; connecting the account that gets billed for it is an owner's call.
create or replace function public.can_manage_credentials(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

revoke all on function public.can_manage_credentials(uuid) from public;
grant execute on function public.can_manage_credentials(uuid) to authenticated;

-- ------------------------------------------------------------------- writing

create or replace function public.set_provider_credential(
  p_org_id   uuid,
  p_provider text,
  p_secret   text,
  p_label    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.provider_credentials;
  v_vault_id uuid;
  v_hint     text;
begin
  if not public.can_manage_credentials(p_org_id) then
    raise exception 'your role may not manage provider keys' using errcode = 'P0003';
  end if;

  if coalesce(trim(p_secret), '') = '' then
    raise exception 'a key is required' using errcode = 'P0004';
  end if;

  if not exists (select 1 from public.catalogue_credentials where id = p_provider and is_active) then
    raise exception 'unknown provider %', p_provider using errcode = 'P0004';
  end if;

  -- The last four characters, so the console can show which key is in place
  -- without being able to read it. Short keys show nothing rather than most of
  -- themselves.
  v_hint := case when length(p_secret) >= 12 then right(p_secret, 4) else null end;

  select * into v_existing from public.provider_credentials
  where org_id = p_org_id and provider = p_provider;

  if v_existing.id is not null then
    -- Replace in place. Rotating a key must not change the row's id, or
    -- anything holding a reference to it breaks on rotation.
    perform vault.update_secret(v_existing.secret_ref::uuid, p_secret);
    update public.provider_credentials set
      label      = coalesce(p_label, label),
      metadata   = jsonb_build_object('hint', v_hint, 'rotated_at', now()),
      updated_at = now()
    where id = v_existing.id
    returning * into v_existing;
  else
    v_vault_id := vault.create_secret(
      p_secret,
      format('vokoo:%s:%s', p_org_id, p_provider),
      format('VoKoo provider key for %s', p_provider)
    );
    insert into public.provider_credentials (org_id, provider, label, secret_ref, metadata)
    values (p_org_id, p_provider, p_label, v_vault_id::text,
            jsonb_build_object('hint', v_hint))
    returning * into v_existing;
  end if;

  -- Never the secret, and never secret_ref: the id of a vault entry is not
  -- something a browser has any use for.
  return jsonb_build_object(
    'id', v_existing.id, 'provider', v_existing.provider, 'label', v_existing.label,
    'hint', v_existing.metadata->>'hint', 'updated_at', v_existing.updated_at
  );
end;
$$;

revoke all on function public.set_provider_credential(uuid, text, text, text) from public;
grant execute on function public.set_provider_credential(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------------- reading

-- What is connected, never what it is. Safe for the console.
create or replace function public.list_provider_credentials(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.memberships
                 where org_id = p_org_id and user_id = auth.uid()) then
    raise exception 'not a member of this organisation' using errcode = 'P0003';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'provider', c.provider, 'label', c.label,
      'hint', c.metadata->>'hint',
      'created_at', c.created_at, 'updated_at', c.updated_at
    ) order by c.provider)
    from public.provider_credentials c
    where c.org_id = p_org_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_provider_credentials(uuid) from public;
grant execute on function public.list_provider_credentials(uuid) to authenticated;

create or replace function public.delete_provider_credential(p_org_id uuid, p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
begin
  if not public.can_manage_credentials(p_org_id) then
    raise exception 'your role may not manage provider keys' using errcode = 'P0003';
  end if;

  delete from public.provider_credentials
  where org_id = p_org_id and provider = p_provider
  returning secret_ref into v_ref;

  if v_ref is not null then
    delete from vault.secrets where id = v_ref::uuid;
  end if;
end;
$$;

revoke all on function public.delete_provider_credential(uuid, text) from public;
grant execute on function public.delete_provider_credential(uuid, text) to authenticated;

-- ------------------------------------------------------- resolving, at runtime

-- The one function that returns a secret, and `authenticated` has no grant on
-- it. Only the service role — which the bridge holds and no browser ever sees —
-- can call it. That single missing grant is what makes the rest of this
-- one-way: a stolen console session can rotate a key but cannot read one.
create or replace function public.resolve_provider_secret(p_org_id uuid, p_provider text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.decrypted_secret
  from public.provider_credentials c
  join vault.decrypted_secrets s on s.id = c.secret_ref::uuid
  where c.org_id = p_org_id and c.provider = p_provider;
$$;

revoke all on function public.resolve_provider_secret(uuid, text) from public;
revoke all on function public.resolve_provider_secret(uuid, text) from authenticated;
grant execute on function public.resolve_provider_secret(uuid, text) to service_role;
