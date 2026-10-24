-- Histórico do Builder de servidores.
create table if not exists builder_runs (
  id bigint generated always as identity primary key,
  guild_id text not null,
  mode text not null,
  preset text not null,
  actor text not null,
  created int not null default 0,
  updated int not null default 0,
  removed int not null default 0,
  at timestamptz not null default now()
);
alter table builder_runs enable row level security;
