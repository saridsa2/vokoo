-- Documents are logical records; their source bytes are immutable versions.
-- Keeping the bytes out of `files.config` means listing the library never
-- downloads every source document, and a replacement cannot erase the source
-- an earlier intelligence result was based on.

alter table public.files
  add column if not exists current_version integer not null default 0,
  add column if not exists intelligence jsonb;

create unique index if not exists files_id_org_unique on public.files (id, org_id);

create table public.file_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null,
  version integer not null check (version > 0),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea not null,
  extracted_text text,
  status text not null default 'ready' check (status in ('ready','analyzing','analyzed','failed')),
  intelligence jsonb,
  created_at timestamptz not null default now(),
  unique (file_id, version),
  constraint file_versions_same_org
    foreign key (file_id, org_id) references public.files(id, org_id) on delete cascade
);

alter table public.file_versions enable row level security;
drop policy if exists org_member_access on public.file_versions;
create policy org_member_access on public.file_versions for all
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create index file_versions_org_file_idx
  on public.file_versions (org_id, file_id, version desc);

create or replace function public.advance_document_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.files
     set current_version = new.version,
         mime_type = new.mime_type,
         size_bytes = new.size_bytes,
         status = 'ready',
         intelligence = null
   where id = new.file_id and org_id = new.org_id;
  return new;
end;
$$;

drop trigger if exists advance_document_version on public.file_versions;
create trigger advance_document_version
after insert on public.file_versions
for each row execute function public.advance_document_version();

create or replace function public.create_document(
  p_org_id uuid,
  p_name text,
  p_mime_type text,
  p_content_base64 text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_file public.files;
  v_content bytea;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'organization access denied';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'document name is required';
  end if;
  if p_mime_type not in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ) then
    raise exception 'unsupported document type';
  end if;

  begin
    v_content := decode(p_content_base64, 'base64');
  exception when others then
    raise exception 'document content is not valid base64';
  end;
  if octet_length(v_content) = 0 or octet_length(v_content) > 15728640 then
    raise exception 'document must contain between 1 byte and 15 MB';
  end if;

  insert into public.files (
    org_id, name, object_path, mime_type, size_bytes, status, current_version
  ) values (
    p_org_id, btrim(p_name), 'database:pending', p_mime_type,
    octet_length(v_content), 'processing', 0
  ) returning * into v_file;

  update public.files set object_path = 'database:' || v_file.id where id = v_file.id;

  insert into public.file_versions (
    org_id, file_id, version, mime_type, size_bytes, sha256, content
  ) values (
    p_org_id, v_file.id, 1, p_mime_type, octet_length(v_content),
    encode(digest(v_content, 'sha256'), 'hex'), v_content
  );

  select * into v_file from public.files where id = v_file.id;
  return to_jsonb(v_file);
end;
$$;

revoke all on function public.create_document(uuid, text, text, text) from public, anon;
grant execute on function public.create_document(uuid, text, text, text) to authenticated;

comment on table public.file_versions is
  'Immutable source versions for workspace documents. Content is read only by the document intelligence path.';
comment on column public.files.intelligence is
  'Latest Workspace Intelligence routing result for current_version; recommendations are proposals, never executed actions.';

notify pgrst, 'reload schema';
