-- Three limits in `seed_workspace`, all of which the Vayuveda pack hits.
--
-- ## One placeholder cannot name three agents
--
-- A flow's graph stores `agent_id` as a literal uuid, so a template has to
-- carry a placeholder instead. There was exactly one — `{{AGENT_ID}}` —
-- substituted with `new_agent`, which after the agent loop holds whatever the
-- *last* template inserted.
--
-- With one agent that is correct. Vayuveda's answering flow has three agent
-- nodes behind a keypad menu — English, Hindi and a realtime one — and every
-- branch would have landed on the same agent. The menu offers three languages
-- and gives you one, the flow publishes cleanly, and the fault appears only on
-- a call.
--
-- `{{AGENT:<label>}}` names the template it wants, so a flow can reference as
-- many as it likes and the reference is readable in the stored payload.
-- `{{AGENT_ID}}` still works and means the first agent in the pack, because
-- `clinic-reception` v1 uses it and a pack already seeded must keep seeding the
-- same thing.
--
-- **An unresolved placeholder is an error, not a warning.** Substituting
-- nothing leaves the literal string where a uuid belongs, and `runner.rs` gets
-- `{{AGENT:Reception}}` as an agent id — which fails on a live call, to a
-- caller, rather than here.
--
-- ## A skill could not be packed
--
-- `templates.kind` allowed `agent` and `flow`. Skills are what an agent is told
-- it can do, and an agent seeded without them is a prompt: all four of
-- Vayuveda's agents carry the same three, and without them the seeded
-- reception cannot offer to book anything.
--
-- **Tools are still not packed, and now for a third reason.** The two already
-- recorded hold — a tool cannot authenticate, since `ctx.secrets` is `{}` on
-- every invocation — and the sharper one is that these particular tools are
-- mocks. `check_slots` hashes a doctor's name into plausible availability,
-- which is the fault that booked an appointment against "Cardiologist A", a
-- person who does not exist. Copying that into a customer's workspace ships a
-- tool that invents availability, which is worse than none.
--
-- So `skill_tools` links are deliberately not copied either. A seeded skill is
-- a described capability with nothing behind it yet, which is what it is.
--
-- ## Nothing linked an agent to its skills
--
-- `agent_skills` was never written by seeding, so even a copied skill would
-- have sat unattached. An agent template names its skills by label, for the
-- same reason a flow now names its agents: a label survives being written down
-- and a uuid does not.

alter table templates drop constraint if exists templates_kind_check;
alter table templates add constraint templates_kind_check
    check (kind = any (array['agent', 'flow', 'skill']));

comment on column templates.payload is
    'The row to create. An agent template may carry `skills`: an array of skill template labels to attach. A flow template''s graph names agents as {{AGENT:<label>}}.';

create or replace function seed_workspace(p_org uuid, p_pack text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    pack       record;
    t          record;
    new_agent  uuid;
    new_skill  uuid;
    new_flow   uuid;
    first_agent uuid;
    engine_ref uuid;
    granted    integer := 0;
    agents_made integer := 0;
    skills_made integer := 0;
    flows_made  integer := 0;
    -- label -> id, for the two things a template references by name.
    agent_ids  jsonb := '{}'::jsonb;
    skill_ids  jsonb := '{}'::jsonb;
    graph      text;
    wanted     text;
    leftover   text;
    made       jsonb := '{}'::jsonb;
begin
    if not (is_platform_admin() or caller_is_service_role()) then
        raise exception 'not a platform administrator';
    end if;

    select * into pack from packs
     where is_active and (p_pack is null or slug = p_pack)
     order by sort_order limit 1;

    if pack is null then
        raise exception 'no such pack';
    end if;

    -- ---- Skills first: an agent attaches to them ---------------------------
    for t in
        select * from templates
         where pack_id = pack.id and kind = 'skill' and is_active
         order by sort_order
    loop
        select id into new_skill from skills
         where org_id = p_org and slug = (t.payload ->> 'slug');

        if new_skill is null then
            insert into skills (org_id, name, slug, description, instructions,
                                collects, completion, status)
            values (
                p_org,
                t.payload ->> 'name',
                t.payload ->> 'slug',
                coalesce(t.payload ->> 'description', ''),
                t.payload ->> 'instructions',
                coalesce(t.payload -> 'collects', '[]'::jsonb),
                t.payload ->> 'completion',
                -- Draft, like a seeded agent. A skill with no tools behind it
                -- is not ready to be offered to a caller, and publishing it
                -- here would say otherwise.
                'draft'
            )
            returning id into new_skill;
            skills_made := skills_made + 1;
        end if;
        skill_ids := skill_ids || jsonb_build_object(t.label, new_skill::text);
    end loop;

    -- ---- Agents ------------------------------------------------------------
    for t in
        select * from templates
         where pack_id = pack.id and kind = 'agent' and is_active
         order by sort_order
    loop
        -- Named, not copied. A pack that seeded an engine would create a
        -- workspace-owned row nobody can read and no picker offers.
        engine_ref := null;
        if t.engine_slug is not null then
            select id into engine_ref from engines
             where slug = t.engine_slug and org_id is null and status = 'published';
            if engine_ref is null then
                raise exception 'the pack names engine % , which is not a published platform engine', t.engine_slug;
            end if;

            -- The permission travels with the pack (0106). Without it the agent
            -- runs on an engine its own workspace cannot see.
            insert into organization_entitlements (org_id, kind, item_id, allowed)
            values (p_org, 'engine', engine_ref::text, true)
            -- An operator who has denied this engine for this workspace meant
            -- it. Seeding must not silently re-allow what somebody turned off.
            on conflict (org_id, kind, item_id) do nothing;
            if found then
                granted := granted + 1;
            end if;
        end if;

        select id into new_agent from agents
         where org_id = p_org and name = (t.payload ->> 'name');

        if new_agent is null then
            insert into agents (
                org_id, name, status, provider, model, system_prompt, first_message,
                voice_config, transcriber_config, analysis_config, compliance_config,
                config, engine_id, pack_slug, pack_version
            )
            values (
                p_org,
                t.payload ->> 'name',
                'draft',
                -- Empty: the engine decides, and a mirror of it on the agent is
                -- a second place for the same fact to live (0093).
                '', '',
                coalesce(t.payload ->> 'system_prompt', ''),
                coalesce(t.payload ->> 'first_message', ''),
                '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                coalesce(t.payload -> 'config', '{}'::jsonb),
                engine_ref,
                pack.slug, pack.version
            )
            returning id into new_agent;
            agents_made := agents_made + 1;
        end if;

        agent_ids := agent_ids || jsonb_build_object(t.label, new_agent::text);
        first_agent := coalesce(first_agent, new_agent);

        -- ---- What this agent can do ----------------------------------------
        -- By label, so the link survives being written into a template. A
        -- missing one is raised rather than skipped: an agent silently short of
        -- a skill is an agent that declines to do something nobody knows it was
        -- meant to.
        if t.payload ? 'skills' then
            foreach wanted in array
                array(select jsonb_array_elements_text(t.payload -> 'skills'))
            loop
                if not (skill_ids ? wanted) then
                    raise exception 'agent template % wants skill %, which this pack does not carry',
                        t.label, wanted;
                end if;
                insert into agent_skills (org_id, agent_id, skill_id)
                values (p_org, new_agent, (skill_ids ->> wanted)::uuid)
                on conflict (agent_id, skill_id) do nothing;
            end loop;
        end if;
    end loop;

    -- ---- Flows -------------------------------------------------------------
    for t in
        select * from templates
         where pack_id = pack.id and kind = 'flow' and is_active
         order by sort_order
    loop
        select id into new_flow from flows
         where org_id = p_org and name = (t.payload ->> 'name');

        if new_flow is null then
            graph := (t.payload -> 'graph')::text;

            -- Every agent this graph names, by label.
            for wanted in select * from jsonb_object_keys(agent_ids) loop
                graph := replace(graph, '{{AGENT:' || wanted || '}}', agent_ids ->> wanted);
            end loop;

            -- Kept for `clinic-reception` v1, which uses it. It means the first
            -- agent in the pack rather than the last one inserted, which is
            -- what the old code accidentally meant.
            graph := replace(graph, '{{AGENT_ID}}', coalesce(first_agent::text, ''));

            -- **A placeholder nothing filled is a failure here, not on a call.**
            -- Left in place it reaches `runner.rs` as an agent id, and the
            -- first person to find out is a caller listening to silence.
            leftover := substring(graph from '\{\{AGENT[^}]*\}\}');
            if leftover is not null then
                raise exception 'flow template % names %, which this pack does not carry',
                    t.label, leftover;
            end if;

            insert into flows (org_id, name, description, status, graph, config,
                               trigger_event, channel, pack_slug, pack_version)
            values (
                p_org,
                t.payload ->> 'name',
                coalesce(t.payload ->> 'description', ''),
                'draft',
                graph::jsonb,
                coalesce(t.payload -> 'config', '{}'::jsonb),
                coalesce(t.payload ->> 'trigger_event', 'call.answered'),
                coalesce(t.payload ->> 'channel', 'voice'),
                pack.slug, pack.version
            )
            returning id into new_flow;
            flows_made := flows_made + 1;
        end if;
        made := made || jsonb_build_object('flow', new_flow);
    end loop;

    return (made || jsonb_build_object(
        'pack', pack.slug,
        'version', pack.version,
        'agents', agents_made,
        'skills', skills_made,
        'flows', flows_made,
        'engines_granted', granted
    ))::json;
end;
$$;

revoke all on function seed_workspace(uuid, text) from public, anon;
grant execute on function seed_workspace(uuid, text) to authenticated, service_role;

comment on function seed_workspace(uuid, text) is
    'Instantiate one pack into a workspace: its skills, its agents with those skills attached, its flows, and the right to use the platform engines it names. Idempotent by name. Tools, schemas and number bindings are deliberately not seeded.';

-- ---- What the operator sees ------------------------------------------------

drop function if exists operator_packs();

create or replace function operator_packs()
returns table (
    id         uuid,
    slug       text,
    label      text,
    domain     text,
    summary    text,
    version    integer,
    is_active  boolean,
    agents     bigint,
    flows      bigint,
    skills     bigint,
    engines    text[],
    workspaces bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    return query
    select p.id, p.slug, p.label, p.domain, p.summary, p.version, p.is_active,
           (select count(*) from templates t where t.pack_id = p.id and t.kind = 'agent' and t.is_active),
           (select count(*) from templates t where t.pack_id = p.id and t.kind = 'flow'  and t.is_active),
           (select count(*) from templates t where t.pack_id = p.id and t.kind = 'skill' and t.is_active),
           coalesce((
               select array_agg(distinct e.public_name)
                 from templates t
                 join engines e on e.slug = t.engine_slug and e.org_id is null
                where t.pack_id = p.id and t.is_active and e.public_name is not null
           ), array[]::text[]),
           (select count(distinct a.org_id) from agents a where a.pack_slug = p.slug)
      from packs p
     order by p.sort_order, p.label;
end;
$$;

revoke all on function operator_packs() from public, anon;
grant execute on function operator_packs() to authenticated;
