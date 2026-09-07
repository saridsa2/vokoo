-- A release validator protects the next publication. Existing inert flows need
-- to leave the target picker too, without discarding the graph someone may
-- still want to finish.

begin;

update public.flows f
   set status = 'draft', published_at = null, updated_at = now()
 where f.status = 'published'
   and exists (
     select 1 from jsonb_array_elements(f.graph->'nodes') n
      where n->>'implementation' like 'trigger.%'
        and not exists (
          select 1 from jsonb_array_elements(coalesce(f.graph->'transitions', '[]'::jsonb)) t
           where t->>'from' = n->>'id'
        )
   );

commit;
