-- Nexium Store: remaining commerce fields and safe admin capabilities.
-- Additive migration: preserves existing data.

alter table public.product_variants add column if not exists sku text;
create unique index if not exists product_variants_sku_unique
  on public.product_variants (sku) where sku is not null and sku <> '';

alter table public.products add column if not exists how_it_works text;
alter table public.products add column if not exists delivery_time text;
alter table public.products add column if not exists exchange_policy text;
alter table public.products add column if not exists product_terms text;

alter table public.coupons add column if not exists discount_type text not null default 'percent'
  check (discount_type in ('percent','fixed'));
alter table public.coupons add column if not exists discount_value numeric(10,2);
alter table public.coupons add column if not exists max_uses integer;
alter table public.coupons add column if not exists uses_count integer not null default 0;
alter table public.coupons add column if not exists min_order_value numeric(10,2) not null default 0;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check(status in ('pending','paid','processing','delivered','cancelled','refunded'));

create index if not exists orders_user_created_idx on public.orders(user_id,created_at desc);
create index if not exists orders_status_created_idx on public.orders(status,created_at desc);
create index if not exists variants_product_active_idx on public.product_variants(product_id,active);
create index if not exists reviews_product_approved_idx on public.product_reviews(product_id,approved);

-- Public reviews remain read-only. Admin moderation policy already exists.
-- Verified-purchase review submission should be exposed through a secure
-- backend/RPC when order creation and payment confirmation are activated.
