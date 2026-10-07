-- Product delivery templates and immutable purchase snapshots are service-only.
create table public.discord_product_fulfilments (
 guild_id text not null, product_id uuid references products(id) on delete cascade,
 kind text not null check(kind in ('role','file')), role_id text, attachment_path text, attachment_name text,
 configured_by uuid not null references profiles(id), updated_at timestamptz not null default now(),
 primary key(guild_id,product_id),
 check((kind='role' and role_id ~ '^[0-9]{17,20}$' and attachment_path is null) or
       (kind='file' and role_id is null and attachment_path is not null and attachment_name is not null))
);
create table public.discord_order_fulfilments (
 order_item_id uuid primary key references order_items(id), order_id uuid not null references orders(id),
 guild_id text not null, discord_user_id text not null, kind text not null check(kind in ('role','file')),
 role_id text, attachment_path text, attachment_name text, configured_by uuid not null references profiles(id),
 status text not null default 'pending' check(status in ('pending','delivered')),
 delivery_id uuid references order_deliveries(id), created_at timestamptz not null default now()
);
create index discord_order_fulfilments_pending on discord_order_fulfilments(order_id) where status='pending';
create table public.discord_store_operations (
 id uuid primary key default gen_random_uuid(), interaction_id text unique not null,
 guild_id text not null, actor_id uuid not null references profiles(id),
 kind text not null check(kind in ('product','config','publish','ai')),
 payload jsonb not null default '{}', status text not null default 'proposed' check(status in ('proposed','applying','done','failed')),
 product_id uuid references products(id), panel_id uuid references discord_sales_panels(id),
 expires_at timestamptz not null default now()+interval '15 minutes', created_at timestamptz not null default now()
);
alter table discord_product_fulfilments enable row level security;
alter table discord_order_fulfilments enable row level security;
alter table discord_store_operations enable row level security;
revoke all on discord_product_fulfilments,discord_order_fulfilments,discord_store_operations from anon,authenticated;
grant all on discord_product_fulfilments,discord_order_fulfilments,discord_store_operations to service_role;

create function public.discord_create_product(p_user text,p_guild text,p_channel text,p_interaction text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare actor uuid; op discord_store_operations%rowtype; prod uuid:=gen_random_uuid(); panel uuid; amount numeric; mode text;
begin
 select p.id into actor from discord_account_links l join profiles p on p.id=l.profile_id where l.discord_user_id=p_user and p.role='admin';
 if actor is null then raise exception 'FORBIDDEN'; end if;
 perform 1 from profiles where id=actor for update;
 select * into op from discord_store_operations where interaction_id=p_interaction;
 if found then
  if op.actor_id<>actor or op.guild_id<>p_guild or op.kind<>'product' then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('product_id',op.product_id,'panel_id',op.panel_id,'existing',true);
 end if;
 amount:=(p_data->>'price')::numeric; mode:=p_data->>'mode';
 if length(trim(p_data->>'name')) not between 2 and 100 or coalesce(length(p_data->>'description'),0)>2000 or amount is null or amount<0.01 or amount>100000 or round(amount,2)<>amount or mode not in ('manual','key') or mode is null then raise exception 'INVALID_PRODUCT'; end if;
 insert into products(id,name,slug,description,price,automatic_delivery,active) values(prod,trim(p_data->>'name'),'discord-'||prod,coalesce(p_data->>'description',''),amount,mode='key',true);
 insert into discord_sales_panels(name,slug,guild_id,channel_id,product_ids,panel_kind,active,created_by,sync_status)
 values(trim(p_data->>'name'),'product-'||prod,p_guild,p_channel,array[prod],'sales',true,actor,'pending') returning id into panel;
 insert into discord_store_operations(interaction_id,guild_id,actor_id,kind,payload,status,product_id,panel_id) values(p_interaction,p_guild,actor,'product','{}','done',prod,panel);
 insert into discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild,actor,'product_created',prod::text,jsonb_build_object('price',amount,'mode',mode,'panel_id',panel));
 return jsonb_build_object('product_id',prod,'panel_id',panel,'existing',false);
end $$;

create function public.discord_complete_product_delivery(p_item uuid) returns boolean
language plpgsql security invoker set search_path=public as $$
declare delivery discord_order_fulfilments%rowtype; ord orders%rowtype; did uuid;
begin
 select o.* into ord from orders o join discord_order_fulfilments f on f.order_id=o.id where f.order_item_id=p_item for update of o;
 if ord.id is null or ord.status not in ('paid','processing','delivered') or not exists(select from payments where order_id=ord.id and status='paid') then raise exception 'ORDER_NOT_PAID'; end if;
 select * into delivery from discord_order_fulfilments where order_item_id=p_item for update;
 if delivery.status='delivered' then return false; end if;
 if delivery.kind='file' and not exists(select from storage.objects where bucket_id='support-files' and name=delivery.attachment_path) then raise exception 'DELIVERY_FILE_MISSING';end if;
 insert into order_deliveries(order_id,order_item_id,delivered_by,delivery_text,attachment_path,attachment_name)
 values(ord.id,p_item,delivery.configured_by,case when delivery.kind='role' then 'Cargo Discord concedido: '||delivery.role_id else 'Arquivo disponível para download na sua conta.' end,delivery.attachment_path,delivery.attachment_name) returning id into did;
 update discord_order_fulfilments set status='delivered',delivery_id=did where order_item_id=p_item;
 if not exists(select from order_items i where i.order_id=ord.id and not exists(select from order_deliveries d where d.order_item_id=i.id)) then update orders set status='delivered',updated_at=now() where id=ord.id; end if;
 return true;
end $$;

create function public.discord_reserve_store_ai(p_user text,p_guild text,p_interaction text) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare actor uuid; settings discord_ai_settings%rowtype;
begin
 select p.id into actor from discord_account_links l join profiles p on p.id=l.profile_id where l.discord_user_id=p_user and p.role='admin'; if actor is null then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('store-ai:'||p_guild,0));
 select * into settings from discord_ai_settings where guild_id=p_guild;
 if settings.guild_id is null or not settings.enabled then raise exception 'AI_DISABLED';end if;
 if (select count(*) from discord_store_operations where guild_id=p_guild and kind='ai' and created_at>now()-interval '1 hour')>=least(settings.hourly_limit,20) then raise exception 'AI_LIMIT_REACHED';end if;
 insert into discord_store_operations(interaction_id,guild_id,actor_id,kind,status) values(p_interaction,p_guild,actor,'ai','applying');
 return jsonb_build_object('model',settings.model,'max_tokens',least(settings.max_tokens,1500));
end $$;
create or replace function public.discord_prepare_checkout(p_interaction_id text,p_discord_user_id text,p_guild_id text,p_channel_id text,p_product_id uuid,p_variant_id uuid default null,p_panel_id uuid default null,p_coupon text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor uuid; product products%rowtype; variant product_variants%rowtype; coupon coupons%rowtype;
  stock supplier_stock_items%rowtype; order_id uuid; item_id uuid; price numeric; discount numeric:=0; prior uuid; full_name text; template discord_product_fulfilments%rowtype;
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
  insert into discord_checkout_requests(interaction_id,order_id,discord_user_id,guild_id,product_id,coupon_id)
    values(p_interaction_id,order_id,p_discord_user_id,p_guild_id,p_product_id,coupon.id);
  if p_variant_id is not null then update product_variants v set stock=v.stock-1 where v.id=p_variant_id; end if;
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

create or replace function public.discord_pending_fulfilments() returns jsonb language sql security invoker set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from(
 select c.order_id from discord_checkout_requests c join orders o on o.id=c.order_id
 where o.status in ('paid','processing','delivered') and (exists(select from discord_order_fulfilments f where f.order_id=o.id and f.status='pending') or 
 not exists(select from discord_audit_events a where a.entity_id=o.id::text and a.action='payment_fulfilled') or (o.status='delivered' and not exists(select from discord_audit_events a where a.entity_id=o.id::text and a.action='delivery_notification_processed')))
 order by o.updated_at limit 2
 ) t;
$$;
revoke all on function public.discord_pending_fulfilments() from public,anon,authenticated;
grant execute on function public.discord_pending_fulfilments() to service_role;
revoke all on function discord_create_product(text,text,text,text,jsonb),discord_complete_product_delivery(uuid),discord_reserve_store_ai(text,text,text) from public,anon,authenticated;
grant execute on function discord_create_product(text,text,text,text,jsonb),discord_complete_product_delivery(uuid),discord_reserve_store_ai(text,text,text) to service_role;

create function public.discord_configure_product_delivery(p_user text,p_guild text,p_product uuid,p_kind text,p_template jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare actor uuid;
begin
 select p.id into actor from discord_account_links l join profiles p on p.id=l.profile_id where l.discord_user_id=p_user and p.role='admin'; if actor is null then raise exception 'FORBIDDEN';end if;
 perform 1 from products where id=p_product and active for update; if not found or p_kind not in ('manual','key','role','file') or p_kind is null then raise exception 'INVALID_PRODUCT';end if;
 if p_kind in ('role','file') then
  if p_kind='file' and not exists(select from storage.objects where bucket_id='support-files' and name=p_template->>'attachment_path') then raise exception 'DELIVERY_FILE_MISSING';end if;
  insert into discord_product_fulfilments(guild_id,product_id,kind,role_id,attachment_path,attachment_name,configured_by) values(p_guild,p_product,p_kind,p_template->>'role_id',p_template->>'attachment_path',p_template->>'attachment_name',actor)
  on conflict(guild_id,product_id) do update set kind=excluded.kind,role_id=excluded.role_id,attachment_path=excluded.attachment_path,attachment_name=excluded.attachment_name,configured_by=actor,updated_at=now();
 else delete from discord_product_fulfilments where guild_id=p_guild and product_id=p_product;end if;
 update products set automatic_delivery=p_kind<>'manual' where id=p_product;
end $$;
revoke all on function discord_configure_product_delivery(text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function discord_configure_product_delivery(text,text,uuid,text,jsonb) to service_role;
