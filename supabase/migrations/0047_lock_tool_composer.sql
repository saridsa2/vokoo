-- `compose_agent_tools` was executable by `anon`.
--
-- SECURITY DEFINER, takes an agent id, and returns that agent's tool
-- declarations — names, descriptions and full parameter schemas — with no
-- membership check. Verified on 1 September: a POST carrying only the public
-- anon key returned 2,009 bytes of tool definitions for an agent in another
-- caller's organisation.
--
-- No secret is disclosed, so this is not the same severity as
-- `resolve_vendor_secret` (migration 0046). What leaks is the shape of a
-- business: which tools an agent has, what arguments they take, and therefore
-- what the line can be asked to do.
--
-- The media bridge is the only caller — `agent_tools()` in
-- `src/vokoo/graph.rs`, using the service key. The console never calls it: the
-- agent editor derives the same list by walking `agent_skills` and
-- `skill_tools`, both of which are behind row-level security.
--
-- `compose_agent_prompt` needs no change: it is SECURITY INVOKER, so row-level
-- security already applies and the same probe returned null.

begin;

revoke execute on function public.compose_agent_tools(uuid) from anon;
revoke execute on function public.compose_agent_tools(uuid) from authenticated;
revoke execute on function public.compose_agent_tools(uuid) from public;

comment on function public.compose_agent_tools(uuid) is
  'Tool declarations for one agent. service_role only — the media bridge is the only caller. The console walks agent_skills/skill_tools instead, which RLS protects.';

commit;
