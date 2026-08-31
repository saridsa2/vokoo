-- The functions an agent may call.
--
-- `compose_agent_prompt` already tells the model which skills an agent has and
-- names their tools in prose. Nothing declared those tools as functions, so the
-- model was told they existed and given no channel to call one. On a live call
-- that produced `finish_call(note: "Internal error checking slots.")` — the
-- model reporting a failure of a tool it had never been able to invoke.
--
-- A sibling of the prompt composer, for the same reason that one exists: the
-- walk from agent to skills to tools belongs in one place, and the bridge asks
-- one question rather than three.
--
-- Deduplicated by name. `send_sms` hangs off both booking and cancelling, and a
-- provider that receives the same function twice is entitled to reject the
-- whole declaration.

begin;

create or replace function public.compose_agent_tools(p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb)
  from (
    select distinct on (tl.name)
           tl.name,
           tl.description,
           tl.schema
      from public.agent_skills ags
      -- 'published', matching what compose_agent_prompt filters on. A draft
      -- skill must not reach a caller, and neither must its tools.
      join public.skills s        on s.id = ags.skill_id and s.status = 'published'
      join public.skill_tools st  on st.skill_id = s.id
      join public.tools tl        on tl.id = st.tool_id
     where ags.agent_id = p_agent_id
     order by tl.name, st.sort_order
  ) t;
$$;

revoke all on function public.compose_agent_tools(uuid) from public;
grant execute on function public.compose_agent_tools(uuid) to authenticated, service_role;

commit;
