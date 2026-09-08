\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org uuid := '10000000-0000-0000-0000-000000000126';
  v_other_org uuid := '20000000-0000-0000-0000-000000000126';
  v_user uuid := '30000000-0000-0000-0000-000000000126';
  v_file uuid := '40000000-0000-0000-0000-000000000126';
  v_other_file uuid := '50000000-0000-0000-0000-000000000126';
  v_version uuid := '60000000-0000-0000-0000-000000000126';
  v_job jsonb;
  v_extraction uuid;
  v_chunk uuid;
  v_layout jsonb;
  v_artifact jsonb;
begin
  insert into public.organizations (id, name, slug) values
    (v_org, 'Layout reader', 'layout-reader-0126'),
    (v_other_org, 'Other layout reader', 'other-layout-reader-0126');
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user, 'authenticated', 'authenticated', 'layout-reader-0126@example.test', now(),
    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_org, v_user, 'owner', 'Layout reader');
  insert into public.files (id, org_id, name, object_path, mime_type, size_bytes, status)
  values (v_file, v_org, 'guideline.pdf', 'database:layout-reader', 'application/pdf', 3, 'processing');
  insert into public.file_versions (
    id, org_id, file_id, version, mime_type, size_bytes, sha256, content
  ) values (
    v_version, v_org, v_file, 1, 'application/pdf', 3,
    encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8')
  );

  v_layout := public.get_document_layout(v_org, v_file, 1);
  if v_layout ->> 'status' <> 'processing'
     or jsonb_array_length(v_layout -> 'items') <> 0 then
    raise exception 'a version without active layout did not report processing';
  end if;

  v_job := public.claim_document_ingestion('layout-reader-worker', 300);
  if v_job ->> 'file_version_id' <> v_version::text then
    raise exception 'the layout reader test claimed the wrong job';
  end if;
  v_artifact := jsonb_build_object(
    'schema_version', 'layout-v1',
    'provider', 'docling-rs',
    'provider_version', '1.37.0',
    'source_sha256', encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'),
    'warnings', '[]'::jsonb,
    'raw_artifact', '{"schema_name":"DoclingDocument"}'::jsonb,
    'pages', '[{"page_number":1,"width_points":612,"height_points":792}]'::jsonb,
    'items', '[{"provider_ref":"#/texts/0","parent_ref":"#/body","ordinal":0,"label":"text","content_layer":"body","text":"Review HbA1c","section_path":["Monitoring"],"spans":[{"page_number":1,"bbox":{"left":72,"top":700,"right":300,"bottom":680,"origin":"BOTTOMLEFT"},"char_start":0,"char_end":12}],"metadata":null}]'::jsonb
  );
  v_extraction := public.store_document_extraction(
    (v_job ->> 'id')::uuid, 'layout-reader-worker', v_artifact
  );
  perform public.advance_document_ingestion(
    (v_job ->> 'id')::uuid, 'layout-reader-worker', 'chunking'
  );
  insert into public.document_chunks (
    org_id, file_id, file_version_id, chunker_version, ordinal,
    page_start, page_end, section_path, content, token_count, content_sha256
  ) values (
    v_org, v_file, v_version, v_job ->> 'chunker_version', 0,
    1, 1, array['Monitoring'], 'Review HbA1c', 2,
    encode(digest(convert_to('Review HbA1c', 'utf8'), 'sha256'), 'hex')
  ) returning id into v_chunk;
  perform public.link_document_chunk_layout(
    (v_job ->> 'id')::uuid,
    'layout-reader-worker',
    v_extraction,
    jsonb_build_array(jsonb_build_object(
      'chunk_ordinal', 0,
      'provider_refs', jsonb_build_array('#/texts/0')
    ))
  );

  v_layout := public.get_document_layout(v_org, v_file, 1);
  if v_layout ->> 'status' <> 'ready'
     or v_layout ->> 'schema_version' <> 'layout-v1'
     or jsonb_array_length(v_layout -> 'pages') <> 1
     or jsonb_array_length(v_layout -> 'items') <> 1
     or v_layout #>> '{items,0,chunk_ids,0}' <> v_chunk::text then
    raise exception 'ready layout omitted geometry or chunk provenance';
  end if;

  insert into public.files (id, org_id, name, object_path, mime_type, size_bytes, status)
  values (v_other_file, v_other_org, 'private.pdf', 'database:private-layout', 'application/pdf', 3, 'processing');
  insert into public.file_versions (
    org_id, file_id, version, mime_type, size_bytes, sha256, content
  ) values (
    v_other_org, v_other_file, 1, 'application/pdf', 3,
    encode(digest(convert_to('pdf', 'utf8'), 'sha256'), 'hex'), convert_to('pdf', 'utf8')
  );
end;
$$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000126', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  if public.get_document_layout(
    '10000000-0000-0000-0000-000000000126',
    '40000000-0000-0000-0000-000000000126',
    1
  ) ->> 'status' <> 'ready' then
    raise exception 'a member could not read its document layout';
  end if;
  begin
    perform public.get_document_layout(
      '20000000-0000-0000-0000-000000000126',
      '50000000-0000-0000-0000-000000000126',
      1
    );
    raise exception 'a cross-tenant document layout was visible';
  exception when sqlstate 'P0002' then
    null;
  end;
end;
$$;

rollback;
