begin;
do $$
declare oid uuid:=gen_random_uuid(); iid uuid:=gen_random_uuid(); pid uuid; actor uuid; did text; guild text; added integer; result jsonb;
begin
 select l.profile_id,l.discord_user_id,s.guild_id into actor,did,guild from discord_account_links l join profiles p on p.id=l.profile_id cross join discord_bot_settings s where p.role='admin' limit 1;
 select id into pid from products where automatic_delivery=false limit 1;
 if pid is null then raise exception 'NO_MANUAL_PRODUCT_FOR_TEST';end if;
 insert into orders(id,user_id,status,total) values(oid,actor,'paid',1);
 insert into order_items(id,order_id,product_id,product_name,unit_price,quantity) values(iid,oid,pid,'SQL rollback test',0.5,2);
 insert into discord_checkout_requests(interaction_id,order_id,discord_user_id,guild_id,product_id,expires_at) values('rollback-'||oid,oid,did,guild,pid,now()+interval '1 hour');
 insert into payments(order_id,provider,status,amount,paid_at) values(oid,'rollback-test','paid',1,now());
 added:=discord_queue_manual_alerts();if added<>1 then raise exception 'INITIAL_ALERT_COUNT %',added;end if;
 added:=discord_queue_manual_alerts();if added<>0 then raise exception 'DUPLICATE_ALERT';end if;
 update payments set paid_at=now()-interval '9 hours 1 minute' where order_id=oid;
 added:=discord_queue_manual_alerts();if added<>1 then raise exception 'DEADLINE_ALERT_COUNT %',added;end if;
 begin perform discord_finish_manual_order('000000000000000000',guild,oid);raise exception 'AUTHORIZATION_BYPASS';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform discord_finish_manual_order(did,'000000000000000000',oid);raise exception 'GUILD_BYPASS';exception when others then if sqlerrm<>'ORDER_NOT_FOUND' then raise;end if;end;
 update orders set status='pending' where id=oid;
 begin perform discord_finish_manual_order(did,guild,oid);raise exception 'PAYMENT_BYPASS';exception when others then if sqlerrm<>'ORDER_NOT_PAID' then raise;end if;end;
 update orders set status='paid' where id=oid;
 result:=discord_finish_manual_order(did,guild,oid);if (result->>'already_delivered')::boolean then raise exception 'NOT_DELIVERED';end if;
 result:=discord_finish_manual_order(did,guild,oid);if not (result->>'already_delivered')::boolean then raise exception 'NOT_IDEMPOTENT';end if;
 if (select count(*) from order_deliveries where order_id=oid)<>1 then raise exception 'DUPLICATE_DELIVERY';end if;
 if (select status from orders where id=oid)<>'delivered' then raise exception 'ORDER_STATUS_WRONG';end if;
end;$$;
rollback;
select 'passed: alert, deduplication, deadline, authorization, guild, payment, delivery, idempotency; fixtures rolled back' as result;
