\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org uuid := '10000000-0000-0000-0000-000000000125';
  v_user uuid := '30000000-0000-0000-0000-000000000125';
  v_file uuid;
  v_version uuid;
  v_job jsonb;
  v_extraction uuid;
  v_chunk uuid;
  v_artifact jsonb;
begin
  insert into public.organizations (id, name, slug)
  values (v_org, 'Document layout test', 'document-layout-0125');
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user, 'authenticated', 'authenticated', 'document-layout-0125@example.test', now(),
    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_org, v_user, 'owner', 'Document layout test');
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.files (org_id, name, object_path, mime_type, size_bytes, status)
  values (v_org, 'guideline.pdf', 'database:layout-test', 'application/pdf', 3, 'processing')
  returning id into v_file;
  insert into public.file_versions (
    org_id, file_id, version, mime_type, size_bytes, sha256, content
  ) values (
    v_org, v_file, 1, 'application/pdf', 3,
    encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8')
  ) returning id into v_version;

  v_job := public.claim_document_ingestion('layout-worker', 300);
  v_artifact := jsonb_build_object(
    'schema_version', 'layout-v1',
    'provider', 'docling-rs',
    'provider_version', '1.37.0',
    'source_sha256', encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'),
    'warnings', '[]'::jsonb,
    'raw_artifact', '{"schema_name":"DoclingDocument"}'::jsonb,
    'pages', '[{"page_number":1,"width_points":612,"height_points":792}]'::jsonb,
    'items', '[
      {"provider_ref":"#/texts/0","parent_ref":"#/body","ordinal":0,"label":"text","content_layer":"body","text":"Review HbA1c","section_path":["Monitoring"],"spans":[{"page_number":1,"bbox":{"left":72,"top":700,"right":300,"bottom":680,"origin":"BOTTOMLEFT"},"char_start":0,"char_end":12}],"metadata":null},
      {"provider_ref":"#/texts/1","parent_ref":"#/furniture","ordinal":1,"label":"page_header","content_layer":"furniture","text":"NICE NG28","section_path":[],"spans":[{"page_number":1,"bbox":{"left":72,"top":780,"right":180,"bottom":765,"origin":"BOTTOMLEFT"},"char_start":0,"char_end":9}],"metadata":null}
    ]'::jsonb
  );
  v_extraction := public.store_document_extraction(
    (v_job ->> 'id')::uuid, 'layout-worker', v_artifact
  );
  if (select active_extraction_id from public.file_versions where id = v_version) <> v_extraction then
    raise exception 'complete layout did not activate atomically';
  end if;
  if (select count(*) from public.document_layout_items where extraction_id = v_extraction) <> 2
     or (select count(*) from public.document_layout_items where extraction_id = v_extraction and content_layer = 'furniture') <> 1 then
    raise exception 'body or furniture layout was lost';
  end if;
  if (select count(*) from public.document_layout_spans where extraction_id = v_extraction) <> 2 then
    raise exception 'source spans were not normalized';
  end if;

  if public.store_document_extraction((v_job ->> 'id')::uuid, 'layout-worker', v_artifact) <> v_extraction
     or (select count(*) from public.document_extractions where job_id = (v_job ->> 'id')::uuid) <> 1 then
    raise exception 'retrying the same job duplicated its extraction';
  end if;

  begin
    v_artifact := jsonb_set(v_artifact, '{source_sha256}', to_jsonb(repeat('f', 64)));
    perform public.store_document_extraction((v_job ->> 'id')::uuid, 'layout-worker', v_artifact);
    raise exception 'an extraction for different bytes was accepted';
  exception when sqlstate 'P0004' then
    null;
  end;

  begin
    update public.file_versions set content = convert_to('changed', 'utf8') where id = v_version;
    raise exception 'layout migration weakened source immutability';
  exception when sqlstate 'P0004' then
    null;
  end;

  perform public.advance_document_ingestion(
    (v_job ->> 'id')::uuid, 'layout-worker', 'chunking'
  );
  insert into public.document_chunks (
    org_id, file_id, file_version_id, chunker_version, ordinal,
    page_start, page_end, section_path, content, token_count, content_sha256
  ) values (
    v_org, v_file, v_version, v_job ->> 'chunker_version', 0,
    1, 1, array['Monitoring'], 'Review HbA1c', 2,
    encode(digest(convert_to('Review HbA1c', 'utf8'), 'sha256'), 'hex')
  ) returning id into v_chunk;
  if public.link_document_chunk_layout(
    (v_job ->> 'id')::uuid,
    'layout-worker',
    v_extraction,
    jsonb_build_array(jsonb_build_object(
      'chunk_ordinal', 0,
      'provider_refs', jsonb_build_array('#/texts/0')
    ))
  ) <> 1 then
    raise exception 'chunk provenance was not linked';
  end if;
  if not exists (
    select 1 from public.document_chunk_layout_items l
    join public.document_layout_items i on i.id = l.layout_item_id
    where l.chunk_id = v_chunk and i.provider_ref = '#/texts/0'
  ) then
    raise exception 'chunk provenance points at the wrong layout item';
  end if;
end;
$$;

rollback;
