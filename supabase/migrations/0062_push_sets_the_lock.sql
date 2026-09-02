-- The push writes the lock, and says who it is while doing it.
--
-- `locked` defaults to **true** for anything arriving from the CLI: the source
-- is the authority, so the console must not edit it. An author who wants the
-- opposite says `locked: false` in the file and means it.
--
-- `set_config('vokoo.pushing', 'on', true)` is transaction-local — the `true`
-- argument — so it cannot leak into another statement or another session. It is
-- how the trigger tells the one legitimate writer from everybody else, rather
-- than by recognising a role that other things also run as.

create or replace function public.push_schemas(p_org_id uuid, p_schemas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entry     jsonb;
  v_existing  public.structured_outputs;
  v_locked    boolean;
  v_created   text[] := '{}';
  v_updated   text[] := '{}';
  v_unchanged text[] := '{}';
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organisation' using errcode = 'P0003';
  end if;

  perform set_config('vokoo.pushing', 'on', true);

  for v_entry in select * from jsonb_array_elements(coalesce(p_schemas, '[]'::jsonb))
  loop
    -- Absent means locked. A CLI that predates the field pushes files whose
    -- authority is still a repository, and defaulting to unlocked would let the
    -- console edit them and lose the edit on the next push.
    v_locked := coalesce((v_entry->>'locked')::boolean, true);

    select * into v_existing
      from public.structured_outputs
     where id = (v_entry->>'id')::uuid;

    if v_existing.id is null then
      insert into public.structured_outputs (id, org_id, name, description, schema, enabled, locked, origin)
      values ((v_entry->>'id')::uuid, p_org_id, v_entry->>'name',
              coalesce(v_entry->>'description', ''), v_entry->'schema', true, v_locked, 'push');
      v_created := v_created || (v_entry->>'name');

    elsif v_existing.org_id <> p_org_id then
      raise exception 'the id % belongs to a schema in another organisation', v_entry->>'id'
        using errcode = 'P0004';

    elsif v_existing.name is not distinct from v_entry->>'name'
      and v_existing.description is not distinct from coalesce(v_entry->>'description', '')
      and v_existing.schema is not distinct from v_entry->'schema'
      and v_existing.locked is not distinct from v_locked then
      v_unchanged := v_unchanged || (v_entry->>'name');

    else
      update public.structured_outputs
         set name = v_entry->>'name',
             description = coalesce(v_entry->>'description', ''),
             schema = v_entry->'schema',
             locked = v_locked,
             origin = 'push',
             updated_at = now()
       where id = v_existing.id;
      v_updated := v_updated || (v_entry->>'name');
    end if;
  end loop;

  perform public.end_push();
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;

revoke all on function public.push_schemas(uuid, jsonb) from public, anon;
grant execute on function public.push_schemas(uuid, jsonb) to authenticated;
