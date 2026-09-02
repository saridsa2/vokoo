-- Which skills an agent has.
--
-- The last link in the chain that had no way to edit it: `agent_skills` rows
-- were inserted by hand, and they are what `compose_agent_prompt` and
-- `compose_agent_tools` walk. An agent with no skills is told nothing and
-- declared nothing, however many tools the workspace has.
--
-- Same shape as `set_skill_tools`: one function, one transaction, security
-- invoker so row-level security decides what the caller may touch. A delete
-- followed by an insert through PostgREST cannot share a transaction, and the
-- first time that was tried in the console it left a skill granting nothing.

begin;

create or replace function public.set_agent_skills(p_agent_id uuid, p_skill_ids uuid[])
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- Read through RLS, so an agent in another organisation is invisible and this
  -- doubles as the permission check.
  select org_id into v_org from public.agents where id = p_agent_id;
  if v_org is null then
    raise exception 'no such agent' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(p_skill_ids) as wanted(id)
     where not exists (
       select 1 from public.skills s where s.id = wanted.id and s.org_id = v_org
     )
  ) then
    raise exception 'a skill in that list is not in this workspace' using errcode = '42501';
  end if;

  delete from public.agent_skills where agent_id = p_agent_id;

  -- The order given is the order the prompt composer reads them, which is the
  -- order the agent considers them in.
  insert into public.agent_skills (org_id, agent_id, skill_id, sort_order)
  select v_org, p_agent_id, id, ordinality - 1
    from unnest(p_skill_ids) with ordinality as s(id, ordinality);

  return jsonb_build_object('agent_id', p_agent_id, 'count', coalesce(array_length(p_skill_ids, 1), 0));
end;
$$;

revoke all on function public.set_agent_skills(uuid, uuid[]) from public;
grant execute on function public.set_agent_skills(uuid, uuid[]) to authenticated, service_role;

commit;
