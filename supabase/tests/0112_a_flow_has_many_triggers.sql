\set ON_ERROR_STOP on

begin;

do $$
declare
  v_duplicate_was_rejected boolean := false;
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'flows'
       and column_name = 'family'
  ) then
    raise exception 'flows.family is missing';
  end if;

  perform public.validate_flow(
    '{
      "version": 3,
      "nodes": [
        {"id":"answered","type":"trigger","implementation":"trigger.call_answered","config":{}},
        {"id":"ended","type":"trigger","implementation":"trigger.call_ended","config":{}}
      ],
      "transitions": [],
      "variables": []
    }'::jsonb,
    'call',
    null
  );

  begin
    perform public.validate_flow(
      '{
        "version": 3,
        "nodes": [
          {"id":"first","type":"trigger","implementation":"trigger.call_answered","config":{}},
          {"id":"second","type":"trigger","implementation":"trigger.call_answered","config":{"key":"default"}}
        ],
        "transitions": [],
        "variables": []
      }'::jsonb,
      'call',
      null
    );
  exception
    when sqlstate 'P0004' then
      v_duplicate_was_rejected := true;
  end;

  if not v_duplicate_was_rejected then
    raise exception 'duplicate trigger event and key was accepted';
  end if;

  -- An existing CRM graph must remain publishable until its assisted migration.
  perform public.validate_flow(
    '{
      "version": 3,
      "nodes": [
        {"id":"ended","type":"trigger","implementation":"trigger.call_ended","config":{}}
      ],
      "transitions": [],
      "variables": []
    }'::jsonb,
    'integration',
    'call.ended'
  );
end;
$$;

rollback;
