-- Publishing an assistant, as a database function.
--
-- Versioning lives here rather than in the API for two reasons. First, the
-- version number and the snapshot must be written in the same transaction as
-- the row update, or a crash between them leaves history that disagrees with
-- the live configuration. Second, a client that forgets to write a version
-- would silently break rollback for that assistant only — a failure nobody
-- notices until they need to roll back.
--
-- SECURITY INVOKER (the default) is deliberate: the function runs as the
-- caller, so row-level security still applies and it cannot be used to reach
-- another organisation's assistants.

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

-- Restoring is a publish of an older snapshot, not a separate mechanism: it
-- takes the same path, appends a new version, and leaves the same trail. A
-- rollback that rewrote history would make the audit log a lie.
create or replace function public.restore_assistant_version(
  p_assistant_id uuid,
  p_version integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_snapshot jsonb;
begin
  select snapshot into v_snapshot
  from public.assistant_versions
  where assistant_id = p_assistant_id and version = p_version;

  if v_snapshot is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;

  return public.publish_assistant(p_assistant_id, v_snapshot);
end;
$$;

revoke all on function public.restore_assistant_version(uuid, integer) from public;
grant execute on function public.restore_assistant_version(uuid, integer) to authenticated;

-- Reading history is a list of versions, newest first. The snapshot is included
-- so the console can diff two versions without a second round trip per version.
create index if not exists assistant_versions_assistant_version_idx
  on public.assistant_versions (assistant_id, version desc);
