create table public.discord_bot_outbox(
 id uuid primary key default gen_random_uuid(),dedupe_key text not null unique,guild_id text not null,kind text not null check(kind in ('dm','log')),
 recipient_id text,channel_id text,content text not null check(length(content) between 1 and 1800),
 status text not null default 'queued' check(status in ('queued','running','sent','failed','uncertain')),attempts integer not null default 0 check(attempts between 0 and 3),
 message_id text,error_code text,created_at timestamptz not null default now(),started_at timestamptz,finished_at timestamptz,
 check((kind='dm' and recipient_id is not null) or (kind='log' and channel_id is not null))
);
alter table public.discord_bot_outbox enable row level security;
revoke all on public.discord_bot_outbox from public,anon,authenticated;
grant select on public.discord_bot_outbox to authenticated;
grant all on public.discord_bot_outbox to service_role;
create policy discord_bot_outbox_admin_read on public.discord_bot_outbox for select to authenticated using((select public.is_admin()));
create index discord_bot_outbox_queue on public.discord_bot_outbox(created_at) where status='queued';
create or replace function public.discord_claim_outbox() returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 update discord_bot_outbox set status='uncertain',error_code='WORKER_INTERRUPTED',finished_at=now() where status='running' and started_at<now()-interval '5 minutes';
 with selected as(select id from discord_bot_outbox where status='queued' and attempts<3 order by created_at for update skip locked limit 2),claimed as(update discord_bot_outbox o set status='running',attempts=o.attempts+1,started_at=now() from selected s where o.id=s.id returning o.*)
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;return result;
end;$$;
revoke all on function public.discord_claim_outbox() from public,anon,authenticated;
grant execute on function public.discord_claim_outbox() to service_role;
