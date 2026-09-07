\set ON_ERROR_STOP on

begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception 'vector extension is missing';
  end if;
  if to_regclass('public.embedding_profiles') is null
     or to_regclass('public.document_chunks') is null
     or to_regclass('public.document_chunk_embeddings') is null
     or to_regclass('public.document_ingestion_jobs') is null then
    raise exception 'document indexing tables are missing';
  end if;
end;
$$;

do $$
declare
  v_org uuid := '10000000-0000-0000-0000-000000000123';
  v_other_org uuid := '20000000-0000-0000-0000-000000000123';
  v_user uuid := '30000000-0000-0000-0000-000000000123';
  v_file uuid;
  v_version uuid;
  v_second jsonb;
  v_job jsonb;
  v_claim jsonb;
  v_chunk uuid;
begin
  insert into public.organizations (id, name, slug)
  values
    (v_org, 'Document indexing test', 'document-indexing-0123'),
    (v_other_org, 'Other indexing test', 'other-document-indexing-0123');

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user, 'authenticated', 'authenticated', 'document-indexing-0123@example.test', now(),
    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_org, v_user, 'owner', 'Document indexing test');
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.files (org_id, name, object_path, mime_type, size_bytes, status)
  values (v_org, 'guideline.txt', 'database:pending', 'text/plain', 12, 'processing')
  returning id into v_file;

  insert into public.file_versions
    (org_id, file_id, version, mime_type, size_bytes, sha256, content)
  values
    (v_org, v_file, 1, 'text/plain', 12, repeat('a', 64), convert_to('version one', 'utf8'))
  returning id into v_version;

  if (select count(*) from public.document_ingestion_jobs where file_version_id = v_version) <> 1 then
    raise exception 'a new source version did not enqueue exactly one indexing job';
  end if;

  v_second := public.create_document_version(
    v_org, v_file, 'text/plain', encode(convert_to('version two', 'utf8'), 'base64')
  );
  if (v_second ->> 'version')::integer <> 2
     or (select current_version from public.files where id = v_file) <> 2 then
    raise exception 'appending a source did not allocate and select version two';
  end if;

  begin
    insert into public.document_chunks (
      org_id, file_id, file_version_id, chunker_version, ordinal,
      page_start, page_end, section_path, content, token_count, content_sha256
    ) values (
      v_other_org, v_file, v_version, 'clinical-structure-v1', 0,
      1, 1, array['Scope'], 'wrong tenant', 2, repeat('b', 64)
    );
    raise exception 'a chunk accepted cross-organization references';
  exception when foreign_key_violation then
    null;
  end;

  v_job := public.enqueue_document_ingestion(v_version, 'gemini-embedding-2-768');
  if (select count(*) from public.document_ingestion_jobs where file_version_id = v_version) <> 1 then
    raise exception 'idempotent enqueue duplicated an indexing job';
  end if;

  v_claim := public.claim_document_ingestion('worker-a', 300);
  if v_claim is null or v_claim ->> 'lease_owner' <> 'worker-a' then
    raise exception 'a worker could not claim queued work';
  end if;

  if public.claim_document_ingestion('worker-b', 300) ->> 'id' = v_claim ->> 'id' then
    raise exception 'two workers claimed the same lease';
  end if;

  update public.document_ingestion_jobs
     set lease_expires_at = now() - interval '1 second'
   where id = (v_claim ->> 'id')::uuid;
  update public.document_ingestion_jobs
     set available_at = now() + interval '1 hour'
   where id <> (v_claim ->> 'id')::uuid;
  v_claim := public.claim_document_ingestion('worker-b', 300);
  if v_claim ->> 'lease_owner' <> 'worker-b' then
    raise exception 'an expired lease was not reclaimable';
  end if;

  begin
    perform public.complete_document_ingestion(
      (v_claim ->> 'id')::uuid, 'worker-b', '{"summary":"too early"}'::jsonb
    );
    raise exception 'an incomplete job became searchable';
  exception when sqlstate 'P0004' then
    null;
  end;

  insert into public.document_chunks (
    org_id, file_id, file_version_id, chunker_version, ordinal,
    page_start, page_end, section_path, content, token_count, content_sha256
  ) values (
    v_org, v_file, v_version, 'clinical-structure-v1', 0,
    1, 1, array['Scope'], 'Escalate after fourteen days.', 5, repeat('c', 64)
  ) returning id into v_chunk;

  insert into public.document_chunk_embeddings
    (org_id, chunk_id, embedding_profile_id, embedding)
  values
    (v_org, v_chunk, 'gemini-embedding-2-768', array_fill(0.01::real, array[768])::extensions.vector);

  perform public.complete_document_ingestion(
    (v_claim ->> 'id')::uuid, 'worker-b', '{"summary":"version one"}'::jsonb
  );

  if (select status from public.file_versions where id = v_version) <> 'indexed' then
    raise exception 'a complete job did not activate the version index';
  end if;
  if (select intelligence from public.files where id = v_file) is not null then
    raise exception 'stale version intelligence overwrote the current document projection';
  end if;

  update public.document_ingestion_jobs
     set stage = 'permanent_failed', attempt_count = max_attempts,
         last_error_code = 'bad_source', last_error_detail = 'expected test failure',
         completed_at = now()
   where id = (v_claim ->> 'id')::uuid;
  v_job := public.enqueue_document_ingestion(v_version, 'gemini-embedding-2-768');
  if v_job ->> 'stage' <> 'queued'
     or (v_job ->> 'attempt_count')::integer <> 0
     or v_job -> 'last_error_code' <> 'null'::jsonb then
    raise exception 'an explicit retry did not reset failed work';
  end if;
end;
$$;

rollback;
