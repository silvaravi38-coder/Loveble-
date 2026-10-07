alter table public.products add column manual_display_quantity integer check(manual_display_quantity between 0 and 999999);
create function public.discord_set_manual_quantity(p_user text,p_guild text,p_product uuid,p_quantity integer) returns void
language plpgsql security invoker set search_path='' as $$
declare actor uuid;
begin
 select p.id into actor from public.discord_account_links l join public.profiles p on p.id=l.profile_id where l.discord_user_id=p_user and p.role='admin';if actor is null then raise exception 'FORBIDDEN';end if;
 if p_quantity is not null and (p_quantity<0 or p_quantity>999999) then raise exception 'INVALID_MANUAL_QUANTITY';end if;
 update public.products set manual_display_quantity=p_quantity,automatic_delivery=false where id=p_product and active;
 if not found then raise exception 'PRODUCT_UNAVAILABLE';end if;
 insert into public.discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild,actor,'manual_quantity_configured',p_product::text,jsonb_build_object('quantity',p_quantity,'delivery','manual','informational',true));
end $$;
revoke all on function discord_set_manual_quantity(text,text,uuid,integer) from public,anon,authenticated;
grant execute on function discord_set_manual_quantity(text,text,uuid,integer) to service_role;

alter table public.discord_checkout_requests add column variant_stock_reserved boolean not null default true;
create or replace function public.discord_prepare_checkout(p_interaction_id text,p_discord_user_id text,p_guild_id text,p_channel_id text,p_product_id uuid,p_variant_id uuid default null,p_panel_id uuid default null,p_coupon text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor uuid; product products%rowtype; variant product_variants%rowtype; coupon coupons%rowtype;
  stock supplier_stock_items%rowtype; order_id uuid; item_id uuid; price numeric; discount numeric:=0; prior uuid; full_name text; template discord_product_fulfilments%rowtype; virtual_manual boolean:=false;
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
  virtual_manual:=not product.automatic_delivery and product.manual_display_quantity is not null;
  price:=product.price;
  if p_variant_id is not null then
    select * into variant from product_variants where id=p_variant_id and product_id=p_product_id and active for update;
    if not found or (variant.stock<1 and not virtual_manual) then raise exception 'VARIANT_UNAVAILABLE'; end if;
    price:=variant.price;
  elsif exists(select from product_variants where product_id=p_product_id and active) then raise exception 'VARIANT_REQUIRED'; end if;
  if product.automatic_delivery then select * into template from discord_product_fulfilments where guild_id=p_guild_id and product_id=p_product_id for share; end if;
  if template.kind='file' and not exists(select from storage.objects where bucket_id='support-files' and name=template.attachment_path) then raise exception 'DELIVERY_FILE_MISSING'; end if;
  if product.automatic_delivery and template.product_id is null then
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
  insert into discord_checkout_requests(interaction_id,order_id,discord_user_id,guild_id,product_id,coupon_id,variant_stock_reserved)
    values(p_interaction_id,order_id,p_discord_user_id,p_guild_id,p_product_id,coupon.id,not virtual_manual);
  if p_variant_id is not null and not virtual_manual then update product_variants v set stock=v.stock-1 where v.id=p_variant_id; end if;
  if template.product_id is not null then
    insert into discord_order_fulfilments(order_item_id,order_id,guild_id,discord_user_id,kind,role_id,attachment_path,attachment_name,configured_by) values(item_id,order_id,p_guild_id,p_discord_user_id,template.kind,template.role_id,template.attachment_path,template.attachment_name,template.configured_by);
  end if;
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
      update discord_stock_reservations set status='used' where stock_item_id=r.id and order_id=ord.id;
    end loop;
    if exists(select from discord_stock_reservations where order_id=ord.id and status='used') then update orders set status='delivered',updated_at=now() where id=ord.id; end if;
    insert into discord_audit_events(guild_id,actor_id,action,entity_id) values(request.guild_id,ord.user_id,'payment_paid',ord.id::text);
  elsif upper(p_charge->>'status') in ('EXPIRED','CANCELLED','CANCELED') and ord.status='pending' then
    update payments set status=lower(p_charge->>'status'),provider_payload=p_charge where id=pay.id;
    update orders set status='cancelled',updated_at=now() where id=ord.id;
    update supplier_stock_items set status='available' where id in(select stock_item_id from discord_stock_reservations where order_id=ord.id and status='reserved');
    update discord_stock_reservations set status='released' where order_id=ord.id and status='reserved';
    update product_variants v set stock=v.stock+1 from order_items i where i.order_id=ord.id and i.variant_id=v.id and request.variant_stock_reserved;
    update coupons set uses_count=greatest(0,uses_count-1) where id=request.coupon_id;
  end if;
  return jsonb_build_object('order_id',ord.id,'paid',paid,'already_processed',false,'discord_user_id',request.discord_user_id,'guild_id',request.guild_id);
end $$;

