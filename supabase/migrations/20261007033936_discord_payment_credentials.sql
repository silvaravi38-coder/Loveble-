create table public.discord_payment_credentials (
 id uuid primary key default gen_random_uuid(), guild_id text not null,
 client_id_secret uuid not null, client_secret_secret uuid not null,
 active boolean not null default true, configured_by uuid not null references profiles(id),
 interaction_id text unique not null, created_at timestamptz not null default now()
);
create unique index discord_payment_credentials_current on discord_payment_credentials(guild_id) where active;
alter table discord_payment_credentials enable row level security;
revoke all on discord_payment_credentials from public,anon,authenticated;
grant all on discord_payment_credentials to service_role;
alter table discord_checkout_requests add column credential_id uuid references discord_payment_credentials(id);
create function public.discord_snapshot_payment_credentials() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 select id into new.credential_id from public.discord_payment_credentials where guild_id=new.guild_id and active;
 return new;
end $$;
revoke all on function discord_snapshot_payment_credentials() from public,anon,authenticated;
grant execute on function discord_snapshot_payment_credentials() to service_role;
create trigger discord_checkout_credentials before insert on discord_checkout_requests for each row execute function discord_snapshot_payment_credentials();

create function public.discord_save_payment_credentials(p_user text,p_guild text,p_interaction text,p_client_id text,p_secret text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare actor uuid; version uuid:=gen_random_uuid(); id_secret uuid; secret_secret uuid; prior public.discord_payment_credentials%rowtype;
begin
 select p.id into actor from public.discord_account_links l join public.profiles p on p.id=l.profile_id where l.discord_user_id=p_user and p.role='admin';if actor is null then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-config:'||p_guild,0));
 select * into prior from public.discord_payment_credentials where interaction_id=p_interaction;
 if found then if prior.guild_id<>p_guild or prior.configured_by<>actor then raise exception 'FORBIDDEN';end if;return prior.id;end if;
 if p_client_id is null or p_secret is null or length(p_client_id) not between 8 and 512 or length(p_secret) not between 8 and 512 or p_client_id ~ '[[:space:]]' or p_secret ~ '[[:space:]]' then raise exception 'INVALID_PAYMENT_CREDENTIALS';end if;
 id_secret:=vault.create_secret(p_client_id,'discord-pix-id-'||version,'Nexium Discord Pix credential');
 secret_secret:=vault.create_secret(p_secret,'discord-pix-secret-'||version,'Nexium Discord Pix credential');
 update public.discord_payment_credentials set active=false where guild_id=p_guild and active;
 insert into public.discord_payment_credentials(id,guild_id,client_id_secret,client_secret_secret,configured_by,interaction_id) values(version,p_guild,id_secret,secret_secret,actor,p_interaction);
 insert into public.discord_audit_events(guild_id,actor_id,action,entity_id) values(p_guild,actor,'payment_credentials_configured',version::text);
 return version;
end $$;
create function public.discord_get_payment_credentials(p_guild text default null,p_order uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare version uuid; creds public.discord_payment_credentials%rowtype; cid text; csecret text;
begin
 if p_order is not null then select credential_id into version from public.discord_checkout_requests where order_id=p_order;
 else select id into version from public.discord_payment_credentials where guild_id=p_guild and active;end if;
 if version is null then return null;end if;
 select * into creds from public.discord_payment_credentials where id=version;
 select decrypted_secret into cid from vault.decrypted_secrets where id=creds.client_id_secret;
 select decrypted_secret into csecret from vault.decrypted_secrets where id=creds.client_secret_secret;
 if cid is null or csecret is null then raise exception 'PAYMENT_NOT_CONFIGURED';end if;
 return jsonb_build_object('id',cid,'secret',csecret);
end $$;
revoke all on function discord_save_payment_credentials(text,text,text,text,text),discord_get_payment_credentials(text,uuid) from public,anon,authenticated;
grant execute on function discord_save_payment_credentials(text,text,text,text,text),discord_get_payment_credentials(text,uuid) to service_role;
