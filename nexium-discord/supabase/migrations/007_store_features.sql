-- Estoque, cupons, avaliações e relatórios de vendas.
alter table discord_settings
  add column if not exists customer_role_id text,
  add column if not exists reviews_channel_id text;

alter table product_variants
  add column if not exists auto_delivery boolean not null default false,
  add column if not exists low_stock_alert int not null default 3 check (low_stock_alert >= 0);

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  code text not null,
  percent int check (percent between 1 and 100),
  amount_cents int check (amount_cents > 0),
  max_uses int check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((percent is null) <> (amount_cents is null))
);
create unique index if not exists coupons_guild_code_unique on coupons (guild_id, upper(trim(code)));

alter table orders
  add column if not exists coupon_id uuid references coupons(id) on delete set null,
  add column if not exists coupon_code text,
  add column if not exists discount_cents int not null default 0 check (discount_cents >= 0),
  add column if not exists coupon_released boolean not null default false,
  add column if not exists stock_item_id uuid;

create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id) on delete cascade,
  content text not null check (length(content) between 1 and 4000),
  status text not null default 'available' check (status in ('available','reserved','delivered')),
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists stock_items_available_idx on stock_items (variant_id, created_at) where status = 'available';
create unique index if not exists stock_items_one_order_unique on stock_items (order_id) where order_id is not null;
create index if not exists stock_items_order_idx on stock_items (order_id);
alter table orders add constraint orders_stock_item_fk foreign key (stock_item_id) references stock_items(id) on delete set null;

create table if not exists reviews (
  order_id uuid primary key references orders(id) on delete cascade,
  guild_id text not null,
  user_id text not null,
  rating int not null check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

alter table coupons enable row level security;
alter table stock_items enable row level security;
alter table reviews enable row level security;
revoke all on coupons, stock_items, reviews from anon, authenticated;

-- Serializa reservas por pedido, impedindo que dois processos entreguem dois itens.
create or replace function claim_stock(p_variant uuid, p_order uuid)
returns setof stock_items language plpgsql as $$
declare item stock_items%rowtype;
begin
  perform 1 from orders where id = p_order and variant_id = p_variant and status = 'paid' for update;
  if not found then return; end if;

  select * into item from stock_items where order_id = p_order limit 1;
  if found then return next item; return; end if;

  update stock_items set status = 'reserved', order_id = p_order
  where id = (
    select id from stock_items
    where variant_id = p_variant and status = 'available'
    order by created_at, id limit 1 for update skip locked
  ) returning * into item;
  if not found then return; end if;

  update orders set stock_item_id = item.id where id = p_order and stock_item_id is null;
  return next item;
end $$;

-- Incremento é atômico: limite e validade são conferidos junto com o uso.
create or replace function redeem_coupon(p_guild text, p_code text)
returns setof coupons language sql as $$
  update coupons set uses = uses + 1
  where guild_id = p_guild and upper(trim(code)) = upper(trim(p_code)) and active
    and (max_uses is null or uses < max_uses)
    and (expires_at is null or expires_at > now())
  returning *;
$$;

-- Cria o pedido e reserva o uso do cupom na mesma transação.
create or replace function create_order_atomic(
  p_guild text, p_user text, p_variant uuid, p_product_name text, p_variant_name text,
  p_price_cents int, p_expires timestamptz, p_code text default null
) returns setof orders language plpgsql as $$
declare
  coupon coupons%rowtype;
  created orders%rowtype;
  discount int := 0;
begin
  if p_code is not null and length(trim(p_code)) > 0 then
    update coupons set uses = uses + 1
    where guild_id = p_guild and upper(trim(code)) = upper(trim(p_code)) and active
      and (max_uses is null or uses < max_uses)
      and (expires_at is null or expires_at > now())
    returning * into coupon;
    if not found then raise exception 'COUPON_INVALID'; end if;
    if coupon.percent is not null then
      discount := floor((p_price_cents::numeric * coupon.percent) / 100)::int;
    else
      discount := least(coupon.amount_cents, p_price_cents);
    end if;
  end if;

  insert into orders (
    guild_id, user_id, variant_id, product_name, variant_name, price_cents,
    discount_cents, coupon_id, coupon_code, expires_at
  ) values (
    p_guild, p_user, p_variant, p_product_name, p_variant_name, p_price_cents - discount,
    discount, coupon.id, case when p_code is null then null else upper(trim(p_code)) end, p_expires
  ) returning * into created;
  return next created;
end $$;

-- Só devolve o uso uma vez por pedido; chamada repetida é segura.
create or replace function release_coupon(p_order uuid)
returns void language plpgsql as $$
declare coupon uuid;
begin
  update orders set coupon_released = true
    where id = p_order and coupon_id is not null and not coupon_released
    returning coupon_id into coupon;
  if coupon is not null then
    update coupons set uses = greatest(uses - 1, 0) where id = coupon;
  end if;
end $$;

create or replace function stock_counts(p_variants uuid[])
returns table (variant_id uuid, n bigint) language sql stable as $$
  select v.id, count(s.id)::bigint
  from unnest(p_variants) as v(id)
  left join stock_items s on s.variant_id = v.id and s.status = 'available'
  group by v.id;
$$;

create or replace function top_customers(p_guild text, p_limit int)
returns table (cust text, total bigint, n bigint) language sql stable as $$
  select o.user_id, sum(o.price_cents)::bigint, count(*)::bigint
  from orders o where o.guild_id = p_guild and o.status in ('paid','delivered')
  group by o.user_id order by 2 desc limit greatest(1, least(p_limit, 100));
$$;

create or replace function sales_report(p_guild text, p_since timestamptz)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'orders', count(*),
    'sold', count(*) filter (where status in ('paid','delivered')),
    'revenue', coalesce(sum(price_cents) filter (where status in ('paid','delivered')), 0),
    'pending', count(*) filter (where status = 'pending'),
    'lost', count(*) filter (where status in ('cancelled','expired')),
    'top', coalesce((select jsonb_agg(t) from (
      select product_name as product, count(*) as n, sum(price_cents) as total
      from orders where guild_id = p_guild and created_at >= p_since and status in ('paid','delivered')
      group by product_name order by 3 desc limit 5
    ) t), '[]'::jsonb)
  ) from orders where guild_id = p_guild and created_at >= p_since;
$$;

revoke execute on function claim_stock(uuid, uuid), redeem_coupon(text, text), release_coupon(uuid),
  create_order_atomic(text, text, uuid, text, text, int, timestamptz, text),
  stock_counts(uuid[]), top_customers(text, int), sales_report(text, timestamptz)
  from public, anon, authenticated;
grant execute on function claim_stock(uuid, uuid), redeem_coupon(text, text), release_coupon(uuid),
  create_order_atomic(text, text, uuid, text, text, int, timestamptz, text),
  stock_counts(uuid[]), top_customers(text, int), sales_report(text, timestamptz) to service_role;
