-- `inputSchema` may be a name, as the SDK documents it.
--
-- It said "by name or id" and the push cast it straight to `uuid`, so a name
-- threw an invalid-input-syntax error naming neither the tool nor the field.
-- A UUID in a source file is also the wrong ergonomics: the whole point of a
-- registry is that a schema has a name people use.
--
-- Resolved here rather than in the CLI, because the CLI does not know what is
-- in the registry and asking it to would mean a round trip before every push.

create or replace function public.resolve_schema_ref(p_org_id uuid, p_ref text)
returns uuid
language plpgsql
stable
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_ref), '') = '' then
    return null;
  end if;

  -- An id if it looks like one, and then it must exist: a tool naming a schema
  -- that is not there is a mistake worth reporting rather than a null nobody
  -- notices until an integration sends an empty body.
  begin
    v_id := p_ref::uuid;
    if exists (select 1 from public.structured_outputs
                where id = v_id and org_id = p_org_id) then
      return v_id;
    end if;
    raise exception 'no schema with id % in this organisation', p_ref using errcode = 'P0004';
  exception when invalid_text_representation then
    -- Not a uuid, so it is a name.
    null;
  end;

  select id into v_id from public.structured_outputs
   where org_id = p_org_id and name = p_ref;

  if v_id is null then
    raise exception 'no schema named "%" — push it, or write it under Build → Schemas', p_ref
      using errcode = 'P0004';
  end if;
  return v_id;
end;
$$;
