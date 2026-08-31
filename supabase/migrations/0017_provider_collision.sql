-- One word, four meanings. Split them.
--
--   agents.provider                 where inference runs        keep
--   calls.provider                  the telephony carrier       carrier
--   phone_numbers.provider          the telephony carrier       carrier
--   voices.provider                 the speech engine           engine
--   provider_credentials.provider   which account a key is for  vendor
--   transcriber_config -> provider  which transcriber           transcriber
--
-- `agents.provider` keeps the word because it is the one that means what the
-- word says. The rest were borrowing it.
--
-- The credential one is the clearest: a row for KooKoo is not a provider in
-- either of the other senses. It is a vendor we hold an account with, and the
-- same table will hold a payment gateway and a CRM before long.

begin;

alter table public.calls                rename column provider to carrier;
alter table public.phone_numbers        rename column provider to carrier;
alter table public.voices               rename column provider to engine;
alter table public.voices               rename column provider_voice_id to engine_voice_id;
alter table public.provider_credentials rename column provider to vendor;
alter table public.provider_credentials rename to vendor_credentials;
alter table public.catalogue_credentials rename to catalogue_vendors;

-- The transcriber's own name, not who supplies it.
update public.agents
set transcriber_config = (transcriber_config - 'provider'::text)
                         || jsonb_build_object('transcriber', transcriber_config->>'provider')
where transcriber_config ? 'provider';

update public.agent_versions
set snapshot = jsonb_set(
      snapshot, '{transcriber_config}',
      ((snapshot->'transcriber_config') - 'provider'::text)
      || jsonb_build_object('transcriber', snapshot->'transcriber_config'->>'provider'))
where snapshot->'transcriber_config' ? 'provider';

commit;

-- ------------------------------------------------- functions follow the names

create or replace function public.set_vendor_credential(
  p_org_id uuid, p_vendor text, p_secret text, p_label text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing public.vendor_credentials;
  v_vault_id uuid;
  v_hint     text;
begin
  if not public.can_manage_credentials(p_org_id) then
    raise exception 'your role may not manage provider keys' using errcode = 'P0003';
  end if;
  if coalesce(trim(p_secret), '') = '' then
    raise exception 'a key is required' using errcode = 'P0004';
  end if;
  if not exists (select 1 from public.catalogue_vendors where id = p_vendor and is_active) then
    raise exception 'unknown vendor %', p_vendor using errcode = 'P0004';
  end if;

  v_hint := case when length(p_secret) >= 12 then right(p_secret, 4) else null end;

  select * into v_existing from public.vendor_credentials
  where org_id = p_org_id and vendor = p_vendor;

  if v_existing.id is not null then
    perform vault.update_secret(v_existing.secret_ref::uuid, p_secret);
    update public.vendor_credentials set
      label = coalesce(p_label, label),
      metadata = jsonb_build_object('hint', v_hint, 'rotated_at', now()),
      updated_at = now()
    where id = v_existing.id returning * into v_existing;
  else
    v_vault_id := vault.create_secret(
      p_secret, format('vokoo:%s:%s', p_org_id, p_vendor),
      format('VoKoo key for %s', p_vendor));
    insert into public.vendor_credentials (org_id, vendor, label, secret_ref, metadata)
    values (p_org_id, p_vendor, p_label, v_vault_id::text, jsonb_build_object('hint', v_hint))
    returning * into v_existing;
  end if;

  return jsonb_build_object('id', v_existing.id, 'vendor', v_existing.vendor,
    'label', v_existing.label, 'hint', v_existing.metadata->>'hint',
    'updated_at', v_existing.updated_at);
end;
$$;

create or replace function public.list_vendor_credentials(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.memberships
                 where org_id = p_org_id and user_id = auth.uid()) then
    raise exception 'not a member of this organisation' using errcode = 'P0003';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'vendor', c.vendor, 'label', c.label,
      'hint', c.metadata->>'hint', 'created_at', c.created_at, 'updated_at', c.updated_at
    ) order by c.vendor)
    from public.vendor_credentials c where c.org_id = p_org_id), '[]'::jsonb);
end;
$$;

create or replace function public.delete_vendor_credential(p_org_id uuid, p_vendor text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  if not public.can_manage_credentials(p_org_id) then
    raise exception 'your role may not manage provider keys' using errcode = 'P0003';
  end if;
  delete from public.vendor_credentials
  where org_id = p_org_id and vendor = p_vendor returning secret_ref into v_ref;
  if v_ref is not null then delete from vault.secrets where id = v_ref::uuid; end if;
end;
$$;

-- Still the only function that returns a secret, and still granted to the
-- service role alone.
create or replace function public.resolve_vendor_secret(p_org_id uuid, p_vendor text)
returns text language sql stable security definer set search_path = public as $$
  select s.decrypted_secret
  from public.vendor_credentials c
  join vault.decrypted_secrets s on s.id = c.secret_ref::uuid
  where c.org_id = p_org_id and c.vendor = p_vendor;
$$;

drop function if exists public.set_provider_credential(uuid, text, text, text);
drop function if exists public.list_provider_credentials(uuid);
drop function if exists public.delete_provider_credential(uuid, text);
drop function if exists public.resolve_provider_secret(uuid, text);

revoke all on function public.set_vendor_credential(uuid, text, text, text) from public;
revoke all on function public.list_vendor_credentials(uuid) from public;
revoke all on function public.delete_vendor_credential(uuid, text) from public;
revoke all on function public.resolve_vendor_secret(uuid, text) from public;
revoke all on function public.resolve_vendor_secret(uuid, text) from authenticated;

grant execute on function public.set_vendor_credential(uuid, text, text, text) to authenticated;
grant execute on function public.list_vendor_credentials(uuid) to authenticated;
grant execute on function public.delete_vendor_credential(uuid, text) to authenticated;
grant execute on function public.resolve_vendor_secret(uuid, text) to service_role;

-- Agent validation reads the transcriber under its own name now.
create or replace function public.validate_agent_config(p_row public.agents)
returns void language plpgsql stable set search_path = public as $$
declare
  v_config   jsonb := coalesce(p_row.config, '{}'::jsonb);
  v_voice    jsonb := coalesce(p_row.voice_config, '{}'::jsonb);
  v_trans    jsonb := coalesce(p_row.transcriber_config, '{}'::jsonb);
  v_mode     text;
  v_model    public.catalogue_models;
  v_voice_id text;
  v_trans_id text;
begin
  if coalesce(trim(p_row.name), '') = '' then
    raise exception 'name is required' using errcode = 'P0004';
  end if;
  if not exists (select 1 from public.catalogue_providers where id = p_row.provider and is_active) then
    raise exception 'unknown provider %', p_row.provider using errcode = 'P0004';
  end if;

  select * into v_model from public.catalogue_models where id = p_row.model and is_active;
  if v_model.id is null then
    raise exception 'unknown model %', p_row.model using errcode = 'P0004';
  end if;
  if v_model.provider_id <> p_row.provider then
    raise exception '% is a % model and cannot run on %',
      v_model.label, v_model.provider_id, p_row.provider using errcode = 'P0004';
  end if;

  v_voice_id := v_voice->>'voice';
  if v_voice_id is not null and v_voice_id <> '' then
    if not exists (select 1 from public.catalogue_voices
                   where id = v_voice_id and provider_id = p_row.provider and is_active) then
      raise exception 'voice % is not available on %', v_voice_id, p_row.provider using errcode = 'P0004';
    end if;
  end if;

  v_trans_id := v_trans->>'transcriber';
  if v_trans_id is not null and v_trans_id <> '' then
    if not exists (select 1 from public.catalogue_transcribers
                   where id = v_trans_id and provider_id = p_row.provider and is_active) then
      raise exception 'transcriber % is not available on %', v_trans_id, p_row.provider using errcode = 'P0004';
    end if;
  end if;

  if not v_model.native_audio then
    if v_trans_id is null or v_trans_id = ''
       or exists (select 1 from public.catalogue_transcribers where id = v_trans_id and is_passthrough) then
      raise exception '% does not hear audio directly and needs a transcriber', v_model.label
        using errcode = 'P0004';
    end if;
  end if;

  v_mode := v_config->>'first_message_mode';
  if v_mode is not null and v_mode not in ('agent-first', 'user-first') then
    raise exception 'first_message_mode must be agent-first or user-first, not %', v_mode
      using errcode = 'P0004';
  end if;
  if coalesce(v_mode, 'agent-first') = 'agent-first'
     and coalesce(trim(p_row.first_message), '') = '' then
    raise exception 'first_message is required when the agent speaks first' using errcode = 'P0004';
  end if;

  perform public.assert_jsonb_number(v_config, 'max_tokens', 1, 4096);
  perform public.assert_jsonb_number(v_config, 'temperature', 0, 2);
  perform public.assert_jsonb_number(v_config, 'priming_ms', 0, 2000);
  perform public.assert_jsonb_number(v_config, 'silence_ms', 0, 5000);
  perform public.assert_jsonb_number(v_config, 'max_duration_s', 0, 7200);
  perform public.assert_jsonb_number(v_config, 'latency_threshold_ms', 0, 30000);
  perform public.assert_jsonb_number(v_voice, 'speed', 0.5, 2);
  perform public.assert_jsonb_boolean(v_config, 'mic_gate');
  perform public.assert_jsonb_boolean(v_config, 'alert_on_failure');
  perform public.assert_jsonb_boolean(v_config, 'alert_on_latency');
end;
$$;

grant execute on function public.validate_agent_config(public.agents) to authenticated;

-- The catalogue follows the table rename.
create or replace function public.capability_catalogue()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
                           from public.catalogue_providers p where p.is_active), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order)
                        from public.catalogue_models m where m.is_active), '[]'::jsonb),
    'voices', coalesce((select jsonb_agg(to_jsonb(v) order by v.sort_order)
                        from public.catalogue_voices v where v.is_active), '[]'::jsonb),
    'transcribers', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order)
                              from public.catalogue_transcribers t where t.is_active), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order)
                         from public.catalogue_vendors c where c.is_active), '[]'::jsonb),
    'nodeTypes', coalesce((select jsonb_agg(to_jsonb(n) order by n.sort_order)
                           from public.catalogue_node_types n where n.is_active), '[]'::jsonb)
  );
$$;

revoke all on function public.capability_catalogue() from public;
grant execute on function public.capability_catalogue() to authenticated;
