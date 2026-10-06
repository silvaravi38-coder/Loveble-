-- A trusted backend connector can dispatch an already-authorized read job
-- without receiving either the owner's session or the Discord token.
create table public.discord_job_dispatches (
  job_id uuid primary key references public.discord_jobs(id),
  token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at > created_at and expires_at <= created_at + interval '5 minutes')
);
alter table public.discord_job_dispatches enable row level security;
revoke all on public.discord_job_dispatches from public,anon,authenticated;
grant all on public.discord_job_dispatches to service_role;
create function public.discord_claim_dispatch(p_job_id uuid,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_job public.discord_jobs%rowtype;
begin
  select j.* into v_job
  from public.discord_jobs j join public.discord_job_dispatches d on d.job_id=j.id
  join public.profiles p on p.id=j.requested_by
  where j.id=p_job_id and j.status='queued'
    and j.action in ('scan','preview','backup') and p.role='admin'
    and d.token_hash=p_token_hash and d.consumed_at is null and d.expires_at>now()
  for update of j,d;
  if not found then return null; end if;
  update public.discord_job_dispatches set consumed_at=now() where job_id=v_job.id;
  update public.discord_jobs set status='running',attempts=1,started_at=now()
    where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end $$;
revoke all on function public.discord_claim_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function public.discord_claim_dispatch(uuid,text) to service_role;
