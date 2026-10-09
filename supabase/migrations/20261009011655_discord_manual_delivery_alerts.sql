alter table public.discord_bot_outbox add column payload jsonb;
create function public.discord_queue_manual_alerts() returns integer language plpgsql security invoker set search_path=public as $$
declare queued integer;
begin
 with pending as (
 select o.id,r.guild_id,r.discord_user_id,s.channel_logs_id,min(p.paid_at) paid_at,
 jsonb_agg(distinct jsonb_build_object('name',left(i.product_name,100),'quantity',i.quantity)) items
 from orders o join discord_checkout_requests r on r.order_id=o.id
 join discord_bot_settings s on s.guild_id=r.guild_id
 join payments p on p.order_id=o.id and p.status='paid' and p.paid_at is not null
 join order_items i on i.order_id=o.id join products product on product.id=i.product_id
 where o.status in ('paid','processing') and s.channel_logs_id is not null and product.automatic_delivery=false
 and not exists(select from order_deliveries d where d.order_item_id=i.id)
 and not exists(select from discord_order_fulfilments f where f.order_item_id=i.id)
 group by o.id,r.guild_id,r.discord_user_id,s.channel_logs_id
 order by min(p.paid_at) limit 50
 ), notices as (
 select pending.*,stage from pending cross join lateral (select 'received' stage union all select 'deadline' where now()>=paid_at+interval '9 hours') stages
 )
 insert into discord_bot_outbox(dedupe_key,guild_id,kind,channel_id,content,payload)
 select 'manual:'||stage||':'||id,guild_id,'log',channel_logs_id,'Entrega manual pendente',jsonb_build_object('type','manual_delivery','order_id',id,'customer_id',discord_user_id,'paid_at',paid_at,'items',items,'stage',stage)
 from notices on conflict(dedupe_key) do nothing;
 get diagnostics queued=row_count;return queued;
end;$$;
create function public.discord_finish_manual_order(p_user text,p_guild text,p_order uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor uuid; actor_role text; ord orders%rowtype; req discord_checkout_requests%rowtype; item record;
begin
 select l.profile_id,p.role into actor,actor_role from discord_account_links l join profiles p on p.id=l.profile_id where l.discord_user_id=p_user;
 if actor is null or actor_role not in ('admin','support') then raise exception 'FORBIDDEN';end if;
 select * into req from discord_checkout_requests where order_id=p_order and guild_id=p_guild;
 if req.order_id is null then raise exception 'ORDER_NOT_FOUND';end if;
 select * into ord from orders where id=p_order for update;
 if actor_role='support' and not exists(select from support_tickets t join discord_tickets dt on dt.ticket_id=t.id where t.order_id=p_order and t.user_id=ord.user_id and t.assigned_to=actor and dt.guild_id=p_guild and dt.closed_at is null) then raise exception 'CLAIM_REQUIRED';end if;
 if ord.status not in ('paid','processing','delivered') or not exists(select from payments where order_id=p_order and status='paid') then raise exception 'ORDER_NOT_PAID';end if;
 if ord.status='delivered' then return jsonb_build_object('already_delivered',true);end if;
 if not exists(select from order_items where order_id=p_order) or exists(select from order_items i left join products p on p.id=i.product_id where i.order_id=p_order and not exists(select from order_deliveries d where d.order_item_id=i.id) and (coalesce(p.automatic_delivery,true) or exists(select from discord_order_fulfilments f where f.order_item_id=i.id))) then raise exception 'AUTOMATIC_DELIVERY_PENDING';end if;
 for item in select i.id from order_items i where i.order_id=p_order and not exists(select from order_deliveries d where d.order_item_id=i.id) loop
 insert into order_deliveries(order_id,order_item_id,delivered_by,delivery_text) values(p_order,item.id,actor,'Entrega manual concluída pela equipe no Discord.');
 end loop;
 update orders set status='delivered',updated_at=now() where id=p_order;
 insert into discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild,actor,'manual_order_delivered',p_order::text,'{}');
 insert into discord_bot_outbox(dedupe_key,guild_id,kind,recipient_id,content)
 select 'delivery-dm:'||p_order,p_guild,'dm',req.discord_user_id,'✅ Nexium Store • Seu pedido #'||upper(left(p_order::text,8))||' foi marcado como entregue pela equipe. Se precisar de ajuda, fale conosco no ticket.'
 where exists(select from discord_bot_settings where guild_id=p_guild and dm_customer_on_delivery)
 on conflict(dedupe_key) do nothing;
 return jsonb_build_object('already_delivered',false);
end;$$;
revoke all on function public.discord_queue_manual_alerts(),public.discord_finish_manual_order(text,text,uuid) from public,anon,authenticated;
grant execute on function public.discord_queue_manual_alerts(),public.discord_finish_manual_order(text,text,uuid) to service_role;
