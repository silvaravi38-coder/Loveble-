-- Nexium Store support tickets
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  category text not null default 'other',
  status text not null default 'open' check(status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check(char_length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy "users create tickets" on public.support_tickets for insert to authenticated with check(auth.uid()=user_id);
create policy "users read own tickets" on public.support_tickets for select to authenticated using(auth.uid()=user_id or public.is_admin());
create policy "admins update tickets" on public.support_tickets for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "users create ticket messages" on public.support_messages for insert to authenticated with check(sender_id=auth.uid() and exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.user_id=auth.uid() or public.is_admin())));
create policy "users read ticket messages" on public.support_messages for select to authenticated using(exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.user_id=auth.uid() or public.is_admin())));
create index if not exists support_messages_ticket_created_idx on public.support_messages(ticket_id,created_at);
