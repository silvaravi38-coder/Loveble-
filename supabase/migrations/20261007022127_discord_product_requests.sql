create table public.discord_product_requests(
 id uuid primary key default gen_random_uuid(),interaction_id text not null unique,guild_id text not null,discord_user_id text not null,
 product_name text not null check(length(product_name) between 3 and 100),description text not null check(length(description) between 3 and 800),reference_url text,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),created_at timestamptz not null default now()
);
alter table public.discord_product_requests enable row level security;
revoke all on public.discord_product_requests from public,anon,authenticated;
grant select on public.discord_product_requests to authenticated;
grant all on public.discord_product_requests to service_role;
create policy discord_product_requests_admin_read on public.discord_product_requests for select to authenticated using((select public.is_admin()));
create index discord_product_requests_cooldown on public.discord_product_requests(guild_id,discord_user_id,created_at desc);
create function public.discord_submit_product_request(p_interaction text,p_guild text,p_user text,p_name text,p_description text,p_reference text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing uuid;request_id uuid;destination text;
begin
 if p_interaction !~ '^[0-9]{17,20}$' or p_guild !~ '^[0-9]{17,20}$' or p_user !~ '^[0-9]{17,20}$' then raise exception 'INVALID_ID';end if;
 if p_reference is not null and (length(p_reference)>300 or p_reference !~ '^https?://') then raise exception 'INVALID_REFERENCE_URL';end if;
 perform pg_advisory_xact_lock(hashtextextended('product-request:'||p_guild||':'||p_user,0));
 select id into existing from public.discord_product_requests where interaction_id=p_interaction and guild_id=p_guild and discord_user_id=p_user;
 if existing is not null then return existing;end if;
 if exists(select from public.discord_product_requests where guild_id=p_guild and discord_user_id=p_user and created_at>now()-interval '3 minutes') then raise exception 'REQUEST_COOLDOWN';end if;
 select discord_id into destination from public.discord_resource_mappings where guild_id=p_guild and resource_type='channel' and logical_key='channel:vendas';
 if destination is null then raise exception 'ADMIN_CHANNEL_REQUIRED';end if;
 insert into public.discord_product_requests(interaction_id,guild_id,discord_user_id,product_name,description,reference_url) values(p_interaction,p_guild,p_user,trim(p_name),trim(p_description),p_reference) returning id into request_id;
 insert into public.discord_bot_outbox(dedupe_key,guild_id,kind,channel_id,content) values('product-request:'||request_id,p_guild,'log',destination,'📦 Solicitação de produto #'||left(request_id::text,8)||E'\nCliente Discord: '||p_user||E'\nProduto: '||p_name||E'\nDescrição: '||p_description||case when p_reference is not null then E'\nReferência: '||p_reference else '' end);
 return request_id;
end $$;
revoke all on function public.discord_submit_product_request(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.discord_submit_product_request(text,text,text,text,text,text) to service_role;
