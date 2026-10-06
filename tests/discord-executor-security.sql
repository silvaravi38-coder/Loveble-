-- Run against the Nexium schema. Every fixture is rolled back.
begin;
do $$
declare actor uuid; config uuid; job uuid; snap uuid; blocked boolean := false;
begin
  select id into actor from public.profiles where role='admin' limit 1;
  if actor is null then raise exception 'admin fixture unavailable'; end if;
  insert into public.discord_builder_configs(guild_id,guild_name,created_by)
    values('999999999999999999','Executor SQL test',actor) returning id into config;
  insert into public.discord_jobs(config_id,guild_id,action,requested_by,idempotency_key,status)
    values(config,'999999999999999999','scan',actor,gen_random_uuid(),'running') returning id into job;
  begin
    insert into public.discord_jobs(config_id,guild_id,action,requested_by,idempotency_key)
      values(config,'999999999999999999','backup',actor,gen_random_uuid());
  exception when unique_violation then blocked := true; end;
  if not blocked then raise exception 'guild lock failed'; end if;
  begin
    perform public.discord_save_scan(job,'{"guild":{"id":"wrong"},"channels":[],"roles":[]}', 'test');
    raise exception 'guild mismatch was accepted';
  exception when raise_exception then
    if sqlerrm <> 'guild mismatch' then raise; end if;
  end;
  if exists(select 1 from public.discord_structure_snapshots where job_id=job) then raise exception 'failed scan wrote a snapshot'; end if;
  snap := public.discord_save_scan(job,'{"guild":{"id":"999999999999999999","name":"Test"},"channels":[{"id":"777777777777777777","type":4,"name":"LOJA"}],"roles":[{"id":"888888888888888888","name":"Cliente"}]}','test');
  if (select count(*) from public.discord_resource_mappings where snapshot_id=snap) <> 2 then raise exception 'incomplete inventory'; end if;
  update public.discord_jobs set status='succeeded' where id=job;
  insert into public.discord_jobs(config_id,guild_id,action,requested_by,idempotency_key,status)
    values(config,'999999999999999999','scan',actor,gen_random_uuid(),'running') returning id into job;
  perform public.discord_save_scan(job,'{"guild":{"id":"999999999999999999","name":"Test"},"channels":[{"id":"777777777777777777","type":4,"name":"Loja atualizada"}],"roles":[{"id":"888888888888888888","name":"Cliente"}]}','test2');
  if (select count(*) from public.discord_resource_mappings where guild_id='999999999999999999') <> 2 then raise exception 'scan duplicated resources'; end if;
  if has_function_privilege('authenticated','public.discord_save_scan(uuid,jsonb,text)','EXECUTE') then raise exception 'public scan write access'; end if;
  if has_table_privilege('anon','public.discord_jobs','SELECT') then raise exception 'anon job access'; end if;
  if has_table_privilege('authenticated','public.discord_jobs','INSERT') then raise exception 'client job write access'; end if;
end $$;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.discord_jobs where guild_id='999999999999999999') then raise exception 'non-admin RLS leaked jobs'; end if;
  if exists(select 1 from public.discord_structure_snapshots where guild_id='999999999999999999') then raise exception 'non-admin RLS leaked snapshots'; end if;
  if exists(select 1 from public.discord_resource_mappings where guild_id='999999999999999999') then raise exception 'non-admin RLS leaked mappings'; end if;
end $$;
reset role;
select 'PASS: guild lock, atomic scan, ID upsert, RLS and grants; fixtures rolled back' as test_result;
rollback;
