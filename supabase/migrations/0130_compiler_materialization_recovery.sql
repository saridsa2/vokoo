-- Atomic materialization is safe to replay after an expired lease.
create or replace function public.claim_compiler_run(p_worker text,p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_run public.compiler_runs;
begin
  if btrim(coalesce(p_worker,''))='' then raise exception 'worker id is required' using errcode='P0004'; end if;
  select id into v_id from public.compiler_runs
   where attempt_count < max_attempts and available_at <= now()
     and (status='queued' or (status in ('planning','compiling','validating','materializing') and lease_expires_at < now()))
   order by available_at,created_at for update skip locked limit 1;
  if v_id is null then return null; end if;
  update public.compiler_runs set status='planning',attempt_count=attempt_count+1,
    lease_owner=p_worker,lease_expires_at=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,1800))),
    started_at=coalesce(started_at,now()),completed_at=null,last_error_code=null,last_error_detail=null,updated_at=now()
  where id=v_id returning * into v_run;
  return to_jsonb(v_run);
end; $$;
revoke all on function public.claim_compiler_run(text,integer) from public,anon,authenticated;
grant execute on function public.claim_compiler_run(text,integer) to service_role;
notify pgrst,'reload schema';
