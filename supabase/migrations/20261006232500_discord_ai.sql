create table public.discord_ai_settings(
 guild_id text primary key,enabled boolean not null default false,provider text not null default 'gateway' check(provider='gateway'),
 model text not null default 'openai/gpt-6-luna',instructions text not null default '' check(length(instructions)<=4000),
 temperature numeric not null default 0.2 check(temperature between 0 and 2),max_tokens integer not null default 500 check(max_tokens between 100 and 2000),
 delay_seconds integer not null default 2 check(delay_seconds between 0 and 10),hourly_limit integer not null default 20 check(hourly_limit between 1 and 100),
 mode text not null default 'suggest' check(mode in ('suggest','automatic')),updated_by uuid references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.discord_ai_runs(
 id uuid primary key default gen_random_uuid(),guild_id text not null,ticket_id uuid not null references public.support_tickets(id),actor_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('reply','suggest','summary')),status text not null default 'running' check(status in ('running','succeeded','failed','cancelled')),
 result text,error_code text,tokens integer,created_at timestamptz not null default now(),finished_at timestamptz
);
create unique index discord_ai_one_active_ticket on public.discord_ai_runs(ticket_id) where status='running';
create index discord_ai_guild_limit on public.discord_ai_runs(guild_id,created_at desc);
alter table public.discord_ai_settings enable row level security;
alter table public.discord_ai_runs enable row level security;
revoke all on public.discord_ai_settings,public.discord_ai_runs from public,anon,authenticated;
grant select on public.discord_ai_settings,public.discord_ai_runs to authenticated;
grant all on public.discord_ai_settings,public.discord_ai_runs to service_role;
create policy discord_ai_settings_admin_read on public.discord_ai_settings for select to authenticated using((select public.is_admin()));
create policy discord_ai_runs_admin_read on public.discord_ai_runs for select to authenticated using((select public.is_admin()));
create or replace function public.discord_reserve_ai(p_user text,p_guild text,p_ticket uuid,p_kind text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_actor uuid;v_role text;v_settings discord_ai_settings%rowtype;v_ticket support_tickets%rowtype;v_run uuid;
begin
 select p.id,p.role into v_actor,v_role from discord_account_links l join profiles p on p.id=l.profile_id where l.discord_user_id=p_user;
 if v_actor is null then raise exception 'LINK_REQUIRED';end if;
 select * into v_settings from discord_ai_settings where guild_id=p_guild for update;
 if not found or not v_settings.enabled then raise exception 'AI_DISABLED';end if;
 select s.* into v_ticket from support_tickets s join discord_tickets d on d.ticket_id=s.id where s.id=p_ticket and d.guild_id=p_guild and d.closed_at is null for update of s;
 if not found then raise exception 'TICKET_NOT_FOUND';end if;
 if p_kind='reply' then
  if v_ticket.user_id<>v_actor or v_ticket.assigned_to is not null or v_settings.mode<>'automatic' then raise exception 'AI_PAUSED';end if;
 elsif p_kind in ('suggest','summary') then
  if v_role not in ('admin','support') or (v_role<>'admin' and v_ticket.assigned_to is distinct from v_actor) then raise exception 'FORBIDDEN';end if;
 else raise exception 'INVALID_AI_ACTION';end if;
 if (select count(*) from discord_ai_runs where guild_id=p_guild and created_at>now()-interval '1 hour')>=v_settings.hourly_limit then raise exception 'AI_LIMIT_REACHED';end if;
 insert into discord_ai_runs(guild_id,ticket_id,actor_id,kind) values(p_guild,p_ticket,v_actor,p_kind) returning id into v_run;
 return jsonb_build_object('run_id',v_run,'settings',to_jsonb(v_settings),'ticket',to_jsonb(v_ticket),'actor_id',v_actor);
end;$$;
revoke all on function public.discord_reserve_ai(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.discord_reserve_ai(text,text,uuid,text) to service_role;
