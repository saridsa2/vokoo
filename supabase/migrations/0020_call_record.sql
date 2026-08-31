-- The call as a durable object.
--
-- Until now a call's state lived in the WebSocket handler that held the audio.
-- When the caller hung up the socket closed, the handler returned, and the
-- state went with it — so nothing recorded where the call reached, there was no
-- call log, and post-call work had nowhere to run from. `calls` has existed
-- since the first migration and has never had a row.
--
-- Keyed by the carrier's `ucid`, which appears on every KooKoo webhook and is
-- the parameter every call-control endpoint takes. It is the one identifier
-- that outlives the socket.

begin;

-- Which flow ran, and where it reached. `agent_id` already exists and now means
-- the agent that was last active — a flow may hold several, and the per-node
-- detail lives in the execution log rather than being flattened onto the call.
alter table public.calls add column if not exists flow_id uuid references public.flows(id) on delete set null;
alter table public.calls add column if not exists flow_version integer;

-- Shared state. Variables collected during the conversation have to reach the
-- flow that runs after the caller has gone, and the call is the only thing that
-- spans both.
alter table public.calls add column if not exists variables jsonb not null default '{}'::jsonb;

-- Why the call ended, in the carrier's words and ours. `ended_reason` is the
-- flow's own account ("booked", "transferred"); `disconnect_reason` is what the
-- carrier said, and the two disagreeing is itself informative.
alter table public.calls add column if not exists ended_reason text;
alter table public.calls add column if not exists disconnect_reason text;
alter table public.calls add column if not exists recording_url text;

comment on column public.calls.provider_call_id is
  'The carrier''s ucid. Present on every webhook and every call-control command, and the only identifier that outlives the media socket.';
comment on column public.calls.agent_id is
  'The agent last active on this call. A flow may use several; per-node detail is in call_events.';

-- One row per call, so a retried webhook updates rather than duplicates.
create unique index if not exists calls_carrier_ucid_idx
  on public.calls (carrier, provider_call_id)
  where provider_call_id is not null;

-- ------------------------------------------------------------- the trace

-- Every node entered and how it finished.
--
-- This is what makes a call log a trace against the graph rather than a
-- transcript and a duration: which node the call was in, what it decided, how
-- long it took. Append-only, and separate from `calls` because it is per node
-- rather than per call.
create table if not exists public.call_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  call_id      uuid not null references public.calls(id) on delete cascade,
  -- Ordering within a call. A timestamp alone is not enough: nodes that finish
  -- in microseconds share one.
  sequence     integer not null,
  -- Which flow this step belonged to, so the conversation and the post-call
  -- flow are distinguishable in one timeline.
  trigger_event text not null default 'call.answered',
  node_id      text,
  node_name    text,
  implementation text,
  outcome      text,
  duration_ms  integer,
  -- Tool calls, transcripts, carrier responses — whatever the step produced.
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (call_id, sequence)
);

alter table public.call_events enable row level security;
drop policy if exists org_member_access on public.call_events;
create policy org_member_access on public.call_events for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
grant select, insert on public.call_events to authenticated;

create index if not exists call_events_call_idx on public.call_events (call_id, sequence);

commit;

-- ------------------------------------------------- writing a call, from the bridge

-- The bridge holds the service role, not a user session, so these are the two
-- entry points it uses. Both are idempotent on `ucid`: a carrier that retries a
-- webhook must not produce a second call.

create or replace function public.call_started(
  p_carrier text,
  p_ucid    text,
  p_did     text,
  p_from    text,
  p_flow_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number public.phone_numbers;
  v_id     uuid;
begin
  select * into v_number from public.phone_numbers
  where regexp_replace(number, '[^0-9]', '', 'g') = regexp_replace(p_did, '[^0-9]', '', 'g')
  limit 1;

  if v_number.id is null then
    -- An unconfigured number still gets a record. The call happened and the
    -- carrier will bill for it; a number that answers nothing should be visible
    -- rather than absent.
    insert into public.calls (org_id, carrier, provider_call_id, direction,
                              from_number, to_number, status, started_at,
                              transcript, analysis, metadata)
    select id, p_carrier, p_ucid, 'inbound', p_from, p_did, 'unconfigured', now(),
           '[]'::jsonb, '{}'::jsonb, '{}'::jsonb
    from public.organizations limit 1
    on conflict do nothing
    returning id into v_id;
    return v_id;
  end if;

  insert into public.calls (org_id, carrier, provider_call_id, direction,
                            from_number, to_number, phone_number_id, flow_id,
                            status, started_at, transcript, analysis, metadata)
  values (v_number.org_id, p_carrier, p_ucid, 'inbound', p_from, p_did,
          v_number.id, coalesce(p_flow_id, v_number.flow_id), 'in-progress', now(),
          '[]'::jsonb, '{}'::jsonb, '{}'::jsonb)
  on conflict (carrier, provider_call_id) where provider_call_id is not null
  do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.call_started(text, text, text, text, uuid) from public;
grant execute on function public.call_started(text, text, text, text, uuid) to service_role;

create or replace function public.call_ended(
  p_ucid              text,
  p_ended_reason      text default null,
  p_disconnect_reason text default null,
  p_duration_seconds  integer default null,
  p_recording_url     text default null,
  p_variables         jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.calls set
    status            = 'ended',
    ended_at          = now(),
    ended_reason      = coalesce(p_ended_reason, ended_reason),
    disconnect_reason = coalesce(p_disconnect_reason, disconnect_reason),
    -- The carrier's duration is authoritative — it is what gets billed — but it
    -- arrives on a webhook that may never come, so our own clock is the
    -- fallback rather than the other way round.
    duration_seconds  = coalesce(p_duration_seconds, duration_seconds,
                                 extract(epoch from (now() - started_at))::integer),
    recording_url     = coalesce(p_recording_url, recording_url),
    variables         = coalesce(p_variables, variables),
    updated_at        = now()
  where provider_call_id = p_ucid
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.call_ended(text, text, text, integer, text, jsonb) from public;
grant execute on function public.call_ended(text, text, text, integer, text, jsonb) to service_role;

-- One step of a flow. Sequence is assigned here so a bridge that loses count
-- across a reconnect cannot produce a gap or a duplicate.
create or replace function public.call_event(
  p_call_id       uuid,
  p_node_id       text,
  p_node_name     text,
  p_implementation text,
  p_outcome       text,
  p_duration_ms   integer default null,
  p_trigger       text default 'call.answered',
  p_detail        jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  v_next integer;
begin
  select org_id into v_org from public.calls where id = p_call_id;
  if v_org is null then
    return;
  end if;

  select coalesce(max(sequence), 0) + 1 into v_next
  from public.call_events where call_id = p_call_id;

  insert into public.call_events (org_id, call_id, sequence, trigger_event, node_id,
                                  node_name, implementation, outcome, duration_ms, detail)
  values (v_org, p_call_id, v_next, p_trigger, p_node_id, p_node_name,
          p_implementation, p_outcome, p_duration_ms, p_detail);
end;
$$;

revoke all on function public.call_event(uuid, text, text, text, text, integer, text, jsonb) from public;
grant execute on function public.call_event(uuid, text, text, text, text, integer, text, jsonb) to service_role;
