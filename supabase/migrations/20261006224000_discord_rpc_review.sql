create or replace function public.discord_prepare_checkout(p_interaction_id text,p_discord_user_id text,p_guild_id text,p_channel_id text,p_product_id uuid,p_variant_id uuid default null,p_panel_id uuid default null,p_coupon text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor uuid; product products%rowtype; variant product_variants%rowtype; coupon coupons%rowtype;
  stock supplier_stock_items%rowtype; order_id uuid; item_id uuid; price numeric; discount numeric:=0; prior uuid; full_name text;
begin
  select l.profile_id into actor from discord_account_links l where l.discord_user_id=p_discord_user_id;
  if actor is null then raise exception 'LINK_REQUIRED'; end if;
  select p.full_name into full_name from profiles p where p.id=actor for update;
  select c.order_id into prior from discord_checkout_requests c where c.interaction_id=p_interaction_id and c.discord_user_id=p_discord_user_id;
  if prior is not null then return jsonb_build_object('order_id',prior,'existing',true); end if;
  if (select count(*) from orders o join discord_checkout_requests c on c.order_id=o.id where o.user_id=actor and o.status='pending' and c.expires_at>now())>=3 then raise exception 'TOO_MANY_PENDING_ORDERS'; end if;
  select * into product from products where id=p_product_id and active for share;
  if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if p_panel_id is not null and not exists(select from discord_sales_panels where id=p_panel_id and active and guild_id=p_guild_id and channel_id=p_channel_id and p_product_id=any(product_ids)) then raise exception 'PANEL_PRODUCT_MISMATCH'; end if;
  price:=product.price;
  if p_variant_id is not null then
    select * into variant from product_variants where id=p_variant_id and product_id=p_product_id and active for update;
    if not found or variant.stock<1 then raise exception 'VARIANT_UNAVAILABLE'; end if;
    price:=variant.price;
  elsif exists(select from product_variants where product_id=p_product_id and active) then raise exception 'VARIANT_REQUIRED'; end if;
  if product.automatic_delivery then
    select * into stock from supplier_stock_items where product_id=p_product_id and status='available' order by created_at for update skip locked limit 1;
    if not found then raise exception 'OUT_OF_STOCK'; end if;
  end if;
  if p_coupon is not null and trim(p_coupon)<>'' then
    select * into coupon from coupons where upper(code)=upper(trim(p_coupon)) and active for update;
    if not found or (coupon.expires_at is not null and coupon.expires_at<=now()) or (coupon.max_uses is not null and coupon.uses_count>=coupon.max_uses) or price<coupon.min_order_value then raise exception 'COUPON_UNAVAILABLE'; end if;
    discount:=case when coupon.discount_type='fixed' then coalesce(coupon.discount_value,0) else price*coalesce(coupon.discount_value,coupon.discount_percent)/100 end;
    discount:=least(price,greatest(0,discount));
  end if;
  if round((price-discount)*100)<1 then raise exception 'INVALID_AMOUNT'; end if;
  insert into orders(user_id,status,total,customer_name,customer_discord,source,source_panel_id,source_channel_id)
    values(actor,'pending',round(price-discount,2),full_name,p_discord_user_id,'discord',p_panel_id,p_channel_id) returning id into order_id;
  insert into order_items(order_id,product_id,product_name,unit_price,quantity,variant_id,variant_name)
    values(order_id,p_product_id,product.name,price,1,p_variant_id,variant.name) returning id into item_id;
  insert into discord_checkout_requests(interaction_id,order_id,discord_user_id,guild_id,product_id,coupon_id)
    values(p_interaction_id,order_id,p_discord_user_id,p_guild_id,p_product_id,coupon.id);
  if p_variant_id is not null then update product_variants v set stock=v.stock-1 where v.id=p_variant_id; end if;
  if stock.id is not null then
    update supplier_stock_items set status='reserved' where id=stock.id;
    insert into discord_stock_reservations(stock_item_id,order_id,order_item_id) values(stock.id,order_id,item_id);
  end if;
  if coupon.id is not null then update coupons set uses_count=uses_count+1 where id=coupon.id; end if;
  insert into discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild_id,actor,'order_created',order_id::text,jsonb_build_object('product_id',p_product_id,'panel_id',p_panel_id,'channel_id',p_channel_id));
  return jsonb_build_object('order_id',order_id,'amount_cents',round((price-discount)*100),'existing',false);
end $$;

create or replace function public.discord_settle_payment(p_payment_id text,p_charge jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare pay payments%rowtype; ord orders%rowtype; request discord_checkout_requests%rowtype; r record; paid boolean;
begin
  select * into pay from payments where provider='turbofypay' and provider_payment_id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into ord from orders where id=pay.order_id for update;
  select * into request from discord_checkout_requests where order_id=ord.id;
  if request.order_id is null then raise exception 'NOT_DISCORD_ORDER'; end if;
  if p_charge->>'id' is distinct from p_payment_id or (p_charge->>'amountCents')::numeric is distinct from round(pay.amount*100) or (p_charge ? 'externalRef' and p_charge->>'externalRef' is not null and p_charge->>'externalRef' is distinct from ord.id::text) then raise exception 'PAYMENT_MISMATCH'; end if;
  paid:=upper(p_charge->>'status')='PAID';
  if pay.status='paid' then return jsonb_build_object('order_id',ord.id,'paid',true,'already_processed',true); end if;
  if paid then
    update payments set status='paid',paid_at=now(),provider_payload=p_charge where id=pay.id;
    if ord.status in ('pending','cancelled') then update orders set status='paid',updated_at=now() where id=ord.id; end if;
    for r in select s.*,v.order_item_id from discord_stock_reservations v join supplier_stock_items s on s.id=v.stock_item_id where v.order_id=ord.id and v.status='reserved' for update of s,v loop
      insert into order_deliveries(order_id,order_item_id,delivery_text,delivered_by) values(ord.id,r.order_item_id,r.secret_content,r.supplier_id);
      update supplier_stock_items set status='used',used_at=now() where id=r.id;
      update discord_stock_reservations set status='used' where stock_item_id=r.id;
    end loop;
    if exists(select from discord_stock_reservations where order_id=ord.id and status='used') then update orders set status='delivered',updated_at=now() where id=ord.id; end if;
    insert into discord_audit_events(guild_id,actor_id,action,entity_id) values(request.guild_id,ord.user_id,'payment_paid',ord.id::text);
  elsif upper(p_charge->>'status') in ('EXPIRED','CANCELLED','CANCELED') and ord.status='pending' then
    update payments set status=lower(p_charge->>'status'),provider_payload=p_charge where id=pay.id;
    update orders set status='cancelled',updated_at=now() where id=ord.id;
    update supplier_stock_items set status='available' where id in(select stock_item_id from discord_stock_reservations where order_id=ord.id and status='reserved');
    update discord_stock_reservations set status='released' where order_id=ord.id and status='reserved';
    update product_variants v set stock=v.stock+1 from order_items i where i.order_id=ord.id and i.variant_id=v.id;
    update coupons set uses_count=greatest(0,uses_count-1) where id=request.coupon_id;
  end if;
  return jsonb_build_object('order_id',ord.id,'paid',paid,'already_processed',false,'discord_user_id',request.discord_user_id,'guild_id',request.guild_id);
end $$;

create or replace function public.discord_ticket_action(p_discord_user_id text,p_guild_id text,p_action text,p_ticket_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare actor uuid; actor_role text; actor_name text; v_ticket support_tickets%rowtype; v_discord discord_tickets%rowtype; target uuid; new_id uuid; stars integer; order_id uuid;
begin
  select p.id,p.role,p.full_name into actor,actor_role,actor_name from profiles p join discord_account_links l on l.profile_id=p.id where l.discord_user_id=p_discord_user_id;
  if actor is null then raise exception 'LINK_REQUIRED'; end if;
  if p_action='open' then
    perform 1 from profiles where id=actor for update;
    if length(trim(p_data->>'reason')) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
    if (select count(*) from discord_tickets dt join support_tickets st on st.id=dt.ticket_id where st.user_id=actor and dt.guild_id=p_guild_id and dt.closed_at is null)>=3 then raise exception 'TOO_MANY_OPEN_TICKETS'; end if;
    order_id:=nullif(p_data->>'order_id','')::uuid;
    if order_id is not null and not exists(select from orders where id=order_id and user_id=actor) then raise exception 'ORDER_NOT_OWNED'; end if;
    insert into support_tickets(user_id,subject,category,request_type,order_id) values(actor,left(p_data->>'reason',200),'discord',coalesce(p_data->>'request_type','other'),order_id) returning id into new_id;
    insert into discord_tickets(ticket_id,guild_id,interaction_id) values(new_id,p_guild_id,p_data->>'interaction_id');
    insert into discord_audit_events(guild_id,actor_id,action,entity_id) values(p_guild_id,actor,'ticket_opened',new_id::text);
    return jsonb_build_object('ticket_id',new_id,'profile_id',actor);
  end if;
  select * into v_ticket from support_tickets where id=p_ticket_id for update;
  select * into v_discord from discord_tickets where ticket_id=p_ticket_id and guild_id=p_guild_id for update;
  if v_ticket.id is null or v_discord.ticket_id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if actor_role not in ('admin','support') and v_ticket.user_id<>actor then raise exception 'FORBIDDEN'; end if;
  if p_action='rate' then
    if v_ticket.user_id<>actor or v_discord.closed_at is null then raise exception 'RATING_NOT_ALLOWED'; end if;
    stars:=(p_data->>'stars')::integer;
    insert into discord_ticket_ratings(ticket_id,profile_id,stars,comment) values(v_ticket.id,actor,stars,left(coalesce(p_data->>'comment',''),1000));
  elsif p_action='message' then
    if v_discord.closed_at is not null or length(trim(p_data->>'message')) not between 1 and 4000 then raise exception 'MESSAGE_NOT_ALLOWED'; end if;
    insert into support_messages(ticket_id,sender_id,sender_name,sender_role,message) values(v_ticket.id,actor,actor_name,actor_role,p_data->>'message');
  elsif p_action in ('view','transcript') then null;
  else
    if actor_role not in ('admin','support') or v_discord.closed_at is not null then raise exception 'FORBIDDEN'; end if;
    if p_action='claim' then
      if v_ticket.assigned_to is not null and v_ticket.assigned_to<>actor and actor_role<>'admin' then raise exception 'ALREADY_ASSIGNED'; end if;
      update support_tickets set assigned_to=actor,status='in_progress',assumed_at=coalesce(assumed_at,now()),updated_at=now() where id=v_ticket.id;
      insert into support_ticket_claims(ticket_id,support_id) values(v_ticket.id,actor) on conflict(ticket_id,support_id) do nothing;
    else
      if actor_role<>'admin' and v_ticket.assigned_to is distinct from actor then raise exception 'CLAIM_REQUIRED'; end if;
      if p_action='transfer' then
        select p.id into target from profiles p join discord_account_links l on l.profile_id=p.id where l.discord_user_id=p_data->>'target' and p.role in ('admin','support');
        if target is null then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
        update support_tickets set assigned_to=target,status='in_progress',assumed_at=now(),updated_at=now() where id=v_ticket.id;
        insert into support_ticket_claims(ticket_id,support_id) values(v_ticket.id,target) on conflict(ticket_id,support_id) do nothing;
      elsif p_action='priority' then update support_tickets set priority=p_data->>'priority',updated_at=now() where id=v_ticket.id;
      elsif p_action='close' then
        if length(trim(p_data->>'reason')) not between 3 and 500 or coalesce(p_data->>'outcome','') not in ('resolved','cancelled','duplicate') then raise exception 'CLOSE_REASON_REQUIRED'; end if;
        update discord_tickets set closed_at=now(),close_reason=p_data->>'reason',resolution_outcome=p_data->>'outcome' where ticket_id=v_ticket.id;
        update support_tickets set status=case when p_data->>'outcome'='resolved' then 'resolved' else 'closed' end,resolved_by=case when p_data->>'outcome'='resolved' then coalesce(assigned_to,actor) else null end,resolved_at=case when p_data->>'outcome'='resolved' then now() else null end,updated_at=now() where id=v_ticket.id;
      elsif p_action not in ('add_member','remove_member') then raise exception 'UNKNOWN_ACTION'; end if;
    end if;
  end if;
  insert into discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild_id,actor,'ticket_'||p_action,v_ticket.id::text,p_data-'message'-'comment');
  return (select jsonb_build_object('ticket',to_jsonb(st),'discord',to_jsonb(dt),'profile_id',actor) from support_tickets st join discord_tickets dt on dt.ticket_id=st.id where st.id=p_ticket_id);
end $$;