-- `push_functions` carries the reference and the lock.
--
-- Three additions, each one line:
--
--   set_config('vokoo.pushing', …)  identifies the one writer the lock trigger
--                                   lets through, transaction-locally
--   schema_id                       the registry schema the author named
--   locked                          true unless the source says otherwise
--
-- `locked` defaults true for the same reason it does for schemas: a CLI that
-- predates the field still pushes files whose authority is a repository, and
-- defaulting to unlocked would let the console accept an edit that the next
-- push silently discards.

CREATE OR REPLACE FUNCTION public.push_functions(p_org_id uuid, p_functions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      insert into public.tools (id, org_id, name, kind, description, schema, schema_id, locked, origin)
      values (
        v_tool_id, p_org_id, v_entry ->> 'name', 'function',
        coalesce(v_entry ->> 'description', ''),
        coalesce(v_entry -> 'schema', '{}'::jsonb),
        public.resolve_schema_ref(p_org_id, v_entry ->> 'schemaId'),
        -- Absent means locked. A CLI predating the field still pushes files
        -- whose authority is a repository.
        coalesce((v_entry ->> 'locked')::boolean, true),
        'push'
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
      -- The snapshot: what the model is shown. It moves with the version.
      schema          = coalesce(v_entry -> 'schema', '{}'::jsonb),
      -- The reference: what the author said it was.
      schema_id       = public.resolve_schema_ref(p_org_id, v_entry ->> 'schemaId'),
      locked          = coalesce((v_entry ->> 'locked')::boolean, true),
      origin          = 'push',
      kind            = 'function',
      current_version = v_next
     where id = v_tool_id;

    if v_next = 1 then
      v_created := v_created || (v_entry ->> 'name');
    else
      v_updated := v_updated || (v_entry ->> 'name');
    end if;
  end loop;

  perform public.end_push();
  return jsonb_build_object(
    'created', to_jsonb(v_created),
    'updated', to_jsonb(v_updated),
    'unchanged', to_jsonb(v_unchanged)
  );
end;
$function$
