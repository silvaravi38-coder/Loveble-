create or replace function public.discord_claim_dispatch(p_job_id uuid,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_job public.discord_jobs%rowtype;
begin
  select j.* into v_job from public.discord_jobs j
  join public.discord_job_dispatches d on d.job_id=j.id
  join public.profiles p on p.id=j.requested_by
  where j.id=p_job_id and j.status='queued' and p.role='admin'
    and (j.action in ('scan','preview','backup','apply') or (j.action='sync' and j.input->>'target'='streaming_catalog') or (j.action='publish' and j.input->>'target'='runtime_connection'))
    and d.token_hash=p_token_hash and d.consumed_at is null and d.expires_at>now()
  for update of j,d;
  if not found then return null; end if;
  update public.discord_job_dispatches set consumed_at=now() where job_id=v_job.id;
  update public.discord_jobs set status='running',attempts=1,started_at=now() where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end $$;
revoke all on function public.discord_claim_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function public.discord_claim_dispatch(uuid,text) to service_role;
