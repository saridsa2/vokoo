-- One provider-neutral read model for the document viewer and evidence links.

create or replace function public.get_document_layout(
  p_org_id uuid,
  p_file_id uuid,
  p_version integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_version public.file_versions;
  v_extraction public.document_extractions;
begin
  if p_version < 1 then
    raise exception 'document version must be positive' using errcode = 'P0004';
  end if;
  select * into v_version
    from public.file_versions
   where org_id = p_org_id and file_id = p_file_id and version = p_version;
  if v_version.id is null then
    raise exception 'document version not found' using errcode = 'P0002';
  end if;
  if v_version.active_extraction_id is null then
    return jsonb_build_object(
      'status', 'processing',
      'schema_version', null,
      'extraction_id', null,
      'provider', null,
      'provider_version', null,
      'source_sha256', v_version.sha256,
      'warnings', '[]'::jsonb,
      'pages', '[]'::jsonb,
      'items', '[]'::jsonb
    );
  end if;

  select * into v_extraction
    from public.document_extractions
   where id = v_version.active_extraction_id
     and org_id = p_org_id
     and file_version_id = v_version.id;
  if v_extraction.id is null then
    raise exception 'active document extraction not found' using errcode = 'P0004';
  end if;

  return jsonb_build_object(
    'status', 'ready',
    'schema_version', v_extraction.schema_version,
    'extraction_id', v_extraction.id,
    'provider', v_extraction.provider,
    'provider_version', v_extraction.provider_version,
    'source_sha256', v_extraction.source_sha256,
    'warnings', v_extraction.warnings,
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'page_number', p.page_number,
        'width_points', p.width_points,
        'height_points', p.height_points
      ) order by p.page_number)
      from public.document_pages p where p.extraction_id = v_extraction.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'provider_ref', i.provider_ref,
        'parent_ref', i.parent_ref,
        'ordinal', i.ordinal,
        'label', i.label,
        'content_layer', i.content_layer,
        'text', i.text_content,
        'section_path', to_jsonb(i.section_path),
        'metadata', i.metadata,
        'chunk_ids', to_jsonb(coalesce(array(
          select distinct l.chunk_id::text
          from public.document_chunk_layout_items l
          where l.layout_item_id = i.id
          order by l.chunk_id::text
        ), '{}'::text[])),
        'spans', coalesce((
          select jsonb_agg(jsonb_build_object(
            'page_number', s.page_number,
            'bbox', jsonb_build_object(
              'left', s.bbox_left,
              'top', s.bbox_top,
              'right', s.bbox_right,
              'bottom', s.bbox_bottom,
              'origin', s.coordinate_origin
            ),
            'char_start', s.char_start,
            'char_end', s.char_end
          ) order by s.page_number, s.ordinal)
          from public.document_layout_spans s where s.item_id = i.id
        ), '[]'::jsonb)
      ) order by i.ordinal)
      from public.document_layout_items i where i.extraction_id = v_extraction.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_document_layout(uuid,uuid,integer) from public, anon;
grant execute on function public.get_document_layout(uuid,uuid,integer) to authenticated, service_role;

notify pgrst, 'reload schema';
