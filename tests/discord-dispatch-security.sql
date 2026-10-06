begin;
do $$
declare actor uuid; config uuid; job uuid; result jsonb; expected_hash text := repeat('a',64);
begin
  select id into actor from public.profiles where role='admin' limit 1;
  insert into public.discord_builder_configs(guild_id,created_by) values('999999999999999998',actor) returning id into config;
  insert into public.discord_jobs(config_id,guild_id,action,requested_by,idempotency_key)
    values(config,'999999999999999998','scan',actor,gen_random_uuid()) returning id into job;
  insert into public.discord_job_dispatches(job_id,token_hash,expires_at) values(job,expected_hash,now()+interval '3 minutes');
  if public.discord_claim_dispatch(job,repeat('b',64)) is not null then raise exception 'wrong capability accepted'; end if;
  if (select consumed_at from public.discord_job_dispatches where job_id=job) is not null then raise exception 'wrong capability consumed dispatch'; end if;
  result := public.discord_claim_dispatch(job,expected_hash);
  if result->>'status' is distinct from 'running' then raise exception 'dispatch not claimed'; end if;
  if public.discord_claim_dispatch(job,expected_hash) is not null then raise exception 'capability replay accepted'; end if;
  update public.discord_jobs set status='succeeded' where id=job;
  insert into public.discord_jobs(config_id,guild_id,action,requested_by,idempotency_key)
    values(config,'999999999999999998','scan',actor,gen_random_uuid()) returning id into job;
  insert into public.discord_job_dispatches(job_id,token_hash,created_at,expires_at)
    values(job,expected_hash,now()-interval '2 minutes',now()-interval '1 minute');
  if public.discord_claim_dispatch(job,expected_hash) is not null then raise exception 'expired capability accepted'; end if;
  if has_table_privilege('authenticated','public.discord_job_dispatches','SELECT') then raise exception 'client capability read access'; end if;
  if has_function_privilege('anon','public.discord_claim_dispatch(uuid,text)','EXECUTE') or has_function_privilege('authenticated','public.discord_claim_dispatch(uuid,text)','EXECUTE') then raise exception 'public dispatch RPC'; end if;
end $$;
select 'PASS: one-time capabilities, wrong proof, expiry, replay, grants; fixtures rolled back' as test_result;
rollback;
