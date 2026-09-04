-- A starter pack: what a clinic gets on the day it signs up.
--
-- `templates` was a flat list of four rows and `seed_workspace` instantiated
-- every one a workspace was entitled to. That made one starting point for every
-- customer, which is wrong the moment the second customer is not a clinic.
--
-- A pack is that list, named and grouped by the business it is for.
--
-- ## What a pack copies, and what it only names
--
-- The distinction matters more than the grouping, because a copy diverges the
-- moment it is made and a reference does not.
--
--   copied      agents and flows — the prompt, the greeting, the graph. These
--               are the customer's to edit, and them diverging is the point.
--   referenced  the engine. 0091 made engines the platform's; a pack that
--               seeded one would create a workspace-owned row that RLS hides
--               from its own owner and that carries no public name, so it
--               appears in no picker either. A pack names an engine by slug.
--
-- **So the two `engine` templates are deleted.** They were already broken by
-- 0091 in exactly that way: a freshly provisioned workspace got a phantom
-- engine and an agent pointing at it.
--
-- ## No skills and no tools in a pack, deliberately
--
-- A skill is org-scoped (`skills.org_id` is `not null`), so a pack could only
-- copy one — and a skill is the piece most likely to need fixing across every
-- customer at once, which a copy makes impossible. A tool is worse: nothing
-- shipped in a pack can authenticate, because `ctx.secrets` is `{}` on every
-- invocation.
--
-- They are *suggested* instead, by the workspace's own intelligence, at the
-- point somebody is editing an agent. A suggestion creates no row, so nothing
-- diverges and nothing needs a credential.

-- ---- Packs -----------------------------------------------------------------

create table if not exists packs (
    id          uuid primary key default gen_random_uuid(),
    slug        text not null unique,
    label       text not null,
    -- What kind of business this is for. Free text rather than an enum: the
    -- list of businesses this platform serves is not knowable in advance, and
    -- a check constraint on it would make adding a customer a migration.
    domain      text not null default '',
    summary     text not null default '',
    -- Bumped whenever the pack's contents change. Nothing reads it yet; it is
    -- stamped onto every row a pack creates, and that stamp cannot be
    -- reconstructed later — without it there is no way to tell which of forty
    -- clinics got the old prompt.
    version     integer not null default 1,
    sort_order  integer not null default 0,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table packs is
    'What a new workspace is seeded with, grouped by the business it is for. A pack copies agents and flows and only names an engine.';

alter table packs enable row level security;

create policy packs_operator_only on packs
    for all to authenticated
    using (is_platform_admin())
    with check (is_platform_admin());

-- ---- Templates belong to a pack --------------------------------------------

alter table templates
    add column if not exists pack_id uuid references packs(id) on delete cascade,
    -- Which platform engine a seeded agent points at, by slug rather than by
    -- id: a pack is content, and an id ties it to one installation's rows.
    add column if not exists engine_slug text;

comment on column templates.engine_slug is
    'The platform engine a seeded agent runs on, named by slug. NULL leaves the agent with no engine, which falls back to the bridge environment.';

-- `audience` split the operator's engines from a plain starting point for a
-- tenant bringing its own keys. Nobody brings their own since 0090, and the two
-- engine templates were its only users.
alter table templates drop constraint if exists templates_audience_check;
alter table templates drop column if exists audience;

delete from templates where kind = 'engine';

alter table templates drop constraint if exists templates_kind_check;
alter table templates add constraint templates_kind_check
    check (kind = any (array['agent', 'flow']));

-- ---- Where a row came from -------------------------------------------------

-- Stamped on every row a pack creates. Nothing reads it yet, and it is added
-- now because it cannot be reconstructed later: once forty workspaces have been
-- seeded, there is no way to tell which of them got version 1 of the prompt.
alter table agents
    add column if not exists pack_slug text,
    add column if not exists pack_version integer;

alter table flows
    add column if not exists pack_slug text,
    add column if not exists pack_version integer;

comment on column agents.pack_slug is
    'The pack this agent was seeded from, and the version of it. Null for one somebody made themselves. Write-only for now — it exists so the question can be answered later.';

-- ---- The first pack --------------------------------------------------------

insert into packs (slug, label, domain, summary, sort_order)
values (
    'clinic-reception',
    'Clinic reception',
    'Healthcare',
    'Answers the phone, books an appointment and hands to the front desk when asked.',
    0
)
on conflict (slug) do nothing;

-- The four rows that existed become that pack's contents. `Hindi` is the
-- engine they run on: it carried 25 of the 48 sessions this platform has
-- recorded, and it is the one measured to read Indian names correctly.
update templates
   set pack_id     = (select id from packs where slug = 'clinic-reception'),
       engine_slug = case when kind = 'agent' then 'hindi-relay-sarvam' else null end
 where pack_id is null;

-- ---- Seeding a workspace from a pack ---------------------------------------

-- Instantiate one pack into a workspace.
--
-- **Idempotent by name**, as the original was: provisioning is retried the
-- first time it half-fails, and two agents with one name is worse than none
-- because a flow reaches whichever it happens to name.
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

    return (made || jsonb_build_object('pack', pack.slug, 'version', pack.version))::json;
end;
$$;

revoke all on function seed_workspace(uuid, text) from public, anon;
grant execute on function seed_workspace(uuid, text) to authenticated, service_role;

-- ---- What the operator sees ------------------------------------------------

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
           count(t.id) filter (where t.kind = 'agent'),
           count(t.id) filter (where t.kind = 'flow'),
           -- The engines this pack puts a customer on, by their public names —
           -- which is what the customer will see in their own picker.
           coalesce(array_agg(distinct e.public_name)
                    filter (where e.public_name is not null), '{}'::text[]),
           coalesce((select count(distinct a.org_id) from agents a
                      where a.pack_slug = p.slug), 0)
      from packs p
      left join templates t on t.pack_id = p.id and t.is_active
      left join engines e on e.slug = t.engine_slug and e.org_id is null
     group by p.id
     order by p.sort_order, p.label;
end;
$$;

revoke all on function operator_packs() from public, anon;
grant execute on function operator_packs() to authenticated;
