alter table public.discord_tickets add column card_message_id text, add column deleted_at timestamptz;
create table public.discord_ticket_delete_previews (
 id uuid primary key default gen_random_uuid(),ticket_id uuid not null references public.discord_tickets(ticket_id),
 guild_id text not null,channel_id text not null,requested_by uuid not null references public.profiles(id),
 channel_backup jsonb not null,expires_at timestamptz not null default now()+interval '5 minutes',
 status text not null default 'pending' check(status in ('pending','running','completed','uncertain','failed')),
 created_at timestamptz not null default now(),finished_at timestamptz
);
alter table public.discord_ticket_delete_previews enable row level security;
revoke all on public.discord_ticket_delete_previews from public,anon,authenticated;
grant all on public.discord_ticket_delete_previews to service_role;
create policy discord_ticket_delete_backend on public.discord_ticket_delete_previews for all to service_role using(true) with check(true);
