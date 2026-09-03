-- Templates, and the numbers the operator holds.
--
-- Provisioning created an empty shell: Test Clinic had zero numbers, engines,
-- agents and flows, so its owner followed an invitation and arrived somewhere
-- nothing could happen. A workspace should answer a call on the day it is
-- made.
--
-- ## Two sets of engine templates, and the reason is not plumbing
--
-- Which model hears, which thinks, which speaks, and in what order, is the
-- product. `Hindi relay (Sarvam)` exists because Sarvam beat ElevenLabs at both
-- ends on real calls — that is a finding, not a configuration.
--
-- So `audience` decides who gets which:
--
--   platform  the operator's own engines, seeded to workspaces running on
--             platform keys, and not visible to them
--   byo       a plain starting point for a workspace bringing its own keys,
--             which they wire up themselves
--   both      agents and flows — a starter prompt and a graph that answers is
--             onboarding, not intellectual property
--
-- ## The pool
--
-- `phone_numbers.org_id` becomes nullable, and null means the operator holds
-- it unassigned. Same shape as the platform keys in 0084, for the same reason:
-- one table, one RLS story, and a row a tenant cannot see rather than a second
-- place numbers might live.

-- ---- Templates -------------------------------------------------------------

create table if not exists templates (
    id         uuid primary key default gen_random_uuid(),
    kind       text not null check (kind in ('engine', 'agent', 'flow')),
    -- Who this is seeded to. See above: the operator's engine configuration is
    -- not handed to somebody bringing their own keys.
    audience   text not null default 'both' check (audience in ('platform', 'byo', 'both')),
    label      text not null,
    summary    text not null default '',
    -- The row to create, minus everything that belongs to a tenant: no id, no
    -- org_id, no timestamps. Instantiating is this plus the workspace.
    payload    jsonb not null,
    sort_order integer not null default 0,
    is_active  boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table templates is
    'What a new workspace is seeded with. `audience` splits the operator''s own engines from a plain starting point for a tenant bringing its own keys.';

alter table templates enable row level security;

-- No tenant reads this. A template is the platform's, and a workspace sees only
-- the rows instantiated from it.
create policy templates_operator_only on templates
    for select to authenticated
    using (is_platform_admin());

-- ---- The number pool -------------------------------------------------------

alter table phone_numbers alter column org_id drop not null;

comment on column phone_numbers.org_id is
    'The workspace this number answers for. NULL is held unassigned by the operator.';

-- An unassigned number must be invisible to every tenant. The existing policies
-- are org-scoped so a null already matches none of them, but saying it stops a
-- later policy widening it by accident — the same reasoning as 0084.
drop policy if exists phone_numbers_no_pool_rows on phone_numbers;
create policy phone_numbers_no_pool_rows on phone_numbers
    for select to authenticated
    using (org_id is not null and is_org_member(org_id));

-- One workspace per number, and a number cannot be listed twice in the pool.
create unique index if not exists phone_numbers_unique on phone_numbers (number);

-- ---- What the operator does with the pool ----------------------------------

create or replace function operator_add_number(p_number text, p_label text, p_carrier text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    new_id uuid;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    -- E.164, because that is what the carrier hands over and what
    -- `graph::spellings` normalises against. A number stored in another shape
    -- resolves no flow, and the symptom is a caller hearing nothing — this
    -- project has already had that exact bug with a missing '+'.
    if btrim(p_number) !~ '^\+[1-9][0-9]{7,14}$' then
        raise exception 'a number must be E.164, like +918040802529';
    end if;

    insert into phone_numbers (org_id, number, label, carrier, status)
    values (null, btrim(p_number), coalesce(nullif(btrim(p_label), ''), btrim(p_number)),
            coalesce(nullif(btrim(p_carrier), ''), 'kookoo'), 'active')
    returning id into new_id;

    return json_build_object('id', new_id, 'number', btrim(p_number));
end;
$$;

revoke all on function operator_add_number(text, text, text) from public, anon;
grant execute on function operator_add_number(text, text, text) to authenticated;

-- Give a held number to a workspace, or take it back.
--
-- `p_org` null releases it to the pool. Releasing also clears the flow and
-- agent bindings: they point at rows in the workspace losing the number, and a
-- number carrying another tenant's flow id is how a caller reaches the wrong
-- business.
create or replace function operator_assign_number(p_number_id uuid, p_org uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    if p_org is not null and not exists (select 1 from organizations where id = p_org) then
        raise exception 'no such organisation';
    end if;

    update phone_numbers
       set org_id     = p_org,
           flow_id    = case when p_org is null then null else flow_id end,
           agent_id   = case when p_org is null then null else agent_id end,
           updated_at = now()
     where id = p_number_id;

    if not found then
        raise exception 'no such number';
    end if;

    -- The binding a released number carried is gone too, or the next workspace
    -- inherits a route into somebody else's flow.
    if p_org is null then
        delete from number_flows where phone_number_id = p_number_id;
    end if;

    return json_build_object('ok', true);
end;
$$;

revoke all on function operator_assign_number(uuid, uuid) from public, anon;
grant execute on function operator_assign_number(uuid, uuid) to authenticated;

create or replace function operator_numbers()
returns table (
    id       uuid,
    number   text,
    label    text,
    carrier  text,
    status   text,
    org_id   uuid,
    org_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    return query
    select p.id, p.number, p.label, p.carrier, p.status, p.org_id, o.name
      from phone_numbers p
      left join organizations o on o.id = p.org_id
     order by o.name nulls first, p.number;
end;
$$;

revoke all on function operator_numbers() from public, anon;
grant execute on function operator_numbers() to authenticated;

-- ---- Seeding a workspace ---------------------------------------------------

-- Instantiate every active template a workspace is entitled to.
--
-- Engines split on `byo_intelligence`: a workspace running on platform keys
-- gets the operator's own, a workspace bringing its own gets a plain starting
-- point. Agents and flows are seeded either way.
--
-- **Idempotent by name.** Provisioning is one action today and will be retried
-- the first time it half-fails; seeding a second engine called the same thing
-- is worse than seeding none, because a caller reaches whichever the flow
-- happens to name.
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

    -- Engines first: an agent names one, and a flow names an agent.
    for t in
        select * from templates
         where kind = 'engine' and is_active and audience = any(wanted)
         order by sort_order
    loop
        select id into new_engine from engines
         where org_id = p_org and name = (t.payload ->> 'name');

        if new_engine is null then
            insert into engines (org_id, name, slug, description, mode, config, status)
            values (
                p_org,
                t.payload ->> 'name',
                t.payload ->> 'slug',
                coalesce(t.payload ->> 'description', ''),
                t.payload ->> 'mode',
                coalesce(t.payload -> 'config', '{}'::jsonb),
                'active'
            )
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
            values (
                p_org,
                t.payload ->> 'name',
                'draft',
                coalesce(t.payload ->> 'provider', ''),
                coalesce(t.payload ->> 'model', ''),
                coalesce(t.payload ->> 'system_prompt', ''),
                coalesce(t.payload ->> 'first_message', ''),
                '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
                coalesce(t.payload -> 'config', '{}'::jsonb),
                new_engine
            )
            returning id into new_agent;
        end if;
        made := made || jsonb_build_object('agent', new_agent);
    end loop;

    -- The flow's graph names an agent by id, which does not exist until the
    -- agent above does — so the template carries a placeholder and it is
    -- substituted here. Doing it in the template would mean a template that
    -- only works for one workspace.
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
            values (
                p_org,
                t.payload ->> 'name',
                coalesce(t.payload ->> 'description', ''),
                'draft',
                replace(
                    (t.payload -> 'graph')::text,
                    '{{AGENT_ID}}',
                    coalesce(new_agent::text, '')
                )::jsonb,
                coalesce(t.payload -> 'config', '{}'::jsonb),
                coalesce(t.payload ->> 'trigger_event', 'call.answered'),
                coalesce(t.payload ->> 'channel', 'voice')
            )
            returning id into new_flow;
        end if;
        made := made || jsonb_build_object('flow', new_flow);
    end loop;

    return made::json;
end;
$$;

revoke all on function seed_workspace(uuid) from public, anon;
grant execute on function seed_workspace(uuid) to authenticated, service_role;

comment on function seed_workspace is
    'Instantiate the templates a workspace is entitled to. Idempotent by name: provisioning will be retried, and two engines with one name is worse than none.';
