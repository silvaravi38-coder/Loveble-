create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table public.discord_scheduler_auth(token_hash text primary key,last_seen_at timestamptz);
alter table public.discord_scheduler_auth enable row level security;
revoke all on public.discord_scheduler_auth from public,anon,authenticated;
grant all on public.discord_scheduler_auth to service_role;
create table public.discord_scheduled_messages(
 id uuid primary key default gen_random_uuid(),guild_id text not null,channel_id text not null,content text not null check(length(content) between 1 and 1800),
 scheduled_at timestamptz not null,requested_by uuid not null references public.profiles(id),status text not null default 'queued' check(status in ('queued','running','sent','failed','uncertain','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3),started_at timestamptz,finished_at timestamptz,message_id text,error_code text,created_at timestamptz not null default now()
);
create index discord_scheduled_due on public.discord_scheduled_messages(scheduled_at) where status='queued';
create index discord_scheduled_guild on public.discord_scheduled_messages(guild_id,created_at desc);
alter table public.discord_scheduled_messages enable row level security;
revoke all on public.discord_scheduled_messages from public,anon,authenticated;
grant select on public.discord_scheduled_messages to authenticated;
grant all on public.discord_scheduled_messages to service_role;
create policy discord_scheduled_admin_read on public.discord_scheduled_messages for select to authenticated using((select public.is_admin()));
create or replace function public.discord_claim_scheduled_messages() returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 update discord_scheduled_messages set status='uncertain',error_code='WORKER_INTERRUPTED',finished_at=now() where status='running' and started_at<now()-interval '5 minutes';
 with selected as(select id from discord_scheduled_messages where status='queued' and scheduled_at<=now() and attempts<3 order by scheduled_at for update skip locked limit 3), claimed as(update discord_scheduled_messages m set status='running',attempts=m.attempts+1,started_at=now() from selected s where m.id=s.id returning m.*)
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;return result;
end;$$;
revoke all on function public.discord_claim_scheduled_messages() from public,anon,authenticated;
grant execute on function public.discord_claim_scheduled_messages() to service_role;
-- Generate a new scoped capability without exposing plaintext in migration output or frontend.
do $$ declare secret text;begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='nexium_discord_scheduler_token';
 if secret is null then secret:=encode(extensions.gen_random_bytes(32),'hex');perform vault.create_secret(secret,'nexium_discord_scheduler_token','Scoped Nexium scheduled-message worker capability');end if;
 insert into public.discord_scheduler_auth(token_hash) values(encode(extensions.digest(secret,'sha256'),'hex')) on conflict do nothing;
end $$;
create or replace function public.discord_scheduler_tick() returns bigint language sql security definer set search_path=public as $$
 select net.http_post(url:='https://flcqndjlzuhmxxahjudj.supabase.co/functions/v1/discord-scheduler',headers:=jsonb_build_object('Content-Type','application/json','X-Nexium-Scheduler-Token',(select decrypted_secret from vault.decrypted_secrets where name='nexium_discord_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=55000);
$$;
revoke all on function public.discord_scheduler_tick() from public,anon,authenticated;
grant execute on function public.discord_scheduler_tick() to service_role;
-- Activation follows deployment/verification; no cron is created until the worker is available.
