-- The step's position in the trace belongs to the runner, not to the database.
--
-- `call_event` computed its own sequence with `max(sequence) + 1`. The bridge
-- writes steps fire-and-forget, so two spawned writes read the same maximum and
-- raced: on a real call the trace came back as
--
--   1  Open right now?          open
--   2  Handed over              __end__      <- ran third
--   3  Bring in the front desk  ok           <- ran second
--
-- with a fourth write lost to a duplicate-key conflict. A trace whose order is
-- decided by which HTTP request lands first is not a trace.
--
-- The runner already walks the graph in order and knows each step's index, so
-- the sequence is passed in. That also makes a retry idempotent: the same step
-- carries the same number, and the unique constraint turns a repeat into a
-- no-op instead of a duplicate or an error.

begin;

drop function if exists public.call_event(uuid, text, text, text, text, integer, text, jsonb);

create or replace function public.call_event(
  p_call_id        uuid,
  p_sequence       integer,
  p_node_id        text,
  p_node_name      text,
  p_implementation text,
  p_outcome        text,
  p_duration_ms    integer default null,
  p_trigger        text default 'call.answered',
  p_detail         jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.calls where id = p_call_id;
  if v_org is null then
    return;
  end if;

  insert into public.call_events (org_id, call_id, sequence, trigger_event, node_id,
                                  node_name, implementation, outcome, duration_ms, detail)
  values (v_org, p_call_id, p_sequence, p_trigger, p_node_id, p_node_name,
          p_implementation, p_outcome, p_duration_ms, p_detail)
  -- A retried write is the same step, not a new one.
  on conflict (call_id, sequence) do nothing;
end;
$$;

revoke all on function public.call_event(uuid, integer, text, text, text, text, integer, text, jsonb) from public;
grant execute on function public.call_event(uuid, integer, text, text, text, text, integer, text, jsonb) to service_role;

commit;
