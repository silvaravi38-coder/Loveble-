create table public.discord_job_operations (
  job_id uuid not null references public.discord_jobs(id),
  operation_key text not null,
  resource_type text not null check(resource_type in ('role','category','channel')),
  status text not null check(status in ('running','succeeded','failed','uncertain')),
  discord_id text,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key(job_id,operation_key)
);
alter table public.discord_job_operations enable row level security;
revoke all on public.discord_job_operations from public,anon,authenticated;
grant select on public.discord_job_operations to authenticated;
grant all on public.discord_job_operations to service_role;
create policy discord_operations_admin_read on public.discord_job_operations for select to authenticated using((select public.is_admin()));
create policy discord_dispatch_worker_only on public.discord_job_dispatches for all to service_role using(true) with check(true);

create or replace function public.discord_claim_dispatch(p_job_id uuid,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_job public.discord_jobs%rowtype;
begin
  select j.* into v_job
  from public.discord_jobs j join public.discord_job_dispatches d on d.job_id=j.id
  join public.profiles p on p.id=j.requested_by
  where j.id=p_job_id and j.status='queued'
    and j.action in ('scan','preview','backup','apply') and p.role='admin'
    and d.token_hash=p_token_hash and d.consumed_at is null and d.expires_at>now()
  for update of j,d;
  if not found then return null; end if;
  update public.discord_job_dispatches set consumed_at=now() where job_id=v_job.id;
  update public.discord_jobs set status='running',attempts=1,started_at=now() where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end $$;
revoke all on function public.discord_claim_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function public.discord_claim_dispatch(uuid,text) to service_role;

create or replace function public.discord_save_scan(p_job_id uuid, p_structure jsonb, p_checksum text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.discord_jobs%rowtype; s uuid; r jsonb; kind text;
begin
  select * into j from public.discord_jobs where id=p_job_id for update;
  if not found or j.status <> 'running' or j.action not in ('scan','backup','apply') then raise exception 'invalid scan job'; end if;
  if p_structure->'guild'->>'id' is distinct from j.guild_id then raise exception 'guild mismatch'; end if;
  insert into public.discord_structure_snapshots(job_id,guild_id,purpose,structure,checksum,created_by)
    values(j.id,j.guild_id,case when j.action='apply' then 'backup' else j.action end,p_structure,p_checksum,j.requested_by) returning id into s;
  for r in select value from jsonb_array_elements(p_structure->'channels') loop
    kind := case when (r->>'type')::integer=4 then 'category' else 'channel' end;
    insert into public.discord_resource_mappings(guild_id,discord_id,resource_type,name,parent_id,snapshot_id)
      values(j.guild_id,r->>'id',kind,r->>'name',r->>'parent_id',s)
      on conflict (guild_id,discord_id) do update set name=excluded.name,parent_id=excluded.parent_id,
        resource_type=excluded.resource_type,snapshot_id=s,last_seen_at=now();
  end loop;
  for r in select value from jsonb_array_elements(p_structure->'roles') loop
    insert into public.discord_resource_mappings(guild_id,discord_id,resource_type,name,snapshot_id)
      values(j.guild_id,r->>'id','role',r->>'name',s)
      on conflict (guild_id,discord_id) do update set name=excluded.name,snapshot_id=s,last_seen_at=now();
  end loop;
  return s;
end $$;
revoke all on function public.discord_save_scan(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.discord_save_scan(uuid,jsonb,text) to service_role;
