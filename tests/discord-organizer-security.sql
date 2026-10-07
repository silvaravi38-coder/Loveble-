-- All fixtures roll back; no Discord requests or payments are made.
begin;
do $$
declare actor uuid; discord_user text; first_ticket jsonb; repeated_ticket jsonb;
  fixture text:=gen_random_uuid()::text; snapshot uuid;
begin
  select l.profile_id,l.discord_user_id into actor,discord_user from public.discord_account_links l limit 1;
  if actor is null then raise exception 'fixture link required'; end if;
  first_ticket:=public.discord_ticket_action(discord_user,'999999999999999990','open',null,jsonb_build_object('reason','Organizer test '||fixture,'interaction_id','test-'||fixture));
  repeated_ticket:=public.discord_ticket_action(discord_user,'999999999999999990','open',null,jsonb_build_object('reason','Organizer test '||fixture,'interaction_id','repeat-'||fixture));
  if first_ticket->>'ticket_id' is distinct from repeated_ticket->>'ticket_id' or repeated_ticket->>'reused'<>'true' then raise exception 'duplicate ticket detected'; end if;
  if has_function_privilege('anon','public.discord_bind_resource(jsonb)','execute') or has_function_privilege('authenticated','public.discord_bind_resource(jsonb)','execute') then raise exception 'binding RPC exposed'; end if;
  select id into snapshot from public.discord_structure_snapshots limit 1;
  perform public.discord_bind_resource(jsonb_build_object('guild_id','999999999999999990','discord_id','fixture-old-'||fixture,'resource_type','message','logical_key','test:'||fixture,'name','Test','snapshot_id',snapshot,'managed_by_nexium',true));
  perform public.discord_bind_resource(jsonb_build_object('guild_id','999999999999999990','discord_id','fixture-new-'||fixture,'resource_type','message','logical_key','test:'||fixture,'name','Test','snapshot_id',snapshot));
  if (select count(*) from public.discord_resource_mappings where guild_id='999999999999999990' and logical_key='test:'||fixture)<>1 then raise exception 'duplicate logical binding'; end if;
  if not exists(select from public.discord_resource_mappings where discord_id='fixture-old-'||fixture and logical_key is null and managed_by_nexium) then raise exception 'historical mapping lost'; end if;
end $$;
rollback;
