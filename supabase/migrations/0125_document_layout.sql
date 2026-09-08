-- Provider-neutral document layout derived from an immutable source version.

create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  file_id uuid not null,
  file_version_id uuid not null,
  job_id uuid not null unique references public.document_ingestion_jobs(id) on delete cascade,
  provider text not null check (btrim(provider) <> ''),
  provider_version text not null check (btrim(provider_version) <> ''),
  schema_version text not null check (schema_version = 'layout-v1'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  raw_artifact jsonb not null check (jsonb_typeof(raw_artifact) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  unique (id, file_version_id, org_id),
  constraint document_extractions_file_same_org
    foreign key (file_id, org_id) references public.files(id, org_id) on delete cascade,
  constraint document_extractions_version_same_org
    foreign key (file_version_id, org_id) references public.file_versions(id, org_id) on delete cascade
);

alter table public.file_versions
  add column active_extraction_id uuid;

alter table public.file_versions
  add constraint file_versions_active_extraction_same_source
  foreign key (active_extraction_id, id, org_id)
  references public.document_extractions(id, file_version_id, org_id);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  extraction_id uuid not null,
  page_number integer not null check (page_number > 0),
  width_points double precision not null check (
    width_points > 0 and width_points < 'Infinity'::double precision
    and width_points <> 'NaN'::double precision
  ),
  height_points double precision not null check (
    height_points > 0 and height_points < 'Infinity'::double precision
    and height_points <> 'NaN'::double precision
  ),
  unique (extraction_id, page_number),
  unique (extraction_id, page_number, org_id),
  constraint document_pages_extraction_same_org
    foreign key (extraction_id, org_id)
    references public.document_extractions(id, org_id) on delete cascade
);

create table public.document_layout_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  extraction_id uuid not null,
  provider_ref text not null check (btrim(provider_ref) <> ''),
  parent_ref text,
  ordinal integer not null check (ordinal >= 0),
  label text not null check (btrim(label) <> ''),
  content_layer text not null check (content_layer in ('body', 'furniture')),
  text_content text not null default '',
  section_path text[] not null default '{}',
  metadata jsonb not null default 'null'::jsonb,
  unique (extraction_id, provider_ref),
  unique (extraction_id, ordinal),
  unique (id, org_id),
  unique (id, extraction_id, org_id),
  constraint document_layout_items_extraction_same_org
    foreign key (extraction_id, org_id)
    references public.document_extractions(id, org_id) on delete cascade
);

create table public.document_layout_spans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  extraction_id uuid not null,
  item_id uuid not null,
  page_number integer not null,
  ordinal integer not null check (ordinal >= 0),
  bbox_left double precision not null check (
    bbox_left >= 0 and bbox_left < 'Infinity'::double precision
    and bbox_left <> 'NaN'::double precision
  ),
  bbox_top double precision not null check (
    bbox_top >= 0 and bbox_top < 'Infinity'::double precision
    and bbox_top <> 'NaN'::double precision
  ),
  bbox_right double precision not null check (
    bbox_right >= bbox_left and bbox_right < 'Infinity'::double precision
    and bbox_right <> 'NaN'::double precision
  ),
  bbox_bottom double precision not null check (
    bbox_bottom >= 0 and bbox_bottom <= bbox_top
    and bbox_bottom < 'Infinity'::double precision
    and bbox_bottom <> 'NaN'::double precision
  ),
  coordinate_origin text not null check (coordinate_origin = 'BOTTOMLEFT'),
  char_start integer not null check (char_start >= 0),
  char_end integer not null check (char_end >= char_start),
  unique (item_id, ordinal),
  constraint document_layout_spans_item_same_extraction
    foreign key (item_id, extraction_id, org_id)
    references public.document_layout_items(id, extraction_id, org_id) on delete cascade,
  constraint document_layout_spans_page_same_extraction
    foreign key (extraction_id, page_number, org_id)
    references public.document_pages(extraction_id, page_number, org_id) on delete cascade
);

create table public.document_chunk_layout_items (
  org_id uuid not null references public.organizations(id) on delete cascade,
  chunk_id uuid not null,
  layout_item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (chunk_id, layout_item_id),
  constraint document_chunk_layout_chunk_same_org
    foreign key (chunk_id, org_id)
    references public.document_chunks(id, org_id) on delete cascade,
  constraint document_chunk_layout_item_same_org
    foreign key (layout_item_id, org_id)
    references public.document_layout_items(id, org_id) on delete cascade
);

create index document_extractions_version_idx
  on public.document_extractions (org_id, file_version_id, created_at desc);
create index document_layout_items_order_idx
  on public.document_layout_items (extraction_id, ordinal);
create index document_layout_spans_page_idx
  on public.document_layout_spans (extraction_id, page_number, ordinal);

alter table public.document_extractions enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_layout_items enable row level security;
alter table public.document_layout_spans enable row level security;
alter table public.document_chunk_layout_items enable row level security;

create policy document_extractions_read on public.document_extractions for select
  using (public.is_org_member(org_id));
create policy document_pages_read on public.document_pages for select
  using (public.is_org_member(org_id));
create policy document_layout_items_read on public.document_layout_items for select
  using (public.is_org_member(org_id));
create policy document_layout_spans_read on public.document_layout_spans for select
  using (public.is_org_member(org_id));
create policy document_chunk_layout_items_read on public.document_chunk_layout_items for select
  using (public.is_org_member(org_id));

create or replace function public.store_document_extraction(
  p_job_id uuid,
  p_worker text,
  p_extraction jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs;
  v_source public.file_versions;
  v_extraction_id uuid;
  v_page jsonb;
  v_item jsonb;
  v_span jsonb;
  v_item_id uuid;
  v_span_ordinal integer;
begin
  select * into v_job
    from public.document_ingestion_jobs
   where id = p_job_id
   for update;
  if v_job.id is null
     or v_job.lease_owner is distinct from p_worker
     or v_job.lease_expires_at <= now()
     or v_job.stage <> 'extracting' then
    raise exception 'document job lease was lost' using errcode = 'P0004';
  end if;
  select * into v_source from public.file_versions
   where id = v_job.file_version_id and org_id = v_job.org_id;
  if p_extraction ->> 'schema_version' <> 'layout-v1'
     or p_extraction ->> 'source_sha256' is distinct from v_source.sha256
     or jsonb_typeof(p_extraction -> 'pages') <> 'array'
     or jsonb_array_length(p_extraction -> 'pages') = 0
     or jsonb_typeof(p_extraction -> 'items') <> 'array' then
    raise exception 'invalid document extraction artifact' using errcode = 'P0004';
  end if;

  insert into public.document_extractions (
    org_id, file_id, file_version_id, job_id, provider, provider_version,
    schema_version, source_sha256, warnings, raw_artifact
  ) values (
    v_job.org_id, v_job.file_id, v_job.file_version_id, v_job.id,
    p_extraction ->> 'provider', p_extraction ->> 'provider_version',
    p_extraction ->> 'schema_version', p_extraction ->> 'source_sha256',
    coalesce(p_extraction -> 'warnings', '[]'::jsonb),
    p_extraction -> 'raw_artifact'
  ) on conflict (job_id) do update set
    provider = excluded.provider,
    provider_version = excluded.provider_version,
    schema_version = excluded.schema_version,
    source_sha256 = excluded.source_sha256,
    warnings = excluded.warnings,
    raw_artifact = excluded.raw_artifact
  returning id into v_extraction_id;

  delete from public.document_layout_items where extraction_id = v_extraction_id;
  delete from public.document_pages where extraction_id = v_extraction_id;
  for v_page in select * from jsonb_array_elements(p_extraction -> 'pages') loop
    insert into public.document_pages (
      org_id, extraction_id, page_number, width_points, height_points
    ) values (
      v_job.org_id, v_extraction_id,
      (v_page ->> 'page_number')::integer,
      (v_page ->> 'width_points')::double precision,
      (v_page ->> 'height_points')::double precision
    );
  end loop;

  for v_item in select * from jsonb_array_elements(p_extraction -> 'items') loop
    insert into public.document_layout_items (
      org_id, extraction_id, provider_ref, parent_ref, ordinal, label,
      content_layer, text_content, section_path, metadata
    ) values (
      v_job.org_id, v_extraction_id, v_item ->> 'provider_ref',
      v_item ->> 'parent_ref', (v_item ->> 'ordinal')::integer,
      v_item ->> 'label', v_item ->> 'content_layer',
      coalesce(v_item ->> 'text', ''),
      coalesce(array(select jsonb_array_elements_text(v_item -> 'section_path')), '{}'),
      coalesce(v_item -> 'metadata', 'null'::jsonb)
    ) returning id into v_item_id;

    v_span_ordinal := 0;
    for v_span in select * from jsonb_array_elements(coalesce(v_item -> 'spans', '[]'::jsonb)) loop
      if not exists (
        select 1 from public.document_pages p
         where p.extraction_id = v_extraction_id
           and p.page_number = (v_span ->> 'page_number')::integer
           and (v_span -> 'bbox' ->> 'left')::double precision >= 0
           and (v_span -> 'bbox' ->> 'bottom')::double precision >= 0
           and (v_span -> 'bbox' ->> 'right')::double precision <= p.width_points
           and (v_span -> 'bbox' ->> 'top')::double precision <= p.height_points
           and (v_span -> 'bbox' ->> 'left')::double precision
               <= (v_span -> 'bbox' ->> 'right')::double precision
           and (v_span -> 'bbox' ->> 'bottom')::double precision
               <= (v_span -> 'bbox' ->> 'top')::double precision
           and (v_span ->> 'char_start')::integer >= 0
           and (v_span ->> 'char_end')::integer >= (v_span ->> 'char_start')::integer
           and (v_span ->> 'char_end')::integer <= char_length(coalesce(v_item ->> 'text', ''))
      ) then
        raise exception 'invalid document layout span' using errcode = 'P0004';
      end if;
      insert into public.document_layout_spans (
        org_id, extraction_id, item_id, page_number, ordinal,
        bbox_left, bbox_top, bbox_right, bbox_bottom, coordinate_origin,
        char_start, char_end
      ) values (
        v_job.org_id, v_extraction_id, v_item_id,
        (v_span ->> 'page_number')::integer, v_span_ordinal,
        (v_span -> 'bbox' ->> 'left')::double precision,
        (v_span -> 'bbox' ->> 'top')::double precision,
        (v_span -> 'bbox' ->> 'right')::double precision,
        (v_span -> 'bbox' ->> 'bottom')::double precision,
        v_span -> 'bbox' ->> 'origin',
        (v_span ->> 'char_start')::integer,
        (v_span ->> 'char_end')::integer
      );
      v_span_ordinal := v_span_ordinal + 1;
    end loop;
  end loop;

  update public.file_versions
     set active_extraction_id = v_extraction_id
   where id = v_job.file_version_id and org_id = v_job.org_id;
  return v_extraction_id;
end;
$$;

revoke all on function public.store_document_extraction(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.store_document_extraction(uuid,text,jsonb) to service_role;

create or replace function public.link_document_chunk_layout(
  p_job_id uuid,
  p_worker text,
  p_extraction_id uuid,
  p_links jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.document_ingestion_jobs;
  v_extraction uuid;
  v_link jsonb;
  v_count integer := 0;
  v_rows integer;
begin
  select * into v_job from public.document_ingestion_jobs where id = p_job_id;
  if v_job.id is null
     or v_job.lease_owner is distinct from p_worker
     or v_job.lease_expires_at <= now()
     or v_job.stage <> 'chunking' then
    raise exception 'document job lease was lost' using errcode = 'P0004';
  end if;
  select active_extraction_id into v_extraction
    from public.file_versions where id = v_job.file_version_id and org_id = v_job.org_id;
  if v_extraction is null or v_extraction is distinct from p_extraction_id then
    raise exception 'document extraction is not active' using errcode = 'P0004';
  end if;
  delete from public.document_chunk_layout_items
   where chunk_id in (
     select id from public.document_chunks
      where file_version_id = v_job.file_version_id
        and chunker_version = v_job.chunker_version
   );
  for v_link in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    insert into public.document_chunk_layout_items (org_id, chunk_id, layout_item_id)
    select v_job.org_id, c.id, i.id
      from public.document_chunks c
      join public.document_layout_items i
        on i.extraction_id = v_extraction
       and i.provider_ref in (
         select jsonb_array_elements_text(v_link -> 'provider_refs')
       )
     where c.file_version_id = v_job.file_version_id
       and c.chunker_version = v_job.chunker_version
       and c.ordinal = (v_link ->> 'chunk_ordinal')::integer
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.link_document_chunk_layout(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.link_document_chunk_layout(uuid,text,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
