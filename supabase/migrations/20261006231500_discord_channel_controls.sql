create table public.discord_channel_controls(
 id uuid primary key default gen_random_uuid(),guild_id text not null,channel_id text not null,requested_by uuid not null references public.profiles(id),
 action text not null check(action in ('lock','unlock')),status text not null default 'preview' check(status in ('preview','applying','applied','failed','uncertain')),
 backup jsonb not null,planned_overwrites jsonb not null,expires_at timestamptz not null default now()+interval '5 minutes',created_at timestamptz not null default now(),finished_at timestamptz,error_code text,job_id uuid references public.discord_jobs(id)
);
create unique index discord_channel_control_one_active on public.discord_channel_controls(guild_id,channel_id) where status in ('applying','uncertain');
create index discord_channel_controls_history on public.discord_channel_controls(guild_id,channel_id,created_at desc);
alter table public.discord_channel_controls enable row level security;
revoke all on public.discord_channel_controls from public,anon,authenticated;
grant select on public.discord_channel_controls to authenticated;
grant all on public.discord_channel_controls to service_role;
create policy discord_channel_controls_admin_read on public.discord_channel_controls for select to authenticated using((select public.is_admin()));
