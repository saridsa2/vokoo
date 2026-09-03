-- Seed an engine as `published`, not `active`.
--
-- `engines_status_check` allows draft and published only — I wrote 'active'
-- from the shape of `phone_numbers` and `agent_extensions`, which do use it.
-- Three tables, two vocabularies, and the constraint is what said so.
--
-- **Published, not draft**, and that is the substantive half: a seeded
-- workspace is supposed to answer a call on the day it is made, and an engine
-- left in draft is one a call cannot reach. Seeding something inert would be
-- the empty shell again wearing four rows.
create or replace function seed_workspace(p_org uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    byo         boolean;
    wanted      text[];
    t           record;
    new_engine  uuid;
    new_agent   uuid;
    new_flow    uuid;
    made        jsonb := '{}'::jsonb;
begin
    if not (is_platform_admin() or caller_is_service_role()) then
        raise exception 'not a platform administrator';
    end if;

    byo := org_may(p_org, 'capability', 'byo_intelligence');
    wanted := case when byo then array['byo', 'both'] else array['platform', 'both'] end;

    for t in
        select * from templates
         where kind = 'engine' and is_active and audience = any(wanted)
         order by sort_order
    loop
        select id into new_engine from engines
         where org_id = p_org and name = (t.payload ->> 'name');

        if new_engine is null then
            insert into engines (org_id, name, slug, description, mode, config, status)
            values (p_org, t.payload ->> 'name', t.payload ->> 'slug',
                    coalesce(t.payload ->> 'description', ''), t.payload ->> 'mode',
                    coalesce(t.payload -> 'config', '{}'::jsonb), 'published')
            returning id into new_engine;
        end if;
        made := made || jsonb_build_object('engine', new_engine);
    end loop;

    for t in
        select * from templates
         where kind = 'agent' and is_active and audience = any(wanted)
         order by sort_order
    loop
        select id into new_agent from agents
         where org_id = p_org and name = (t.payload ->> 'name');

        if new_agent is null then
            insert into agents (
                org_id, name, status, provider, model, system_prompt, first_message,
                voice_config, transcriber_config, analysis_config, compliance_config,
                config, engine_id
            )
            values (p_org, t.payload ->> 'name', 'published',
                    coalesce(t.payload ->> 'provider', ''), coalesce(t.payload ->> 'model', ''),
                    coalesce(t.payload ->> 'system_prompt', ''),
                    coalesce(t.payload ->> 'first_message', ''),
                    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                    coalesce(t.payload -> 'config', '{}'::jsonb), new_engine)
            returning id into new_agent;
        end if;
        made := made || jsonb_build_object('agent', new_agent);
    end loop;

    for t in
        select * from templates
         where kind = 'flow' and is_active and audience = any(wanted)
         order by sort_order
    loop
        select id into new_flow from flows
         where org_id = p_org and name = (t.payload ->> 'name');

        if new_flow is null then
            insert into flows (org_id, name, description, status, graph, config,
                               trigger_event, channel)
            values (p_org, t.payload ->> 'name', coalesce(t.payload ->> 'description', ''),
                    'published',
                    replace((t.payload -> 'graph')::text, '{{AGENT_ID}}',
                            coalesce(new_agent::text, ''))::jsonb,
                    coalesce(t.payload -> 'config', '{}'::jsonb),
                    coalesce(t.payload ->> 'trigger_event', 'call.answered'),
                    coalesce(t.payload ->> 'channel', 'voice'))
            returning id into new_flow;
        end if;
        made := made || jsonb_build_object('flow', new_flow);
    end loop;

    return made::json;
end;
$$;

revoke all on function seed_workspace(uuid) from public, anon;
grant execute on function seed_workspace(uuid) to authenticated, service_role;
