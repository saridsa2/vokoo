\set ON_ERROR_STOP on
begin;
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.claim_compiler_run(text,integer)'::regprocedure)
    into v_definition;
  if position('materializing' in v_definition)=0 then
    raise exception 'claim_compiler_run cannot recover materialization leases';
  end if;
end; $$;
rollback;
