\set ON_ERROR_STOP on

begin;

do $$
declare
  v_org uuid := '10000000-0000-0000-0000-000000000121';
  v_file uuid;
  v_first uuid;
  v_second uuid;
begin
  insert into public.organizations (id, name, slug)
  values (v_org, 'Document workspace test', 'document-workspace-0121');
  insert into public.organizations (id, name, slug)
  values ('20000000-0000-0000-0000-000000000121', 'Other workspace', 'other-document-workspace-0121');

  insert into public.files (org_id, name, object_path, mime_type, size_bytes, status)
  values (v_org, 'NG194.pdf', 'database:pending', 'application/pdf', 4, 'processing')
  returning id into v_file;

  insert into public.file_versions (org_id, file_id, version, mime_type, size_bytes, sha256, content)
  values (v_org, v_file, 1, 'application/pdf', 4, repeat('a', 64), decode('JVBERg==', 'base64'))
  returning id into v_first;

  insert into public.file_versions (org_id, file_id, version, mime_type, size_bytes, sha256, content)
  values (v_org, v_file, 2, 'application/pdf', 4, repeat('b', 64), decode('JVBERg==', 'base64'))
  returning id into v_second;

  if v_first = v_second or (select count(*) from public.file_versions where file_id = v_file) <> 2 then
    raise exception 'uploading a revision did not preserve the first source version';
  end if;

  if (select current_version from public.files where id = v_file) <> 2 then
    raise exception 'the document does not point at its newest source version';
  end if;

  begin
    insert into public.file_versions (org_id, file_id, version, mime_type, size_bytes, sha256, content)
    values ('20000000-0000-0000-0000-000000000121', v_file, 3, 'application/pdf', 4, repeat('c', 64), decode('JVBERg==', 'base64'));
    raise exception 'a source version accepted a different organisation';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

rollback;
