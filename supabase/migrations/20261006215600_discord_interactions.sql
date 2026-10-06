create table public.discord_runtime_configs (
  application_id text primary key check(application_id ~ '^[0-9]{17,20}$'),
  public_key text not null check(public_key ~ '^[a-f0-9]{64}$'),
  guild_id text not null,
  endpoint_url text not null,
  command_id text,
  connected_at timestamptz,
  updated_by uuid not null references public.profiles(id)
);
create table public.discord_interaction_events (
  interaction_id text primary key,
  guild_id text not null,
  discord_user_id text not null,
  action text not null,
  status text not null default 'received' check(status in ('received','succeeded','failed')),
  response_code text,
  received_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.discord_runtime_configs enable row level security;
alter table public.discord_interaction_events enable row level security;
revoke all on public.discord_runtime_configs,public.discord_interaction_events from public,anon,authenticated;
grant select on public.discord_runtime_configs,public.discord_interaction_events to authenticated;
grant all on public.discord_runtime_configs,public.discord_interaction_events to service_role;
create policy discord_runtime_admin on public.discord_runtime_configs for select to authenticated using((select public.is_admin()));
create policy discord_interactions_admin on public.discord_interaction_events for select to authenticated using((select public.is_admin()));
create policy discord_runtime_backend on public.discord_runtime_configs for all to service_role using(true) with check(true);
create policy discord_interactions_backend on public.discord_interaction_events for all to service_role using(true) with check(true);

create or replace function public.discord_claim_dispatch(p_job_id uuid,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_job public.discord_jobs%rowtype;
begin
  select j.* into v_job from public.discord_jobs j
  join public.discord_job_dispatches d on d.job_id=j.id
  join public.profiles p on p.id=j.requested_by
  where j.id=p_job_id and j.status='queued' and p.role='admin'
    and (j.action in ('scan','preview','backup','apply') or (j.action='publish' and j.input->>'target'='runtime_connection'))
    and d.token_hash=p_token_hash and d.consumed_at is null and d.expires_at>now()
  for update of j,d;
  if not found then return null; end if;
  update public.discord_job_dispatches set consumed_at=now() where job_id=v_job.id;
  update public.discord_jobs set status='running',attempts=1,started_at=now() where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end $$;
revoke all on function public.discord_claim_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function public.discord_claim_dispatch(uuid,text) to service_role;
