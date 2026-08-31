-- Flows as event handlers.
--
-- A phone number can now run sibling flows at different points in a call.
-- Keeping those bindings in their own table preserves per-number routing while
-- avoiding an implicit organisation-wide handler that becomes ambiguous as
-- soon as two numbers need different post-call work.
--
-- `phone_numbers.flow_id` remains during the bridge transition. Removing the
-- old route before the bridge reads its replacement would turn a reversible
-- rollout into a cutover with no fallback.

begin;

alter table public.flows
  add column if not exists trigger_event text not null default 'call.answered';
alter table public.flows
  add column if not exists channel text not null default 'voice';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'flows_trigger_event_check'
       and conrelid = 'public.flows'::regclass
  ) then
    alter table public.flows
      add constraint flows_trigger_event_check
      check (trigger_event in (
        'call.answered', 'call.ended', 'call.never_answered', 'message.received'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'flows_channel_check'
       and conrelid = 'public.flows'::regclass
  ) then
    alter table public.flows
      add constraint flows_channel_check
      check (channel in ('voice', 'message'));
  end if;
end $$;

comment on column public.flows.trigger_event is
  'The event this flow handles. It belongs to the flow so each sibling canvas has one fixed entry point.';
comment on column public.flows.channel is
  'The conversation medium this flow handles, so message handlers do not require a second flow table.';

-- One binding wins for a number and event. More than one candidate would make
-- routing depend on row order rather than configuration.
create table if not exists public.number_flows (
  id              uuid default gen_random_uuid()
                  constraint number_flows_pkey primary key,
  org_id          uuid not null
                  constraint number_flows_org_id_fkey
                  references public.organizations(id) on delete cascade,
  phone_number_id uuid not null
                  constraint number_flows_phone_number_id_fkey
                  references public.phone_numbers(id) on delete cascade,
  trigger_event   text not null,
  flow_id         uuid not null
                  constraint number_flows_flow_id_fkey
                  references public.flows(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint number_flows_trigger_event_check check (trigger_event in (
    'call.answered', 'call.ended', 'call.never_answered', 'message.received'
  )),
  constraint number_flows_phone_number_trigger_event_key
    unique (phone_number_id, trigger_event)
);

alter table public.number_flows enable row level security;
drop policy if exists org_member_access on public.number_flows;
create policy org_member_access on public.number_flows for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
-- A binding is configuration, not a trace: a number gets repointed at a
-- different post-call flow, and a binding gets removed. `call_events` grants
-- only select and insert because it is append-only; the comparable tables here
-- are `flows` and `phone_numbers`, which grant the full set.
grant select, insert, update, delete on public.number_flows to authenticated;

drop trigger if exists set_number_flows_updated_at on public.number_flows;
create trigger set_number_flows_updated_at
  before update on public.number_flows
  for each row execute function public.set_updated_at();

-- Preserve the route every configured number uses today without replacing a
-- binding that may already have been written during a retried rollout.
insert into public.number_flows (org_id, phone_number_id, trigger_event, flow_id)
select org_id, id, 'call.answered', flow_id
  from public.phone_numbers
 where flow_id is not null
on conflict (phone_number_id, trigger_event) do nothing;

-- Palette validity is data because usefulness changes by event and channel.
-- The opening-hours preset is condition-shaped and does not address a caller,
-- so it follows the primitive conditions that can run for every event.
alter table public.catalogue_node_types
  add column if not exists valid_triggers text[] not null default '{}'::text[];

update public.catalogue_node_types
   set valid_triggers = array[
     'call.answered', 'call.ended', 'call.never_answered', 'message.received'
   ]::text[]
 where id in ('condition', 'loop', 'var', 'code', 'business_hours');

-- Caller presence after a hangup is a runtime fact. Keeping these available to
-- ended handlers lets the graph branch on who disconnected before using them.
update public.catalogue_node_types
   set valid_triggers = array['call.answered', 'call.ended']::text[]
 where id in (
   'agent',
   'kookoo.conference',
   'kookoo.transfer',
   'kookoo.hold',
   'kookoo.hangup',
   'kookoo.release',
   'agent.monitor'
 );

commit;
