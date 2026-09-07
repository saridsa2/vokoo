-- Tenant-scoped hybrid retrieval and zero-downtime embedding-profile switches.

create or replace function public.search_document_chunks(
  p_org_id uuid,
  p_query text,
  p_query_embedding extensions.vector(768),
  p_limit integer default 10,
  p_document_ids uuid[] default null,
  p_historical jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile text;
  v_unavailable integer := 0;
  v_results jsonb;
begin
  if not (
    public.is_org_member(p_org_id)
    or public.is_platform_admin()
    or public.caller_is_service_role()
  ) then
    raise exception 'organization access denied' using errcode = '42501';
  end if;
  if btrim(coalesce(p_query, '')) = '' then
    raise exception 'search query is required' using errcode = 'P0004';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'search limit must be between 1 and 50' using errcode = 'P0004';
  end if;
  if p_document_ids is not null and p_historical is not null then
    raise exception 'current and historical filters cannot be combined' using errcode = 'P0004';
  end if;
  if p_historical is not null and (
    jsonb_typeof(p_historical) <> 'array' or jsonb_array_length(p_historical) = 0
  ) then
    raise exception 'historical search requires document and version pairs' using errcode = 'P0004';
  end if;
  if p_historical is not null and exists (
    select 1 from jsonb_array_elements(p_historical) item
     where jsonb_typeof(item) <> 'object'
        or not (item ? 'document_id' and item ? 'version')
        or coalesce((item ->> 'version')::integer, 0) < 1
  ) then
    raise exception 'historical filters are invalid' using errcode = 'P0004';
  end if;

  select embedding_profile_id into v_profile
    from public.organizations where id = p_org_id;

  if p_historical is null then
    select count(*) into v_unavailable
      from public.files f
      join public.file_versions v
        on v.file_id = f.id and v.org_id = f.org_id and v.version = f.current_version
     where f.org_id = p_org_id
       and (p_document_ids is null or f.id = any(p_document_ids))
       and not (
         v.status = 'indexed'
         and v.active_embedding_profile = v_profile
         and v.active_chunker_version is not null
         and exists (
           select 1
             from public.document_chunks c
             join public.document_chunk_embeddings e
               on e.chunk_id = c.id and e.org_id = c.org_id
              and e.embedding_profile_id = v_profile
            where c.file_version_id = v.id
              and c.chunker_version = v.active_chunker_version
         )
       );
  end if;

  with historical_pairs as (
    select
      (item ->> 'document_id')::uuid as document_id,
      (item ->> 'version')::integer as version
    from jsonb_array_elements(coalesce(p_historical, '[]'::jsonb)) item
    where item ? 'document_id' and item ? 'version'
  ),
  eligible as materialized (
    select c.*, v.version, f.name
      from public.document_chunks c
      join public.file_versions v
        on v.id = c.file_version_id and v.org_id = c.org_id
      join public.files f
        on f.id = c.file_id and f.org_id = c.org_id
      join public.document_chunk_embeddings e
        on e.chunk_id = c.id and e.org_id = c.org_id
       and e.embedding_profile_id = v_profile
     where p_historical is null
       and c.org_id = p_org_id
       and f.current_version = v.version
       and (p_document_ids is null or f.id = any(p_document_ids))
       and v.status = 'indexed'
       and v.active_embedding_profile = v_profile
       and c.chunker_version = v.active_chunker_version
    union all
    select c.*, v.version, f.name
      from historical_pairs h
      join public.files f
        on f.id = h.document_id and f.org_id = p_org_id
      join public.file_versions v
        on v.file_id = f.id and v.org_id = f.org_id and v.version = h.version
      join public.document_chunks c
        on c.file_version_id = v.id and c.org_id = v.org_id
      join public.document_chunk_embeddings e
        on e.chunk_id = c.id and e.org_id = c.org_id
       and e.embedding_profile_id = v_profile
     where p_historical is not null
       and v.status = 'indexed'
       and v.active_embedding_profile = v_profile
       and c.chunker_version = v.active_chunker_version
  ),
  semantic_candidates as (
    select id, 1 - (embedding <=> p_query_embedding) as semantic_score
      from (
        select q.id, e.embedding
          from eligible q
          join public.document_chunk_embeddings e
            on e.chunk_id = q.id and e.org_id = q.org_id
           and e.embedding_profile_id = v_profile
         order by e.embedding <=> p_query_embedding, q.id
         limit least(200, p_limit * 8)
      ) ranked
  ),
  semantic as (
    select id, semantic_score,
           row_number() over (order by semantic_score desc, id) as semantic_rank
      from semantic_candidates
  ),
  lexical_candidates as (
    select id, ts_rank_cd(search_vector, websearch_to_tsquery('simple', p_query)) as lexical_score
      from eligible
     where search_vector @@ websearch_to_tsquery('simple', p_query)
     order by lexical_score desc, id
     limit least(200, p_limit * 8)
  ),
  lexical as (
    select id, lexical_score,
           row_number() over (order by lexical_score desc, id) as lexical_rank
      from lexical_candidates
  ),
  fused as (
    select coalesce(s.id, l.id) as id,
           s.semantic_score,
           l.lexical_score,
           coalesce(1.0 / (60 + s.semantic_rank), 0) +
           coalesce(1.0 / (60 + l.lexical_rank), 0) as fused_score
      from semantic s full outer join lexical l on l.id = s.id
  ),
  selected as (
    select q.*, f.semantic_score, f.lexical_score, f.fused_score
      from fused f join eligible q on q.id = f.id
     order by f.fused_score desc, q.file_id, q.version, q.ordinal, q.id
     limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chunk_id', id,
           'document_id', file_id,
           'document_name', name,
           'version_id', file_version_id,
           'version', version,
           'ordinal', ordinal,
           'page_start', page_start,
           'page_end', page_end,
           'section_path', section_path,
           'text', content,
           'semantic_score', semantic_score,
           'lexical_score', lexical_score,
           'fused_score', fused_score
         ) order by fused_score desc, file_id, version, ordinal, id), '[]'::jsonb)
    into v_results from selected;

  return jsonb_build_object(
    'results', v_results,
    'unavailable_current_documents', v_unavailable,
    'embedding_profile_id', v_profile
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'historical filters are invalid' using errcode = 'P0004';
end;
$$;

revoke all on function public.search_document_chunks(uuid,text,extensions.vector,integer,uuid[],jsonb)
  from public, anon;
grant execute on function public.search_document_chunks(uuid,text,extensions.vector,integer,uuid[],jsonb)
  to authenticated, service_role;

create or replace function public.embedding_profile_choices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator access required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'provider_id', provider_id,
      'provider_model_id', provider_model_id,
      'dimensions', dimensions,
      'distance_metric', distance_metric
    ) order by id)
    from public.embedding_profiles where is_active
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.embedding_profile_choices() from public, anon;
grant execute on function public.embedding_profile_choices() to authenticated;

create or replace function public.begin_embedding_profile_migration(
  p_org_id uuid,
  p_profile_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.embedding_profiles
     where id = p_profile_id and is_active
  ) then
    raise exception 'embedding profile is not active' using errcode = 'P0004';
  end if;

  select * into v_org from public.organizations where id = p_org_id for update;
  if v_org.id is null then
    raise exception 'organization not found' using errcode = 'P0004';
  end if;
  if v_org.embedding_profile_id = p_profile_id then
    raise exception 'embedding profile is already active' using errcode = 'P0004';
  end if;

  update public.organizations
     set pending_embedding_profile_id = p_profile_id
   where id = p_org_id
   returning * into v_org;

  insert into public.document_ingestion_jobs (
    org_id, file_id, file_version_id, embedding_profile_id
  )
  select v.org_id, v.file_id, v.id, p_profile_id
    from public.file_versions v
    join public.files f on f.id = v.file_id and f.org_id = v.org_id
   where v.org_id = p_org_id and f.current_version = v.version
  on conflict (file_version_id, chunker_version, embedding_profile_id)
  do update set
    stage = 'queued', attempt_count = 0, available_at = now(),
    lease_owner = null, lease_expires_at = null,
    last_error_code = null, last_error_detail = null,
    completed_at = null, updated_at = now();

  return to_jsonb(v_org);
end;
$$;

revoke all on function public.begin_embedding_profile_migration(uuid,text) from public, anon;
grant execute on function public.begin_embedding_profile_migration(uuid,text) to authenticated;

create or replace function public.try_activate_pending_embedding_profile(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending text;
begin
  select pending_embedding_profile_id into v_pending
    from public.organizations where id = p_org_id for update;
  if v_pending is null then return false; end if;

  if exists (
    select 1
      from public.file_versions v
      join public.files f on f.id = v.file_id and f.org_id = v.org_id
     where v.org_id = p_org_id and f.current_version = v.version
       and not exists (
         select 1 from public.document_ingestion_jobs j
          where j.file_version_id = v.id
            and j.embedding_profile_id = v_pending
            and j.stage = 'ready'
            and exists (
              select 1 from public.document_chunks c
               where c.file_version_id = v.id and c.chunker_version = j.chunker_version
            )
            and not exists (
              select 1 from public.document_chunks c
               where c.file_version_id = v.id and c.chunker_version = j.chunker_version
                 and not exists (
                   select 1 from public.document_chunk_embeddings e
                    where e.chunk_id = c.id and e.org_id = c.org_id
                      and e.embedding_profile_id = v_pending
                 )
            )
       )
  ) then
    return false;
  end if;

  update public.organizations
     set embedding_profile_id = v_pending, pending_embedding_profile_id = null
   where id = p_org_id;
  update public.file_versions v
     set active_embedding_profile = v_pending,
         active_chunker_version = j.chunker_version,
         status = 'indexed', indexed_at = coalesce(v.indexed_at, now())
    from public.document_ingestion_jobs j, public.files f
   where v.org_id = p_org_id
     and f.id = v.file_id and f.org_id = v.org_id and f.current_version = v.version
     and j.file_version_id = v.id and j.embedding_profile_id = v_pending
     and j.stage = 'ready';
  update public.files f
     set status = 'indexed', intelligence = v.intelligence, updated_at = now()
    from public.file_versions v
   where f.org_id = p_org_id and v.file_id = f.id and v.org_id = f.org_id
     and f.current_version = v.version;
  return true;
end;
$$;

revoke all on function public.try_activate_pending_embedding_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.try_activate_pending_embedding_profile(uuid) to service_role;

create or replace function public.complete_document_ingestion(
  p_job_id uuid,
  p_worker text,
  p_intelligence jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.document_ingestion_jobs;
  v_chunks bigint;
  v_embeddings bigint;
  v_active text;
begin
  select * into v_job from public.document_ingestion_jobs
   where id = p_job_id and lease_owner = p_worker and lease_expires_at > now()
   for update;
  if v_job.id is null then
    raise exception 'job is not leased by this worker' using errcode = 'P0004';
  end if;

  select count(*) into v_chunks from public.document_chunks
   where file_version_id = v_job.file_version_id
     and chunker_version = v_job.chunker_version;
  select count(*) into v_embeddings
    from public.document_chunk_embeddings e
    join public.document_chunks c on c.id = e.chunk_id and c.org_id = e.org_id
   where c.file_version_id = v_job.file_version_id
     and c.chunker_version = v_job.chunker_version
     and e.embedding_profile_id = v_job.embedding_profile_id;
  if v_chunks = 0 or v_chunks <> v_embeddings then
    raise exception 'every document chunk must be embedded before completion' using errcode = 'P0004';
  end if;

  update public.document_ingestion_jobs
     set stage = 'ready', lease_owner = null, lease_expires_at = null,
         last_error_code = null, last_error_detail = null,
         completed_at = now(), updated_at = now()
   where id = v_job.id returning * into v_job;

  select embedding_profile_id into v_active
    from public.organizations where id = v_job.org_id;
  update public.file_versions
     set intelligence = coalesce(p_intelligence, intelligence),
         status = case when v_job.embedding_profile_id = v_active then 'indexed' else status end,
         active_chunker_version = case when v_job.embedding_profile_id = v_active
                                       then v_job.chunker_version else active_chunker_version end,
         active_embedding_profile = case when v_job.embedding_profile_id = v_active
                                         then v_job.embedding_profile_id else active_embedding_profile end,
         indexed_at = case when v_job.embedding_profile_id = v_active then now() else indexed_at end,
         processing_error = case when v_job.embedding_profile_id = v_active then null else processing_error end
   where id = v_job.file_version_id;

  if v_job.embedding_profile_id = v_active then
    update public.files f
       set status = 'indexed', intelligence = coalesce(p_intelligence, f.intelligence), updated_at = now()
      from public.file_versions v
     where v.id = v_job.file_version_id
       and f.id = v.file_id and f.org_id = v.org_id
       and f.current_version = v.version;
  end if;

  perform public.try_activate_pending_embedding_profile(v_job.org_id);
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.complete_document_ingestion(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_document_ingestion(uuid,text,jsonb) to service_role;

notify pgrst, 'reload schema';
