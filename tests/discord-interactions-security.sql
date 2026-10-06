begin;
do $$
begin
  if exists(select from pg_class where oid in ('public.discord_runtime_configs'::regclass,'public.discord_interaction_events'::regclass) and not relrowsecurity) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.discord_runtime_configs','SELECT') or has_table_privilege('authenticated','public.discord_runtime_configs','INSERT') then raise exception 'runtime client grant'; end if;
  if has_table_privilege('authenticated','public.discord_interaction_events','INSERT') or has_table_privilege('anon','public.discord_interaction_events','SELECT') then raise exception 'event client grant'; end if;
  insert into public.discord_interaction_events(interaction_id,guild_id,discord_user_id,action) values('test-interaction','test-guild','test-user','orders');
  begin
    insert into public.discord_interaction_events(interaction_id,guild_id,discord_user_id,action) values('test-interaction','test-guild','test-user','orders');
    raise exception 'replay accepted';
  exception when unique_violation then null;
  end;
end $$;
select 'PASS: interaction replay uniqueness, RLS and client grants; fixtures rolled back' as test_result;
rollback;
