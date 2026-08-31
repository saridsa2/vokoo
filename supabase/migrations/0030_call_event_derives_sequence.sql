-- Let call_event derive its own sequence.
--
-- `p_sequence` had no default and goes straight into a `not null` column, so a
-- caller that does not know the flow's position could not write an event at
-- all. That is exactly the position a tool call is in: it arrives from the
-- model mid-conversation, and the part of the bridge that receives it has no
-- view of the runner's step count. Live tool invocations were therefore
-- untraceable — the dispatcher asked for the write and the insert was rejected.
--
-- The flow runner keeps passing its own number. Its sequence is the walk's
-- position, which is a fact worth preserving rather than re-deriving.
--
-- Deriving from max+1 can collide if two events for one call are written at the
-- same instant, and `on conflict do nothing` then drops one. That is a trace
-- losing a row rather than a call misbehaving, and it is a smaller problem than
-- not being able to write at all.

begin;

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
  v_seq integer;
begin
  select org_id into v_org from public.calls where id = p_call_id;
  if v_org is null then
    return;
  end if;

  if p_sequence is null then
    select coalesce(max(sequence), 0) + 1 into v_seq
      from public.call_events where call_id = p_call_id;
  else
    v_seq := p_sequence;
  end if;

  insert into public.call_events (org_id, call_id, sequence, trigger_event, node_id,
                                  node_name, implementation, outcome, duration_ms, detail)
  values (v_org, p_call_id, v_seq, p_trigger, p_node_id, p_node_name,
          p_implementation, p_outcome, p_duration_ms, p_detail)
  -- A retried write is the same step, not a new one.
  on conflict (call_id, sequence) do nothing;
end;
$$;

commit;
