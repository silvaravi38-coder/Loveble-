-- Only the authenticated admin endpoint/service worker may write execution data.
create table public.discord_jobs (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.discord_builder_configs(id),
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  action text not null check (action in ('scan','preview','backup','apply','rebuild','restore','publish','sync','unpublish')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','blocked','cancelled')),
  requested_by uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  input jsonb not null default '{}', result jsonb,
  error_code text, error_message text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (requested_by,idempotency_key)
);
create unique index discord_jobs_one_active_guild on public.discord_jobs(guild_id) where status in ('queued','running');
create index discord_jobs_recent on public.discord_jobs(config_id,created_at desc);
create index discord_jobs_requested_by on public.discord_jobs(requested_by);
create table public.discord_job_logs (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.discord_jobs(id),
  level text not null check (level in ('info','warning','error')),
  code text not null, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index discord_job_logs_job on public.discord_job_logs(job_id,id);
create table public.discord_structure_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.discord_jobs(id),
  guild_id text not null,
  purpose text not null check (purpose in ('scan','backup')),
  structure jsonb not null,
  checksum text not null,
  scope text not null default 'structure_only' check (scope='structure_only'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index discord_snapshots_guild on public.discord_structure_snapshots(guild_id,created_at desc);
create index discord_snapshots_created_by on public.discord_structure_snapshots(created_by);
create table public.discord_resource_mappings (
  guild_id text not null,
  discord_id text not null,
  resource_type text not null check (resource_type in ('category','channel','role')),
  logical_key text,
  name text not null,
  parent_id text,
  managed_by_nexium boolean not null default false,
  snapshot_id uuid not null references public.discord_structure_snapshots(id),
  last_seen_at timestamptz not null default now(),
  primary key (guild_id,discord_id)
);
create unique index discord_mapping_logical_key on public.discord_resource_mappings(guild_id,logical_key) where logical_key is not null;
create index discord_mapping_snapshot on public.discord_resource_mappings(snapshot_id);

alter table public.discord_jobs enable row level security;
alter table public.discord_job_logs enable row level security;
alter table public.discord_structure_snapshots enable row level security;
alter table public.discord_resource_mappings enable row level security;
revoke all on public.discord_jobs, public.discord_job_logs, public.discord_structure_snapshots, public.discord_resource_mappings from anon,authenticated;
grant select on public.discord_jobs, public.discord_job_logs, public.discord_structure_snapshots, public.discord_resource_mappings to authenticated;
grant all on public.discord_jobs, public.discord_job_logs, public.discord_structure_snapshots, public.discord_resource_mappings to service_role;
grant usage,select on sequence public.discord_job_logs_id_seq to service_role;
create policy discord_jobs_admin_read on public.discord_jobs for select to authenticated using ((select public.is_admin()));
create policy discord_logs_admin_read on public.discord_job_logs for select to authenticated using ((select public.is_admin()));
create policy discord_snapshots_admin_read on public.discord_structure_snapshots for select to authenticated using ((select public.is_admin()));
create policy discord_mappings_admin_read on public.discord_resource_mappings for select to authenticated using ((select public.is_admin()));

-- Atomic inventory save: a failed scan never leaves a partial mapping.
-- SECURITY INVOKER: only service_role gets EXECUTE and table write privileges.
create function public.discord_save_scan(p_job_id uuid, p_structure jsonb, p_checksum text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.discord_jobs%rowtype; s uuid; r jsonb; kind text;
begin
  select * into j from public.discord_jobs where id=p_job_id for update;
  if not found or j.status <> 'running' or j.action not in ('scan','backup') then raise exception 'invalid scan job'; end if;
  if p_structure->'guild'->>'id' is distinct from j.guild_id then raise exception 'guild mismatch'; end if;
  insert into public.discord_structure_snapshots(job_id,guild_id,purpose,structure,checksum,created_by)
    values(j.id,j.guild_id,j.action,p_structure,p_checksum,j.requested_by) returning id into s;
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
