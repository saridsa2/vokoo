-- Setting a skill's tools, atomically.
--
-- The control plane did this as a DELETE then an INSERT through PostgREST,
-- which cannot transact across two statements. The first run in the console
-- proved why that matters: the delete succeeded, the insert failed, and the
-- skill was left granting nothing — an agent that could still talk about
-- booking an appointment and no longer do it.
--
-- One function, one transaction. `security invoker`, so row-level security
-- still decides what the caller may touch and there is no second copy of the
-- organisation rule here.

begin;

create or replace function public.set_skill_tools(p_skill_id uuid, p_tool_ids uuid[])
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- Read through RLS: a skill in another organisation is not visible, so this
  -- is also the permission check.
  select org_id into v_org from public.skills where id = p_skill_id;
  if v_org is null then
    raise exception 'no such skill' using errcode = '42501';
  end if;

  -- Every tool must belong to the same organisation. Without this a caller
  -- could attach a tool id they learned from elsewhere, and the agent would be
  -- declared a function belonging to somebody else.
  if exists (
    select 1 from unnest(p_tool_ids) as wanted(id)
     where not exists (
       select 1 from public.tools t where t.id = wanted.id and t.org_id = v_org
     )
  ) then
    raise exception 'a tool in that list is not in this workspace' using errcode = '42501';
  end if;

  delete from public.skill_tools where skill_id = p_skill_id;

  -- `sort_order` follows the order given, which is the order the screen listed
  -- them in and the order the prompt composer reads them.
  insert into public.skill_tools (org_id, skill_id, tool_id, sort_order)
  select v_org, p_skill_id, id, ordinality - 1
    from unnest(p_tool_ids) with ordinality as t(id, ordinality);

  return jsonb_build_object('skill_id', p_skill_id, 'count', coalesce(array_length(p_tool_ids, 1), 0));
end;
$$;

revoke all on function public.set_skill_tools(uuid, uuid[]) from public;
grant execute on function public.set_skill_tools(uuid, uuid[]) to authenticated, service_role;

commit;
