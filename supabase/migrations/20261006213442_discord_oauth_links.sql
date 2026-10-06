create table public.discord_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '5 minutes',
  consumed_at timestamptz,
  check (expires_at <= created_at+interval '5 minutes')
);
create table public.discord_account_links (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  discord_user_id text not null unique check (discord_user_id ~ '^[0-9]{17,20}$'),
  discord_username text not null,
  verified_at timestamptz not null default now()
);
alter table public.discord_oauth_states enable row level security;
alter table public.discord_account_links enable row level security;
revoke all on public.discord_oauth_states,public.discord_account_links from anon,authenticated;
grant all on public.discord_oauth_states,public.discord_account_links to service_role;
grant select on public.discord_account_links to authenticated;
create policy discord_oauth_backend on public.discord_oauth_states for all to service_role using (true) with check (true);
create policy discord_links_backend on public.discord_account_links for all to service_role using (true) with check (true);
create policy discord_links_owner_read on public.discord_account_links for select to authenticated using (profile_id=auth.uid() or public.is_admin());

create function public.discord_consume_oauth_state(p_state_hash text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare actor uuid;
begin
  update public.discord_oauth_states set consumed_at=now()
  where state_hash=p_state_hash and consumed_at is null and expires_at>now()
  returning profile_id into actor;
  return actor;
end $$;
revoke all on function public.discord_consume_oauth_state(text) from public,anon,authenticated;
grant execute on function public.discord_consume_oauth_state(text) to service_role;
