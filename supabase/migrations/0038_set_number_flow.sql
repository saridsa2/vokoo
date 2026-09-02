-- Binding a number to a flow, one event at a time.
--
-- `number_flows` is what `resolve_for_event` reads to answer "which flow handles
-- this call". It has existed since migration 0027 and has never had a way to
-- edit it outside SQL, which means the trigger work built on top of it was
-- unreachable from the product.
--
-- One event, one flow. The unique constraint on (phone_number_id, trigger_event)
-- already says so; this function makes setting it idempotent rather than an
-- insert that fails the second time.
begin;

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
  -- Through RLS, so a number in another workspace is invisible and this is also
  -- the permission check.
  select org_id into v_org from public.phone_numbers where id = p_phone_number_id;
  if v_org is null then
    raise exception 'no such number' using errcode = '42501';
  end if;

  if p_flow_id is null then
    delete from public.number_flows
     where phone_number_id = p_phone_number_id and trigger_event = p_trigger_event;
    return jsonb_build_object('bound', false, 'trigger_event', p_trigger_event);
  end if;

  -- The flow must be in this workspace, and it must handle the event it is
  -- being bound to — a number pointed at a `call.ended` flow for `call.answered`
  -- would answer a caller with a post-call handler.
  if not exists (
    select 1 from public.flows f
     where f.id = p_flow_id and f.org_id = v_org and f.trigger_event = p_trigger_event
  ) then
    raise exception 'that flow does not handle % in this workspace', p_trigger_event
      using errcode = '42501';
  end if;

  insert into public.number_flows (org_id, phone_number_id, trigger_event, flow_id)
  values (v_org, p_phone_number_id, p_trigger_event, p_flow_id)
  on conflict (phone_number_id, trigger_event)
    do update set flow_id = excluded.flow_id, updated_at = now();

  return jsonb_build_object('bound', true, 'trigger_event', p_trigger_event, 'flow_id', p_flow_id);
end;
$$;

revoke all on function public.set_number_flow(uuid, text, uuid) from public;
grant execute on function public.set_number_flow(uuid, text, uuid) to authenticated, service_role;

commit;
