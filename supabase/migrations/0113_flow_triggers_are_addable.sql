-- Trigger nodes are entry points an author can add to a multi-trigger flow.
-- `post_call` described the old one-flow-per-event workspace; integrations are
-- now the explicit capability family, while call-ended belongs on call flows.

begin;

update public.catalogue_node_types
   set families = array(
     select case when family = 'post_call' then 'integration' else family end
       from unnest(families) family
   )
 where 'post_call' = any(families);

update public.catalogue_node_types
   set is_addable = true,
       families = array['call']::text[]
 where id in (
   'trigger.call_answered',
   'trigger.call_ended',
   'trigger.call_failed'
 );

commit;
