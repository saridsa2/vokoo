-- A pack was not one thing. It copied agents and flows, pointed each agent at a
-- platform engine — and never gave the workspace permission to use it.
--
-- `available_engines` filters on `org_may`, which reads the workspace's own
-- overrides and then its plan's entitlements. Neither knows anything about
-- packs. So `seed_workspace` could hand a new customer a working agent on
-- `hindi-relay-sarvam` while the engine picker on their own screen offered
-- nothing, and moving that agent to another engine was impossible from inside
-- the console.
--
-- It has not bitten because every workspace so far is on a plan that grants
-- every engine. It is one sign-up on a narrower plan away from being the first
-- thing a new customer sees.
--
-- ## The engine is still named, not copied
--
-- 0091 made engines the platform's and this does not change that — a pack that
-- copied one would create a workspace-owned row that RLS hides from its owner,
-- carrying no public name, appearing in no picker. What travels with the pack
-- is the *permission*, written as an `organization_entitlements` override.
--
-- An override rather than a change to the plan, because a pack is chosen per
-- workspace and a plan is shared by many. Seeding one clinic must not quietly
-- widen what every other workspace on Starter may use.
--
-- ## Why this makes it one pack
--
-- A pack now delivers everything the thing it describes needs to run: the
-- agents, the flow that answers, and the right to use the engine underneath
-- them. Before this it delivered two of the three and the third was somebody
-- remembering.

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
    new_flow   uuid;
    engine_ref uuid;
    granted    integer := 0;
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

    -- Agents first: a flow's graph names an agent by id.
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

            -- ---- added in 0106 ----
            -- The permission travels with the pack. Without this the agent
            -- below runs on an engine its own workspace cannot see.
            --
            -- Written before the agent, so a failure here leaves no agent
            -- pointing at an engine nobody may use.
            insert into organization_entitlements (org_id, kind, item_id, allowed)
            values (p_org, 'engine', engine_ref::text, true)
            -- An operator who has already denied this engine for this
            -- workspace meant it. Seeding must not silently re-allow what
            -- somebody turned off — `operator_set_engine_access` is the way
            -- back, and it says who did it.
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
        end if;
        made := made || jsonb_build_object('agent', new_agent);
    end loop;

    for t in
        select * from templates
         where pack_id = pack.id and kind = 'flow' and is_active
         order by sort_order
    loop
        select id into new_flow from flows
         where org_id = p_org and name = (t.payload ->> 'name');

        if new_flow is null then
            insert into flows (org_id, name, description, status, graph, config,
                               trigger_event, channel, pack_slug, pack_version)
            values (
                p_org,
                t.payload ->> 'name',
                coalesce(t.payload ->> 'description', ''),
                'draft',
                replace((t.payload -> 'graph')::text, '{{AGENT_ID}}',
                        coalesce(new_agent::text, ''))::jsonb,
                coalesce(t.payload -> 'config', '{}'::jsonb),
                coalesce(t.payload ->> 'trigger_event', 'call.answered'),
                coalesce(t.payload ->> 'channel', 'voice'),
                pack.slug, pack.version
            )
            returning id into new_flow;
        end if;
        made := made || jsonb_build_object('flow', new_flow);
    end loop;

    return (made || jsonb_build_object(
        'pack', pack.slug,
        'version', pack.version,
        'engines_granted', granted
    ))::json;
end;
$$;

revoke all on function seed_workspace(uuid, text) from public, anon;
grant execute on function seed_workspace(uuid, text) to authenticated, service_role;

comment on function seed_workspace(uuid, text) is
    'Instantiate one pack into a workspace: its agents, its flow, and the right to use the engines it names. Idempotent by name.';

comment on table packs is
    'What a new workspace is seeded with, grouped by the business it is for. A pack copies agents and flows, and grants the workspace use of the platform engines it names.';

-- Every workspace already seeded, brought up to what a pack now delivers.
-- Silent where the entitlement already exists, and it does for all of them
-- today — every current workspace is on a plan granting every engine. The point
-- is the ones whose plan later narrows.
insert into organization_entitlements (org_id, kind, item_id, allowed)
select distinct a.org_id, 'engine', a.engine_id::text, true
  from agents a
  join engines e on e.id = a.engine_id
 where a.engine_id is not null
   and a.pack_slug is not null
   and e.org_id is null
on conflict (org_id, kind, item_id) do nothing;
