-- The composer's palette joins the rest of the catalogue.
create or replace function public.capability_catalogue()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
                           from public.catalogue_providers p where p.is_active), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order)
                        from public.catalogue_models m where m.is_active), '[]'::jsonb),
    'voices', coalesce((select jsonb_agg(to_jsonb(v) order by v.sort_order)
                        from public.catalogue_voices v where v.is_active), '[]'::jsonb),
    'transcribers', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order)
                              from public.catalogue_transcribers t where t.is_active), '[]'::jsonb),
    'credentials', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order)
                             from public.catalogue_credentials c where c.is_active), '[]'::jsonb),
    'flowNodes', coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order)
                           from public.catalogue_flow_nodes f where f.is_active), '[]'::jsonb)
  );
$$;
revoke all on function public.capability_catalogue() from public;
grant execute on function public.capability_catalogue() to authenticated;
