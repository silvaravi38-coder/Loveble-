begin;
do $$
declare actor uuid; t uuid; result jsonb; v_lease uuid; n integer; caught boolean;
begin
 select id into actor from profiles where role<>'admin' order by created_at limit 1;
 insert into discord_account_links(profile_id,discord_user_id,discord_username) values(actor,'999999999999999951','chat-fixture') on conflict(profile_id) do update set discord_user_id=excluded.discord_user_id;
 result:=discord_ticket_action('999999999999999951','999999999999999950','open',null,'{"reason":"Chat fixture","interaction_id":"chat-fixture"}');t:=(result->>'ticket_id')::uuid;
 update discord_tickets set channel_id='999999999999999953',card_message_id='999999999999999954',channel_state='ready' where ticket_id=t;
 insert into discord_ai_settings(guild_id,enabled,mode) values('999999999999999950',true,'automatic');
 insert into discord_ticket_chat_cursors(ticket_id,cursor,lease,lease_until) values(t,'999999999999999954',gen_random_uuid(),now()+interval '1 minute') returning lease into v_lease;
 caught:=false;begin perform discord_ingest_ticket_chat(t,gen_random_uuid(),'999999999999999955','[]');exception when others then if sqlerrm='CHAT_LEASE_INVALID' then caught:=true;else raise;end if;end;
 if not caught then raise exception 'wrong lease accepted';end if;
 result:=jsonb_build_array(jsonb_build_object('id','999999999999999955','content','Netflix?','timestamp',now()));
 n:=discord_ingest_ticket_chat(t,v_lease,'999999999999999955',result);if n<>1 then raise exception 'message not imported';end if;
 n:=discord_ingest_ticket_chat(t,v_lease,'999999999999999955',result);if n<>0 then raise exception 'message imported twice';end if;
 if (select count(*) from support_messages where discord_message_id='999999999999999955')<>1 then raise exception 'duplicate transcript';end if;
 update support_tickets set assigned_to=actor where id=t;
 n:=discord_ingest_ticket_chat(t,v_lease,'999999999999999956',jsonb_build_array(jsonb_build_object('id','999999999999999956','content','Oi','timestamp',now())));if n<>0 then raise exception 'claimed ticket consumed';end if;
 if has_function_privilege('authenticated','discord_claim_ticket_chats()','execute') or has_function_privilege('anon','discord_ingest_ticket_chat(uuid,uuid,text,jsonb)','execute') or has_table_privilege('authenticated','discord_ticket_chat_cursors','select') then raise exception 'chat worker public';end if;
end $$;
select 'PASS: private worker leases, message deduplication and claimed-ticket pause; rolled back' as test_result;
rollback;
