-- `publish_agent` did not write `engine_id`.
--
-- Regenerated from the live definition with one field added, rather than
-- rewritten from memory: the function also validates the result, snapshots a
-- version row and returns a version number, and any of that lost in a rewrite
-- would be lost silently.

begin;

CREATE OR REPLACE FUNCTION public.publish_agent(p_agent_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_next   integer;
  v_row    public.agents;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select org_id into v_org_id from public.agents where id = p_agent_id;
  if v_org_id is null then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;
  if not public.can_release(v_org_id) then
    raise exception 'your role may not publish' using errcode = 'P0003';
  end if;

  update public.agents set
    name               = coalesce(p_payload->>'name', name),
    provider           = coalesce(p_payload->>'provider', provider),
    model              = coalesce(p_payload->>'model', model),
    -- Added 1 September. The column arrived in migration 0039 and this function
    -- was not touched, so publishing carried every other field across and left
    -- the engine as it was: switching an agent's engine and pressing Publish
    -- reported success and changed nothing. The console then showed the new
    -- engine while calls kept running on the old one.
    --
    -- Tested for presence rather than coalesced, because detaching an engine is
    -- a real edit and `null` has to mean it.
    engine_id          = case
                           when p_payload ? 'engine_id'
                             then nullif(p_payload->>'engine_id', '')::uuid
                           else engine_id
                         end,
    first_message      = coalesce(p_payload->>'first_message', first_message),
    system_prompt      = coalesce(p_payload->>'system_prompt', system_prompt),
    voice_config       = coalesce(p_payload->'voice_config', voice_config),
    transcriber_config = coalesce(p_payload->'transcriber_config', transcriber_config),
    analysis_config    = coalesce(p_payload->'analysis_config', analysis_config),
    compliance_config  = coalesce(p_payload->'compliance_config', compliance_config),
    config             = coalesce(p_payload->'config', config),
    status = 'published', published_at = now(), updated_at = now()
  where id = p_agent_id
  returning * into v_row;

  perform public.validate_agent_config(v_row);

  select coalesce(max(version), 0) + 1 into v_next
  from public.agent_versions where agent_id = p_agent_id;

  insert into public.agent_versions (org_id, agent_id, version, snapshot, published_by)
  values (v_org_id, p_agent_id, v_next, to_jsonb(v_row), auth.uid());

  return jsonb_build_object('agent', to_jsonb(v_row), 'version', v_next);
end;
$function$

;

commit;
