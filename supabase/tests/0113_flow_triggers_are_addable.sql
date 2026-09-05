\set ON_ERROR_STOP on

begin;

do $$
begin
  if exists (
    select 1
      from public.catalogue_node_types
     where id in ('trigger.call_answered', 'trigger.call_ended', 'trigger.call_failed')
       and (not is_addable or families <> array['call']::text[])
  ) then
    raise exception 'call triggers are not addable only on call flows';
  end if;

  if exists (
    select 1
      from public.catalogue_node_types
     where 'post_call' = any(families)
  ) then
    raise exception 'the legacy post_call catalogue family remains';
  end if;
end;
$$;

rollback;
