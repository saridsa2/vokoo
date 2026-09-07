-- Durable, version-scoped document indexing.
-- Source rows remain immutable; chunks and embeddings are derived records that
-- can be regenerated without rewriting the document they came from.

create extension if not exists vector with schema extensions;

create table public.embedding_profiles (
  id text primary key,
  provider_id text not null references public.catalogue_providers(id),
  provider_model_id text not null,
  dimensions integer not null check (dimensions = 768),
  distance_metric text not null check (distance_metric = 'cosine'),
  document_prefix text not null,
  query_prefix text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.embedding_profiles enable row level security;
create policy embedding_profiles_read on public.embedding_profiles for select
  using (auth.uid() is not null or public.is_platform_admin());
grant select on public.embedding_profiles to authenticated;

insert into public.embedding_profiles (
  id, provider_id, provider_model_id, dimensions, distance_metric,
  document_prefix, query_prefix, is_active
) values (
  'gemini-embedding-2-768', 'gemini', 'gemini-embedding-2', 768, 'cosine',
  'title: none | text: {content}', 'task: search result | query: {content}', true
);

alter table public.organizations
  add column embedding_profile_id text not null
    default 'gemini-embedding-2-768' references public.embedding_profiles(id),
  add column pending_embedding_profile_id text
    references public.embedding_profiles(id);

alter table public.file_versions
  add column active_chunker_version text,
  add column active_embedding_profile text references public.embedding_profiles(id),
  add column indexed_at timestamptz,
  add column processing_error jsonb;

alter table public.file_versions drop constraint if exists file_versions_status_check;
alter table public.file_versions add constraint file_versions_status_check
  check (status in (
    'ready', 'queued', 'extracting', 'chunking', 'embedding',
    'classifying', 'indexed', 'analyzed', 'failed'
  ));

create unique index file_versions_id_org_unique
  on public.file_versions (id, org_id);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null,
  file_version_id uuid not null,
  chunker_version text not null,
  ordinal integer not null check (ordinal >= 0),
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end >= page_start),
  section_path text[] not null default '{}',
  content text not null check (btrim(content) <> ''),
  token_count integer not null check (token_count > 0 and token_count <= 1200),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  search_vector tsvector generated always as
    (to_tsvector('simple'::regconfig, content)) stored,
  created_at timestamptz not null default now(),
  unique (file_version_id, chunker_version, ordinal),
  unique (id, org_id),
  constraint document_chunks_file_same_org
    foreign key (file_id, org_id) references public.files(id, org_id) on delete cascade,
  constraint document_chunks_version_same_org
    foreign key (file_version_id, org_id) references public.file_versions(id, org_id) on delete cascade
);

create index document_chunks_org_version_idx
  on public.document_chunks (org_id, file_version_id, chunker_version, ordinal);
create index document_chunks_search_idx
  on public.document_chunks using gin (search_vector);

alter table public.document_chunks enable row level security;
create policy document_chunks_read on public.document_chunks for select
  using (public.is_org_member(org_id));

create table public.document_chunk_embeddings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  chunk_id uuid not null,
  embedding_profile_id text not null references public.embedding_profiles(id),
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  unique (chunk_id, embedding_profile_id),
  constraint document_embeddings_chunk_same_org
    foreign key (chunk_id, org_id) references public.document_chunks(id, org_id) on delete cascade
);

create index document_chunk_embeddings_hnsw_idx
  on public.document_chunk_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.document_chunk_embeddings enable row level security;

create table public.document_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null,
  file_version_id uuid not null,
  chunker_version text not null default 'clinical-structure-v1',
  embedding_profile_id text not null references public.embedding_profiles(id),
  stage text not null default 'queued' check (stage in (
    'queued', 'extracting', 'chunking', 'embedding', 'classifying',
    'ready', 'retryable_failed', 'permanent_failed'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (file_version_id, chunker_version, embedding_profile_id),
  constraint document_jobs_file_same_org
    foreign key (file_id, org_id) references public.files(id, org_id) on delete cascade,
  constraint document_jobs_version_same_org
    foreign key (file_version_id, org_id) references public.file_versions(id, org_id) on delete cascade
);

create index document_ingestion_jobs_claim_idx
  on public.document_ingestion_jobs (available_at, created_at)
  where stage in (
    'queued', 'extracting', 'chunking', 'embedding', 'classifying', 'retryable_failed'
  );

alter table public.document_ingestion_jobs enable row level security;
create policy document_ingestion_jobs_read on public.document_ingestion_jobs for select
  using (public.is_org_member(org_id));
grant select on public.document_ingestion_jobs to authenticated;

create or replace function public.protect_document_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if row(old.org_id, old.file_id, old.version, old.mime_type, old.size_bytes, old.sha256, old.content)
     is distinct from
     row(new.org_id, new.file_id, new.version, new.mime_type, new.size_bytes, new.sha256, new.content)
  then
    raise exception 'document source versions are immutable' using errcode = 'P0004';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_document_source on public.file_versions;
create trigger protect_document_source
before update on public.file_versions
for each row execute function public.protect_document_source();

create or replace function public.queue_document_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active text;
  v_pending text;
begin
  select embedding_profile_id, pending_embedding_profile_id
    into v_active, v_pending
    from public.organizations where id = new.org_id;

  insert into public.document_ingestion_jobs (
    org_id, file_id, file_version_id, embedding_profile_id
  ) values (
    new.org_id, new.file_id, new.id, v_active
  ) on conflict (file_version_id, chunker_version, embedding_profile_id) do nothing;

  if v_pending is not null and v_pending <> v_active then
    insert into public.document_ingestion_jobs (
      org_id, file_id, file_version_id, embedding_profile_id
    ) values (
      new.org_id, new.file_id, new.id, v_pending
    ) on conflict (file_version_id, chunker_version, embedding_profile_id) do nothing;
  end if;

  update public.file_versions
     set status = 'queued', processing_error = null
   where id = new.id;
  update public.files
     set status = 'queued', intelligence = null, updated_at = now()
   where id = new.file_id and org_id = new.org_id;
  return new;
end;
$$;

drop trigger if exists queue_document_version on public.file_versions;
create trigger queue_document_version
after insert on public.file_versions
for each row execute function public.queue_document_version();

create or replace function public.enqueue_document_ingestion(
  p_file_version_id uuid,
  p_embedding_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.file_versions;
  v_profile text;
  v_job public.document_ingestion_jobs;
begin
  select * into v_version from public.file_versions where id = p_file_version_id;
  if v_version.id is null then
    raise exception 'document version not found' using errcode = 'P0004';
  end if;
  if not (
    public.is_org_member(v_version.org_id)
    or public.is_platform_admin()
    or current_user in ('postgres', 'service_role')
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  ) then
    raise exception 'document version not found' using errcode = '42501';
  end if;

  select coalesce(p_embedding_profile_id, o.embedding_profile_id)
    into v_profile from public.organizations o where o.id = v_version.org_id;
  if not exists (select 1 from public.embedding_profiles where id = v_profile and is_active) then
    raise exception 'embedding profile is not active' using errcode = 'P0004';
  end if;

  insert into public.document_ingestion_jobs (
    org_id, file_id, file_version_id, embedding_profile_id
  ) values (
    v_version.org_id, v_version.file_id, v_version.id, v_profile
  ) on conflict (file_version_id, chunker_version, embedding_profile_id)
    do update set updated_at = public.document_ingestion_jobs.updated_at
  returning * into v_job;
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.enqueue_document_ingestion(uuid,text) from public, anon;
grant execute on function public.enqueue_document_ingestion(uuid,text) to authenticated, service_role;

create or replace function public.claim_document_ingestion(
  p_worker text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_job public.document_ingestion_jobs;
begin
  if btrim(coalesce(p_worker, '')) = '' then
    raise exception 'worker id is required' using errcode = 'P0004';
  end if;

  select id into v_id
    from public.document_ingestion_jobs
   where attempt_count < max_attempts
     and available_at <= now()
     and (
       stage in ('queued', 'retryable_failed')
       or (
         stage in ('extracting', 'chunking', 'embedding', 'classifying')
         and lease_expires_at < now()
       )
     )
   order by available_at, created_at
   for update skip locked
   limit 1;

  if v_id is null then return null; end if;
  update public.document_ingestion_jobs
     set stage = 'extracting',
         attempt_count = attempt_count + 1,
         lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
         started_at = coalesce(started_at, now()),
         completed_at = null,
         updated_at = now()
   where id = v_id
   returning * into v_job;
  update public.file_versions
     set status = 'extracting'
   where id = v_job.file_version_id
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );
  update public.files f
     set status = 'extracting', updated_at = now()
    from public.file_versions v
   where v.id = v_job.file_version_id
     and f.id = v.file_id and f.org_id = v.org_id
     and f.current_version = v.version
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.claim_document_ingestion(text,integer) from public, anon, authenticated;
grant execute on function public.claim_document_ingestion(text,integer) to service_role;

create or replace function public.renew_document_ingestion_lease(
  p_job_id uuid,
  p_worker text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewed boolean;
begin
  update public.document_ingestion_jobs
     set lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))),
         updated_at = now()
   where id = p_job_id
     and lease_owner = p_worker
     and stage in ('extracting', 'chunking', 'embedding', 'classifying')
   returning true into v_renewed;
  return coalesce(v_renewed, false);
end;
$$;

revoke all on function public.renew_document_ingestion_lease(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.renew_document_ingestion_lease(uuid,text,integer) to service_role;

create or replace function public.advance_document_ingestion(
  p_job_id uuid,
  p_worker text,
  p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs;
begin
  if p_stage not in ('extracting', 'chunking', 'embedding', 'classifying') then
    raise exception 'invalid document ingestion stage' using errcode = 'P0004';
  end if;
  update public.document_ingestion_jobs
     set stage = p_stage, updated_at = now()
   where id = p_job_id and lease_owner = p_worker
     and lease_expires_at > now()
   returning * into v_job;
  if v_job.id is null then
    raise exception 'job is not leased by this worker' using errcode = 'P0004';
  end if;
  update public.file_versions set status = p_stage
   where id = v_job.file_version_id
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );
  update public.files f
     set status = p_stage, updated_at = now()
    from public.file_versions v
   where v.id = v_job.file_version_id
     and f.id = v.file_id and f.org_id = v.org_id
     and f.current_version = v.version
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.advance_document_ingestion(uuid,text,text) from public, anon, authenticated;
grant execute on function public.advance_document_ingestion(uuid,text,text) to service_role;

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

  update public.file_versions
     set status = 'indexed', active_chunker_version = v_job.chunker_version,
         active_embedding_profile = v_job.embedding_profile_id,
         indexed_at = now(), processing_error = null,
         intelligence = coalesce(p_intelligence, intelligence)
   where id = v_job.file_version_id
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );

  update public.files f
     set status = 'indexed', intelligence = coalesce(p_intelligence, f.intelligence), updated_at = now()
    from public.file_versions v
   where v.id = v_job.file_version_id
     and f.id = v.file_id and f.org_id = v.org_id
     and f.current_version = v.version
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.complete_document_ingestion(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.complete_document_ingestion(uuid,text,jsonb) to service_role;

create or replace function public.fail_document_ingestion(
  p_job_id uuid,
  p_worker text,
  p_error_code text,
  p_error_detail text,
  p_retryable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs;
begin
  update public.document_ingestion_jobs
     set stage = case when p_retryable and attempt_count < max_attempts
                      then 'retryable_failed' else 'permanent_failed' end,
         available_at = case when p_retryable and attempt_count < max_attempts
                             then now() + make_interval(secs => least(3600, 15 * (2 ^ greatest(0, attempt_count - 1))))
                             else available_at end,
         lease_owner = null, lease_expires_at = null,
         last_error_code = left(coalesce(p_error_code, 'document_failed'), 120),
         last_error_detail = left(coalesce(p_error_detail, 'document processing failed'), 2000),
         completed_at = case when p_retryable and attempt_count < max_attempts then null else now() end,
         updated_at = now()
   where id = p_job_id and lease_owner = p_worker
   returning * into v_job;
  if v_job.id is null then
    raise exception 'job is not leased by this worker' using errcode = 'P0004';
  end if;
  update public.file_versions
     set status = case when v_job.stage = 'permanent_failed' then 'failed' else 'queued' end,
         processing_error = jsonb_build_object(
           'code', v_job.last_error_code,
           'detail', v_job.last_error_detail,
           'retryable', v_job.stage = 'retryable_failed'
         )
   where id = v_job.file_version_id
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );
  update public.files f
     set status = case when v_job.stage = 'permanent_failed' then 'failed' else 'queued' end,
         updated_at = now()
    from public.file_versions v
   where v.id = v_job.file_version_id
     and f.id = v.file_id and f.org_id = v.org_id
     and f.current_version = v.version
     and v_job.embedding_profile_id = (
       select embedding_profile_id from public.organizations where id = v_job.org_id
     );
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.fail_document_ingestion(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.fail_document_ingestion(uuid,text,text,text,boolean) to service_role;

create or replace function public.create_document_version(
  p_org_id uuid,
  p_file_id uuid,
  p_mime_type text,
  p_content_base64 text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_file public.files;
  v_version public.file_versions;
  v_content bytea;
  v_next integer;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'document not found' using errcode = '42501';
  end if;
  if p_mime_type not in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ) then
    raise exception 'unsupported document type' using errcode = 'P0004';
  end if;
  begin
    v_content := decode(p_content_base64, 'base64');
  exception when others then
    raise exception 'document content is not valid base64' using errcode = 'P0004';
  end;
  if octet_length(v_content) = 0 or octet_length(v_content) > 15728640 then
    raise exception 'document must contain between 1 byte and 15 MB' using errcode = 'P0004';
  end if;

  select * into v_file from public.files
   where id = p_file_id and org_id = p_org_id for update;
  if v_file.id is null then
    raise exception 'document not found' using errcode = 'P0004';
  end if;
  v_next := v_file.current_version + 1;

  insert into public.file_versions (
    org_id, file_id, version, mime_type, size_bytes, sha256, content
  ) values (
    p_org_id, p_file_id, v_next, p_mime_type, octet_length(v_content),
    encode(digest(v_content, 'sha256'), 'hex'), v_content
  ) returning * into v_version;
  return to_jsonb(v_version) - 'content';
end;
$$;

revoke all on function public.create_document_version(uuid,uuid,text,text) from public, anon;
grant execute on function public.create_document_version(uuid,uuid,text,text) to authenticated;

-- Existing versions predate the queue trigger. Enqueue them once; the unique
-- key makes migration replay harmless in a disposable test database.
insert into public.document_ingestion_jobs (
  org_id, file_id, file_version_id, embedding_profile_id
)
select v.org_id, v.file_id, v.id, o.embedding_profile_id
  from public.file_versions v
  join public.organizations o on o.id = v.org_id
on conflict (file_version_id, chunker_version, embedding_profile_id) do nothing;

update public.file_versions v
   set status = 'queued'
 where exists (
   select 1 from public.document_ingestion_jobs j
    where j.file_version_id = v.id and j.stage = 'queued'
 );

notify pgrst, 'reload schema';
