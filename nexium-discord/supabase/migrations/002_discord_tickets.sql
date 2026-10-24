-- Tickets do Discord. Acesso somente pelo servidor (service role): RLS ligado e sem políticas.
create table if not exists discord_settings (
  guild_id text primary key,
  staff_role_id text,
  log_channel_id text,
  category_id text,
  block_duplicates boolean not null default true,
  auto_delete_minutes int not null default 5,
  hours jsonb not null default '{"1":[["08:00","11:00"],["20:30","22:00"]],"2":[["08:00","11:00"],["20:30","22:00"]],"3":[["08:00","11:00"],["20:30","22:00"]],"4":[["08:00","11:00"],["20:30","22:00"]],"5":[["08:00","11:00"],["20:30","22:00"]],"6":[["10:00","21:00"]]}'
);

create table if not exists ticket_sectors (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  name text not null,
  description text,
  cooldown_seconds int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  guild_id text not null,
  channel_id text unique,
  owner_id text not null,
  sector_id uuid not null references ticket_sectors(id),
  status text not null default 'open' check (status in ('open','claimed','closed')),
  claimed_by text,
  claimed_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  delete_at timestamptz,
  channel_deleted boolean not null default false,
  opened_at timestamptz not null default now()
);
create index if not exists tickets_owner_sector_idx on tickets (owner_id, sector_id, opened_at desc);

create table if not exists ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references tickets(id) on delete cascade,
  type text not null check (type in ('opened','claimed','closed')),
  actor_id text not null,
  at timestamptz not null default now()
);

alter table discord_settings enable row level security;
alter table ticket_sectors enable row level security;
alter table tickets enable row level security;
alter table ticket_events enable row level security;
