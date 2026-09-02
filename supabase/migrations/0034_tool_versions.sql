-- Versions of a tool, and the endpoint that receives a push.
--
-- `tools` holds what a tool is now: the name the model calls, the description it
-- reads, the schema it is validated against. Nothing downstream changes —
-- `compose_agent_tools` reads the same three columns it always has.
--
-- `tool_versions` holds every build, with the source and a checksum over it.
-- Shaped after `flow_versions`, which already solves this for a flow: a
-- monotonic integer per parent, a snapshot, and who published it. A second
-- pattern for the same problem would be one more thing to learn.
--
-- **The source lives here rather than on the edge runtime's filesystem.** The
-- spec said the bundle would be written under `functions/tools/`. That would
-- have the control plane writing into a directory owned by the Supabase
-- container, and would make a rollback a matter of moving files rather than
-- repointing a row. The executor reads the version it was pinned to, which is a
-- query.

begin;

-- ---------------------------------------------------------------------------
-- A tool has one name
-- ---------------------------------------------------------------------------

-- The dispatcher resolves a tool by `name` with `limit 1`, and the model calls
-- it by name. Nothing stopped two rows in one organisation sharing one, which
-- would make which of them runs a matter of row order. The SDK refuses a
-- duplicate within a single push; this refuses one across two pushes.
create unique index if not exists tools_org_id_name_key on public.tools (org_id, name);

alter table public.tools
  add column if not exists current_version integer not null default 0;

comment on column public.tools.current_version is
  'Which tool_versions row is live. 0 for a tool that predates the SDK and has no versions.';

-- ---------------------------------------------------------------------------
-- The versions
-- ---------------------------------------------------------------------------

create table if not exists public.tool_versions (
  id           uuid default gen_random_uuid()
               constraint tool_versions_pkey primary key,
  org_id       uuid not null
               constraint tool_versions_org_id_fkey
               references public.organizations(id) on delete cascade,
  tool_id      uuid not null
               constraint tool_versions_tool_id_fkey
               references public.tools(id) on delete cascade,
  version      integer not null,
  -- sha256 of `source`, computed by the CLI. Comparing it is what lets a push
  -- skip a tool nobody edited, which is most of them on most pushes.
  checksum     text not null,
  source       text not null,
  -- The manifest entry as it was pushed: name, description, schema, timeout.
  -- Kept whole so a past call can be explained with what was true then, rather
  -- than with what `tools` says now.
  snapshot     jsonb not null,
  published_by uuid
               constraint tool_versions_published_by_fkey
               references auth.users(id),
  created_at   timestamptz not null default now(),
  constraint tool_versions_tool_id_version_key unique (tool_id, version)
);

create index if not exists tool_versions_tool_version_idx
  on public.tool_versions (tool_id, version desc);

alter table public.tool_versions enable row level security;
drop policy if exists tool_versions_select on public.tool_versions;
drop policy if exists tool_versions_write on public.tool_versions;

create policy tool_versions_select on public.tool_versions
  for select to authenticated using (is_org_member(org_id));
-- Insert only. A version is a record of what was pushed, and editing one would
-- make a checksum a claim about something that had since changed underneath it.
create policy tool_versions_write on public.tool_versions
  for insert to authenticated with check (is_org_member(org_id));

grant select, insert on public.tool_versions to authenticated;

-- ---------------------------------------------------------------------------
-- Receiving a push
-- ---------------------------------------------------------------------------

-- Security **invoker**, deliberately. It runs as the API key's machine user, so
-- row-level security decides what may be touched and there is no second copy of
-- the organisation rule here to drift from `is_org_member`.
--
-- A tool whose id belongs to another organisation is invisible to this caller,
-- so the upsert falls through to an insert and the primary key refuses it with
-- 23505. That is the intended outcome: an id identifies one tool everywhere,
-- and the control plane turns that into a message rather than a database error.
create or replace function public.push_functions(p_org_id uuid, p_functions jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_entry     jsonb;
  v_tool_id   uuid;
  v_existing  public.tools%rowtype;
  v_next      integer;
  v_created   text[] := '{}';
  v_updated   text[] := '{}';
  v_unchanged text[] := '{}';
begin
  for v_entry in select value from jsonb_array_elements(p_functions) loop
    v_tool_id := (v_entry ->> 'id')::uuid;

    select * into v_existing from public.tools where id = v_tool_id;

    if found then
      -- Same source as the live version: nothing to record. Writing a version
      -- row anyway would fill the history with copies and make "what changed
      -- on Tuesday" unanswerable.
      if exists (
        select 1 from public.tool_versions tv
         where tv.tool_id = v_existing.id
           and tv.version = v_existing.current_version
           and tv.checksum = v_entry ->> 'checksum'
      ) then
        v_unchanged := v_unchanged || (v_entry ->> 'name');
        continue;
      end if;
    else
      insert into public.tools (id, org_id, name, kind, description, schema)
      values (
        v_tool_id, p_org_id, v_entry ->> 'name', 'function',
        coalesce(v_entry ->> 'description', ''),
        coalesce(v_entry -> 'schema', '{}'::jsonb)
      );
    end if;

    select coalesce(max(version), 0) + 1 into v_next
      from public.tool_versions where tool_id = v_tool_id;

    insert into public.tool_versions (org_id, tool_id, version, checksum, source, code, snapshot, published_by)
    values (
      p_org_id, v_tool_id, v_next,
      v_entry ->> 'checksum',
      coalesce(v_entry ->> 'source', ''),
      coalesce(v_entry ->> 'code', ''),
      -- Neither half of the code belongs in the snapshot: it is the manifest,
      -- and the code sits beside it in its own columns.
      (v_entry - 'source') - 'code',
      auth.uid()
    );

    -- The declaration the model is given comes from `tools`, so it moves with
    -- the version rather than after it.
    update public.tools set
      name            = v_entry ->> 'name',
      description     = coalesce(v_entry ->> 'description', ''),
      schema          = coalesce(v_entry -> 'schema', '{}'::jsonb),
      kind            = 'function',
      current_version = v_next
     where id = v_tool_id;

    if v_next = 1 then
      v_created := v_created || (v_entry ->> 'name');
    else
      v_updated := v_updated || (v_entry ->> 'name');
    end if;
  end loop;

  return jsonb_build_object(
    'created', to_jsonb(v_created),
    'updated', to_jsonb(v_updated),
    'unchanged', to_jsonb(v_unchanged)
  );
end;
$$;

revoke all on function public.push_functions(uuid, jsonb) from public;
grant execute on function public.push_functions(uuid, jsonb) to authenticated, service_role;

commit;
