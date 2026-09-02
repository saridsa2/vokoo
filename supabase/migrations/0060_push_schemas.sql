-- Receive schemas from `vokoo push`, beside the tools.
--
-- The same contract `push_functions` follows and for the same reasons: the id
-- is authored so sync matches on it, a rename is an update rather than a delete
-- and an insert, and the whole set moves or none of it does.
--
-- Simpler than the tool version of this in one way that matters: a schema has
-- no code, so there is no `tool_versions` row, no checksum over a body and
-- nothing to execute. It is a declaration, and pushing one is an upsert.

create or replace function public.push_schemas(p_org_id uuid, p_schemas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entry     jsonb;
  v_existing  public.structured_outputs;
  v_created   text[] := '{}';
  v_updated   text[] := '{}';
  v_unchanged text[] := '{}';
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organisation' using errcode = 'P0003';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_schemas, '[]'::jsonb))
  loop
    select * into v_existing
      from public.structured_outputs
     where id = (v_entry->>'id')::uuid;

    if v_existing.id is null then
      insert into public.structured_outputs (id, org_id, name, description, schema, enabled)
      values ((v_entry->>'id')::uuid, p_org_id, v_entry->>'name',
              coalesce(v_entry->>'description', ''), v_entry->'schema', true);
      v_created := v_created || (v_entry->>'name');

    elsif v_existing.org_id <> p_org_id then
      -- An id identifies one schema everywhere. Somebody else's is invisible
      -- under row-level security, so this is reported rather than reaching the
      -- primary key as a duplicate-key error nobody can act on.
      raise exception 'the id % belongs to a schema in another organisation', v_entry->>'id'
        using errcode = 'P0004';

    elsif v_existing.name is not distinct from v_entry->>'name'
      and v_existing.description is not distinct from coalesce(v_entry->>'description', '')
      and v_existing.schema is not distinct from v_entry->'schema' then
      -- Nothing moved. Reported as a count rather than a line, so the tenth
      -- push of the day shows only what changed.
      v_unchanged := v_unchanged || (v_entry->>'name');

    else
      update public.structured_outputs
         set name = v_entry->>'name',
             description = coalesce(v_entry->>'description', ''),
             schema = v_entry->'schema',
             updated_at = now()
       where id = v_existing.id;
      v_updated := v_updated || (v_entry->>'name');
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;

revoke all on function public.push_schemas(uuid, jsonb) from public, anon;
grant execute on function public.push_schemas(uuid, jsonb) to authenticated;
