-- Publishing is a different privilege from editing.
--
-- Editing an assistant changes a draft; publishing puts it in front of real
-- callers. The spec leaves the exact boundary open — whether a developer may
-- release, or only an owner or admin — so this migration does not decide it.
-- It enforces the part that is not in question: a viewer may not publish.
--
-- The check lives in the database rather than the API because publishing also
-- happens through restore, and a check in one handler would leave the other
-- open. One gate on the function covers both paths.

create or replace function public.can_publish_assistants(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where org_id = p_org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin', 'developer')
  );
$$;

-- SECURITY DEFINER above is deliberate and narrow: the function reads only
-- memberships, only for the calling user, and returns a boolean. Without it the
-- membership row would itself have to be visible under RLS for the check to
-- work, which makes the answer depend on a second policy rather than on the
-- membership.
revoke all on function public.can_publish_assistants(uuid) from public;
grant execute on function public.can_publish_assistants(uuid) to authenticated;

create or replace function public.publish_assistant(
  p_assistant_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org_id     uuid;
  v_next       integer;
  v_row        public.assistants;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  -- Read through RLS: a caller outside the assistant's organisation sees no
  -- row and gets a not-found rather than a permission error, which avoids
  -- confirming that the id exists.
  select org_id into v_org_id from public.assistants where id = p_assistant_id;
  if v_org_id is null then
    raise exception 'assistant not found' using errcode = 'P0002';
  end if;

  if not public.can_publish_assistants(v_org_id) then
    raise exception 'your role may not publish assistants' using errcode = 'P0003';
  end if;

  update public.assistants set
    name               = coalesce(p_payload->>'name', name),
    provider           = coalesce(p_payload->>'provider', provider),
    model              = coalesce(p_payload->>'model', model),
    first_message      = coalesce(p_payload->>'first_message', first_message),
    system_prompt      = coalesce(p_payload->>'system_prompt', system_prompt),
    voice_config       = coalesce(p_payload->'voice_config', voice_config),
    transcriber_config = coalesce(p_payload->'transcriber_config', transcriber_config),
    analysis_config    = coalesce(p_payload->'analysis_config', analysis_config),
    compliance_config  = coalesce(p_payload->'compliance_config', compliance_config),
    config             = coalesce(p_payload->'config', config),
    status             = 'published',
    published_at       = now(),
    updated_at         = now()
  where id = p_assistant_id
  returning * into v_row;

  -- Version numbers are per assistant and contiguous, so the history reads as
  -- "version 3" rather than an opaque id.
  select coalesce(max(version), 0) + 1 into v_next
  from public.assistant_versions
  where assistant_id = p_assistant_id;

  insert into public.assistant_versions (org_id, assistant_id, version, snapshot, published_by)
  values (v_org_id, p_assistant_id, v_next, to_jsonb(v_row), auth.uid());

  return jsonb_build_object('assistant', to_jsonb(v_row), 'version', v_next);
end;
$$;

revoke all on function public.publish_assistant(uuid, jsonb) from public;
grant execute on function public.publish_assistant(uuid, jsonb) to authenticated;
