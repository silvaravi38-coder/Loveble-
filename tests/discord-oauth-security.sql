begin;
do $$
declare actor uuid; actual uuid; h text := repeat('a',64);
begin
  select id into actor from public.profiles where role='admin' limit 1;
  insert into public.discord_oauth_states(state_hash,profile_id) values(h,actor);
  if public.discord_consume_oauth_state(repeat('b',64)) is not null then raise exception 'wrong state accepted'; end if;
  actual := public.discord_consume_oauth_state(h);
  if actual is distinct from actor then raise exception 'state actor mismatch'; end if;
  if public.discord_consume_oauth_state(h) is not null then raise exception 'state replay accepted'; end if;
  insert into public.discord_oauth_states(state_hash,profile_id,created_at,expires_at) values(repeat('c',64),actor,now()-interval '3 minutes',now()-interval '1 minute');
  if public.discord_consume_oauth_state(repeat('c',64)) is not null then raise exception 'expired state accepted'; end if;
  if has_table_privilege('authenticated','public.discord_oauth_states','SELECT') or has_table_privilege('anon','public.discord_oauth_states','SELECT') then raise exception 'public state read'; end if;
  if has_table_privilege('authenticated','public.discord_account_links','INSERT') or has_table_privilege('authenticated','public.discord_account_links','UPDATE') then raise exception 'client identity forgery'; end if;
  if has_function_privilege('authenticated','public.discord_consume_oauth_state(text)','EXECUTE') or has_function_privilege('anon','public.discord_consume_oauth_state(text)','EXECUTE') then raise exception 'public state claim'; end if;
  if exists(select from pg_class where oid in ('public.discord_account_links'::regclass,'public.discord_oauth_states'::regclass) and not relrowsecurity) then raise exception 'RLS disabled'; end if;
end $$;
select 'PASS: OAuth wrong state, expiry, replay, authenticated actor binding, RLS and grants; fixtures rolled back' as test_result;
rollback;
