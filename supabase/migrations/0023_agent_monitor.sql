-- Staying on the line after a transfer.
--
-- The flow used to end at the hand-over: the agent brought the front desk in
-- and then hung up its own involvement, so the part of the call where the
-- patient actually got helped left no record at all.
--
-- `agent.monitor` is the node for the rest of that call. The agent stops
-- talking and keeps listening, and what the two people say reaches the
-- transcript. It suspends like the `agent` node does, but unlike it there is no
-- outcome to wait for — the carrier decides when the call is over.

begin;

insert into public.catalogue_node_types
  (id, node_type, label, description, provider_action, outcomes, fields, sort_order, suspends)
values (
  'agent.monitor',
  'custom',
  'Listen in',
  'The agent stops speaking and stays on the call, transcribing it, until the '
  || 'caller hangs up. Use after a transfer, so the part of the conversation '
  || 'handled by a person is still recorded.',
  null,
  '[{"id": "call_ended", "label": "Call ended"},
    {"id": "failed",     "label": "Could not listen"}]'::jsonb,
  '[{"name": "reason", "type": "string", "label": "Why", "required": false,
     "help": "Recorded on the call as ended_reason."}]'::jsonb,
  (select coalesce(max(sort_order), 0) + 1 from public.catalogue_node_types),
  true
)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  outcomes = excluded.outcomes, fields = excluded.fields, suspends = excluded.suspends;

-- Retired rather than deleted. It was the wrong answer — the agent should not
-- leave the call — but version 4 of the clinic's flow references it, and a
-- published version that cannot be resolved is a worse problem than a node
-- nobody can reach. Hidden from the palette, still valid in history.
update public.catalogue_node_types set is_active = false where id = 'kookoo.release';

-- --------------------------------------------------------------- transcript

-- One line of what was said.
--
-- `calls.transcript` has been an empty array since the first migration. The
-- monitor is the first thing with anything to put in it, and appending one line
-- at a time is what lets a transcript survive a call that ends unexpectedly —
-- a buffer flushed at the end is a buffer lost when the process dies.
create or replace function public.call_transcript_line(
  p_call_id uuid,
  p_speaker text,
  p_text    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.calls
  set transcript = transcript || jsonb_build_object(
        'speaker', p_speaker,
        'text',    p_text,
        'at',      to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ),
      updated_at = now()
  where id = p_call_id;
end;
$$;

revoke all on function public.call_transcript_line(uuid, text, text) from public;
grant execute on function public.call_transcript_line(uuid, text, text) to service_role;

commit;
