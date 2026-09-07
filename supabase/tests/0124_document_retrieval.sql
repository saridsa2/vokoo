\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org uuid := '10000000-0000-0000-0000-000000000124';
  v_other_org uuid := '20000000-0000-0000-0000-000000000124';
  v_user uuid := '30000000-0000-0000-0000-000000000124';
  v_file uuid;
  v_incomplete_file uuid;
  v_other_file uuid;
  v_v1 uuid;
  v_v2 uuid;
  v_incomplete_version uuid;
  v_other_version uuid;
  v_v1_chunk uuid;
  v_current_semantic uuid;
  v_current_lexical uuid;
  v_incomplete_chunk uuid;
  v_query real[] := array_fill(0.0::real, array[768]);
  v_far real[] := array_fill(0.0::real, array[768]);
  v_result jsonb;
  v_repeat jsonb;
  v_historical jsonb;
begin
  v_query[1] := 1.0;
  v_far[2] := 1.0;

  insert into public.organizations (id, name, slug)
  values
    (v_org, 'Document retrieval test', 'document-retrieval-0124'),
    (v_other_org, 'Other retrieval test', 'other-document-retrieval-0124');
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user, 'authenticated', 'authenticated', 'document-retrieval-0124@example.test', now(),
    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_org, v_user, 'owner', 'Document retrieval test');
  insert into public.platform_admins (user_id, note)
  values (v_user, 'migration 0124 test');
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.files (org_id, name, object_path, mime_type, size_bytes, status)
  values (v_org, 'guideline.txt', 'database:retrieval-main', 'text/plain', 20, 'processing')
  returning id into v_file;
  insert into public.file_versions
    (org_id, file_id, version, mime_type, size_bytes, sha256, content)
  values
    (v_org, v_file, 1, 'text/plain', 20, repeat('1', 64), convert_to('old threshold', 'utf8'))
  returning id into v_v1;
  insert into public.file_versions
    (org_id, file_id, version, mime_type, size_bytes, sha256, content)
  values
    (v_org, v_file, 2, 'text/plain', 20, repeat('2', 64), convert_to('new threshold', 'utf8'))
  returning id into v_v2;

  insert into public.files (org_id, name, object_path, mime_type, size_bytes, status)
  values (v_org, 'not-ready.txt', 'database:retrieval-incomplete', 'text/plain', 20, 'processing')
  returning id into v_incomplete_file;
  insert into public.file_versions
    (org_id, file_id, version, mime_type, size_bytes, sha256, content)
  values
    (v_org, v_incomplete_file, 1, 'text/plain', 20, repeat('3', 64), convert_to('not ready', 'utf8'))
  returning id into v_incomplete_version;

  insert into public.files (org_id, name, object_path, mime_type, size_bytes, status)
  values (v_other_org, 'other.txt', 'database:retrieval-other', 'text/plain', 20, 'processing')
  returning id into v_other_file;
  insert into public.file_versions
    (org_id, file_id, version, mime_type, size_bytes, sha256, content)
  values
    (v_other_org, v_other_file, 1, 'text/plain', 20, repeat('4', 64), convert_to('other tenant', 'utf8'))
  returning id into v_other_version;

  update public.file_versions
     set status = 'indexed', active_chunker_version = 'clinical-structure-v1',
         active_embedding_profile = 'gemini-embedding-2-768', indexed_at = now()
   where id in (v_v1, v_v2, v_other_version);

  insert into public.document_chunks (
    org_id, file_id, file_version_id, chunker_version, ordinal,
    page_start, page_end, section_path, content, token_count, content_sha256
  ) values (
    v_org, v_file, v_v1, 'clinical-structure-v1', 0,
    1, 1, array['Old'], 'Use the retired HbA1c threshold of 48.', 8, repeat('a', 64)
  ) returning id into v_v1_chunk;
  insert into public.document_chunks (
    org_id, file_id, file_version_id, chunker_version, ordinal,
    page_start, page_end, section_path, content, token_count, content_sha256
  ) values (
    v_org, v_file, v_v2, 'clinical-structure-v1', 0,
    2, 2, array['Current'], 'Current escalation guidance for diabetes review.', 6, repeat('b', 64)
  ) returning id into v_current_semantic;
  insert into public.document_chunks (
    org_id, file_id, file_version_id, chunker_version, ordinal,
    page_start, page_end, section_path, content, token_count, content_sha256
  ) values (
    v_org, v_file, v_v2, 'clinical-structure-v1', 1,
    3, 3, array['Threshold'], 'Escalate when HbA1c is above 58 mmol/mol.', 8, repeat('c', 64)
  ) returning id into v_current_lexical;

  insert into public.document_chunk_embeddings
    (org_id, chunk_id, embedding_profile_id, embedding)
  values
    (v_org, v_v1_chunk, 'gemini-embedding-2-768', v_query::extensions.vector),
    (v_org, v_current_semantic, 'gemini-embedding-2-768', v_query::extensions.vector),
    (v_org, v_current_lexical, 'gemini-embedding-2-768', v_far::extensions.vector);

  v_result := public.search_document_chunks(
    v_org, 'HbA1c 58', v_query::extensions.vector, 10, null, null
  );
  if exists (
    select 1 from jsonb_array_elements(v_result -> 'results') item
     where (item ->> 'version')::integer <> 2
  ) then
    raise exception 'current retrieval returned a stale source version';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_result -> 'results') item
     where item ->> 'text' like '%HbA1c%58%'
  ) then
    raise exception 'hybrid retrieval lost an exact clinical identifier';
  end if;
  if (v_result ->> 'unavailable_current_documents')::integer <> 1 then
    raise exception 'current retrieval did not report the incomplete document';
  end if;
  v_repeat := public.search_document_chunks(
    v_org, 'HbA1c 58', v_query::extensions.vector, 10, null, null
  );
  if v_repeat -> 'results' <> v_result -> 'results' then
    raise exception 'reciprocal-rank fusion ordering is not deterministic';
  end if;

  v_historical := public.search_document_chunks(
    v_org, 'HbA1c', v_query::extensions.vector, 10, null,
    jsonb_build_array(jsonb_build_object('document_id', v_file, 'version', 1))
  );
  if jsonb_array_length(v_historical -> 'results') <> 1
     or (v_historical -> 'results' -> 0 ->> 'version')::integer <> 1 then
    raise exception 'explicit historical retrieval did not stay on version one';
  end if;

  v_result := public.search_document_chunks(
    v_org, 'other tenant', v_query::extensions.vector, 10, array[v_other_file], null
  );
  if jsonb_array_length(v_result -> 'results') <> 0 then
    raise exception 'a cross-tenant document id returned chunks';
  end if;

  v_result := public.search_document_chunks(
    v_org, 'not ready', v_query::extensions.vector, 10, array[v_incomplete_file], null
  );
  if jsonb_array_length(v_result -> 'results') <> 0
     or (v_result ->> 'unavailable_current_documents')::integer <> 1 then
    raise exception 'an incomplete current index silently fell back or looked available';
  end if;

  begin
    perform public.search_document_chunks(
      v_org, 'conflict', v_query::extensions.vector, 10, array[v_file],
      jsonb_build_array(jsonb_build_object('document_id', v_file, 'version', 1))
    );
    raise exception 'mixed current and historical filters were accepted';
  exception when sqlstate 'P0004' then
    null;
  end;

  insert into public.embedding_profiles (
    id, provider_id, provider_model_id, dimensions, distance_metric,
    document_prefix, query_prefix, is_active
  ) values (
    'gemini-next-768', 'gemini', 'gemini-embedding-2', 768, 'cosine',
    'title: none | text: {content}', 'task: search result | query: {content}', true
  );
  if not (public.embedding_profile_choices() @> '[{"id":"gemini-next-768"}]'::jsonb) then
    raise exception 'active embedding profile was not offered to the operator';
  end if;
  perform public.begin_embedding_profile_migration(v_org, 'gemini-next-768');
  if (select pending_embedding_profile_id from public.organizations where id = v_org)
     <> 'gemini-next-768' then
    raise exception 'profile migration did not enter the pending state';
  end if;
  if (select count(*) from public.document_ingestion_jobs
       where org_id = v_org and embedding_profile_id = 'gemini-next-768') <> 2 then
    raise exception 'profile migration did not enqueue every current version';
  end if;
  if public.try_activate_pending_embedding_profile(v_org) then
    raise exception 'profile activated before every pending job completed';
  end if;

  insert into public.document_chunks (
    org_id, file_id, file_version_id, chunker_version, ordinal,
    page_start, page_end, section_path, content, token_count, content_sha256
  ) values (
    v_org, v_incomplete_file, v_incomplete_version, 'clinical-structure-v1', 0,
    1, 1, array['Ready'], 'Now ready for migration.', 4, repeat('d', 64)
  ) returning id into v_incomplete_chunk;
  insert into public.document_chunk_embeddings
    (org_id, chunk_id, embedding_profile_id, embedding)
  values
    (v_org, v_current_semantic, 'gemini-next-768', v_query::extensions.vector),
    (v_org, v_current_lexical, 'gemini-next-768', v_far::extensions.vector),
    (v_org, v_incomplete_chunk, 'gemini-next-768', v_query::extensions.vector);
  update public.document_ingestion_jobs
     set stage = 'ready', completed_at = now()
   where org_id = v_org and embedding_profile_id = 'gemini-next-768';

  if not public.try_activate_pending_embedding_profile(v_org) then
    raise exception 'complete pending indexes did not activate atomically';
  end if;
  if (select embedding_profile_id from public.organizations where id = v_org)
     <> 'gemini-next-768'
     or (select pending_embedding_profile_id from public.organizations where id = v_org) is not null then
    raise exception 'profile activation did not clear the pending switch';
  end if;
end;
$$;

rollback;
