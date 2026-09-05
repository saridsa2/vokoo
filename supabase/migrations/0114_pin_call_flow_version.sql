-- A call runs one immutable flow version from answer through hangup.
--
-- Resolving a number, discovering the latest publish and writing the call in
-- separate bridge requests leaves a race: a publish between those requests can
-- make the row claim a version the caller never ran. This function performs
-- all three inside one database statement and returns the identity the bridge
-- must load. A retried carrier start returns the original identity unchanged.

begin;

create or replace function public.start_call(
  p_carrier text,
  p_ucid    text,
  p_did     text,
  p_from    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number      public.phone_numbers;
  v_flow_id     uuid;
  v_flow_version integer;
  v_call        public.calls;
begin
  -- Serialize a number being repointed with calls beginning on that number.
  select * into v_number
    from public.phone_numbers
   where regexp_replace(number, '[^0-9]', '', 'g') = regexp_replace(p_did, '[^0-9]', '', 'g')
   limit 1
   for share;

  if v_number.id is not null then
    select nf.flow_id into v_flow_id
      from public.number_flows nf
      join public.flows f on f.id = nf.flow_id
     where nf.phone_number_id = v_number.id
       and nf.trigger_event = 'call.answered'
       and f.org_id = v_number.org_id
       and f.family = 'call'
       and f.status = 'published'
     limit 1;

    -- Compatibility for numbers configured before number_flows existed.
    if v_flow_id is null then
      select f.id into v_flow_id
        from public.flows f
       where f.id = v_number.flow_id
         and f.org_id = v_number.org_id
         and f.family = 'call'
         and f.status = 'published';
    end if;

    if v_flow_id is not null then
      select fv.version into v_flow_version
        from public.flow_versions fv
       where fv.flow_id = v_flow_id
         and fv.org_id = v_number.org_id
       order by fv.version desc
       limit 1;

      -- A mutable published row without a snapshot is not executable. Keeping
      -- both fields null makes that fact explicit instead of silently loading
      -- the mutable graph.
      if v_flow_version is null then
        v_flow_id := null;
      end if;
    end if;

    insert into public.calls (
      org_id, carrier, provider_call_id, direction, from_number, to_number,
      phone_number_id, flow_id, flow_version, status, started_at,
      transcript, analysis, metadata
    ) values (
      v_number.org_id, p_carrier, p_ucid, 'inbound', p_from, p_did,
      v_number.id, v_flow_id, v_flow_version, 'in-progress', now(),
      '[]'::jsonb, '{}'::jsonb, '{}'::jsonb
    )
    on conflict (carrier, provider_call_id) where provider_call_id is not null
    do update set updated_at = now()
    returning * into v_call;
  else
    -- Preserve the existing visibility contract for an unconfigured DID. It
    -- has no executable flow, but the billed call must still appear.
    insert into public.calls (
      org_id, carrier, provider_call_id, direction, from_number, to_number,
      status, started_at, transcript, analysis, metadata
    )
    select id, p_carrier, p_ucid, 'inbound', p_from, p_did,
           'unconfigured', now(), '[]'::jsonb, '{}'::jsonb, '{}'::jsonb
      from public.organizations
     order by created_at
     limit 1
    on conflict (carrier, provider_call_id) where provider_call_id is not null
    do update set updated_at = now()
    returning * into v_call;
  end if;

  if v_call.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'call_id', v_call.id,
    'flow_id', v_call.flow_id,
    'flow_version', v_call.flow_version
  );
end;
$$;

revoke all on function public.start_call(text, text, text, text) from public;
grant execute on function public.start_call(text, text, text, text) to service_role;

-- The product now selects one call flow for a number. Lifecycle entry points
-- live inside that flow; integrations are invoked by it and are never number
-- bindings. Keep the historical signature while older clients overlap.
create or replace function public.set_number_flow(
  p_phone_number_id uuid,
  p_trigger_event   text,
  p_flow_id         uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
begin
  if p_trigger_event <> 'call.answered' then
    raise exception 'a number selects one call flow; lifecycle triggers belong inside it'
      using errcode = 'P0004';
  end if;

  select org_id into v_org
    from public.phone_numbers
   where id = p_phone_number_id
   for update;
  if v_org is null then
    raise exception 'no such number' using errcode = '42501';
  end if;

  -- Old ended/failed bindings must not keep running beside the selected call
  -- flow. They remain readable only on untouched legacy numbers.
  delete from public.number_flows
   where phone_number_id = p_phone_number_id
     and trigger_event <> 'call.answered';

  if p_flow_id is null then
    delete from public.number_flows
     where phone_number_id = p_phone_number_id
       and trigger_event = 'call.answered';
    update public.phone_numbers set flow_id = null, updated_at = now()
     where id = p_phone_number_id;
    return jsonb_build_object('bound', false);
  end if;

  if not exists (
    select 1 from public.flows f
     where f.id = p_flow_id
       and f.org_id = v_org
       and f.family = 'call'
  ) then
    raise exception 'that is not a call flow in this workspace'
      using errcode = '42501';
  end if;

  insert into public.number_flows (org_id, phone_number_id, trigger_event, flow_id)
  values (v_org, p_phone_number_id, 'call.answered', p_flow_id)
  on conflict (phone_number_id, trigger_event)
    do update set flow_id = excluded.flow_id, updated_at = now();

  update public.phone_numbers set flow_id = p_flow_id, updated_at = now()
   where id = p_phone_number_id;

  return jsonb_build_object('bound', true, 'flow_id', p_flow_id);
end;
$$;

revoke all on function public.set_number_flow(uuid, text, uuid) from public;
grant execute on function public.set_number_flow(uuid, text, uuid) to authenticated, service_role;

commit;
