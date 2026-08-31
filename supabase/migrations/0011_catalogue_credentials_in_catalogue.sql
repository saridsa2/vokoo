-- Connectable providers belong in the capability catalogue.
--
-- They were briefly exposed through the generic `/api/v1/{resource}` route,
-- which scopes every query by `org_id` and orders by `updated_at`. A global
-- catalogue table has neither column, so the query failed and the screen simply
-- rendered nothing. The generic route is for organisation data; this is not.
create or replace function public.capability_catalogue()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'providers', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.sort_order)
      from public.catalogue_providers p where p.is_active
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.sort_order)
      from public.catalogue_models m where m.is_active
    ), '[]'::jsonb),
    'voices', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.sort_order)
      from public.catalogue_voices v where v.is_active
    ), '[]'::jsonb),
    'transcribers', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.sort_order)
      from public.catalogue_transcribers t where t.is_active
    ), '[]'::jsonb),
    'credentials', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.sort_order)
      from public.catalogue_credentials c where c.is_active
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.capability_catalogue() from public;
grant execute on function public.capability_catalogue() to authenticated;
