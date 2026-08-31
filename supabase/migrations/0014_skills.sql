-- Skills: what an agent can handle.
--
-- The largest gap between the vocabulary and the schema. Everything agreed
-- about scope, containment and escalation rested on a table that did not exist:
-- an agent was a free-text system prompt, so there was nothing to classify a
-- caller's intent against and nothing to make "out of scope" mean anything.
--
-- A skill is the customer-facing unit. A clinic picks "Book an appointment" off
-- a list; it never writes an HTTP integration. Tools are internal, VoKoo writes
-- them, and a skill references the ones it may use.
--
-- Three relationships, and the direction of each matters:
--
--   agent  --has-->  skill   An agent's scope is the union of its skills.
--                            Anything outside it escalates.
--   skill  --uses--> tool    A reference, not ownership: `send_sms` is used by
--                            book, reschedule and cancel, and the clinic's
--                            credentials belong to the organisation, not to a
--                            skill.
--
-- Tools are scoped to the active skill at runtime rather than unioned onto the
-- agent. The "clinic hours" skill has no business calling `book_appointment`,
-- and a model that has drifted mid-call should not be able to reach it.

create table if not exists public.skills (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  -- Stable identifier used in prompts, classification answers and outcomes.
  -- Renaming the display name must not change what the model was told to say.
  slug         text not null,
  -- What this skill handles, in the words the classifier sees. This is the
  -- answer set: "which of these, or none".
  description  text not null,
  -- Extra prompt text for this skill alone, spread in when it is attached.
  instructions text,
  -- Values the skill gathers from the conversation, as
  -- [{name, label, type, required}]. These become flow variables, which is what
  -- lets a booking collected here be used by a node three steps later.
  collects     jsonb not null default '[]'::jsonb,
  -- What counts as finished, for the agent's `done` outcome.
  completion   text,
  status       text not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists public.skill_tools (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  skill_id   uuid not null references public.skills(id) on delete cascade,
  tool_id    uuid not null references public.tools(id) on delete cascade,
  -- Order the tool descriptions appear in the prompt. Models weight what comes
  -- first, so this is a real setting rather than presentation.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (skill_id, tool_id)
);

create table if not exists public.agent_skills (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  agent_id   uuid not null references public.agents(id) on delete cascade,
  skill_id   uuid not null references public.skills(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (agent_id, skill_id)
);

-- `agent_tools` modelled tools hanging off the agent, which the skill design
-- replaces. Empty, and superseded — left in place it would invite something to
-- be wired to the wrong shape.
drop table if exists public.agent_tools;

alter table public.skills       enable row level security;
alter table public.skill_tools  enable row level security;
alter table public.agent_skills enable row level security;

do $$
declare v_table text;
begin
  foreach v_table in array array['skills', 'skill_tools', 'agent_skills'] loop
    execute format('drop policy if exists org_member_access on public.%I', v_table);
    execute format(
      'create policy org_member_access on public.%I for all to authenticated
       using (is_org_member(org_id)) with check (is_org_member(org_id))', v_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_table);
  end loop;
end;
$$;

create index if not exists skill_tools_skill_idx  on public.skill_tools (skill_id, sort_order);
create index if not exists agent_skills_agent_idx on public.agent_skills (agent_id, sort_order);

-- ------------------------------------------------------- composing the prompt

-- The system prompt an agent actually runs with.
--
-- The author writes identity and style. Everything below that is generated from
-- the attached skills — their descriptions, the tools each may use, and the
-- instruction to escalate anything else. Attach a skill and the block grows;
-- remove one and it shrinks. Nobody edits the generated half, which is why it is
-- composed here rather than pasted into the stored prompt.
--
-- The closing line is the containment. Without a declared scope a model will
-- attempt anything: asked about a refund it improvises, and for a clinic that is
-- the difference between a receptionist and a liability.
create or replace function public.compose_agent_prompt(p_agent_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_agent  public.agents;
  v_out    text;
  v_skill  record;
  v_tool   record;
  v_any    boolean := false;
begin
  select * into v_agent from public.agents where id = p_agent_id;
  if v_agent.id is null then
    return null;
  end if;

  v_out := coalesce(v_agent.system_prompt, '');

  for v_skill in
    select s.name, s.description, s.instructions, s.slug
    from public.agent_skills a
    join public.skills s on s.id = a.skill_id
    where a.agent_id = p_agent_id
    order by a.sort_order, s.name
  loop
    if not v_any then
      v_out := v_out || E'\n\n[What you can do]';
      v_any := true;
    end if;

    v_out := v_out || E'\n' || v_skill.name || ' — ' || v_skill.description;
    if coalesce(trim(v_skill.instructions), '') <> '' then
      v_out := v_out || E'\n  ' || v_skill.instructions;
    end if;

    for v_tool in
      select t.name, t.description
      from public.skill_tools st
      join public.tools t on t.id = st.tool_id
      join public.skills s2 on s2.id = st.skill_id
      where s2.slug = v_skill.slug and s2.org_id = v_agent.org_id
      order by st.sort_order, t.name
    loop
      v_out := v_out || E'\n  · ' || v_tool.name || ' — ' || coalesce(v_tool.description, '');
    end loop;
  end loop;

  if v_any then
    v_out := v_out || E'\n\nAnything not on this list: say you will pass them to a colleague, and stop.';
  end if;

  return v_out;
end;
$$;

grant execute on function public.compose_agent_prompt(uuid) to authenticated;
