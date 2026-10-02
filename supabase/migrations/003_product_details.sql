-- Product detail features: variants, reviews and richer product information.
alter table public.products add column if not exists requirements text;
alter table public.products add column if not exists warranty_policy text;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null check(price>=0),
  stock integer not null default 0 check(stock>=0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text,
  rating integer not null check(rating between 1 and 5),
  comment text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.product_variants enable row level security;
alter table public.product_reviews enable row level security;

create policy "public read active variants" on public.product_variants for select using(active=true);
create policy "public read approved reviews" on public.product_reviews for select using(approved=true);
create policy "admins manage variants" on public.product_variants for all using(public.is_admin()) with check(public.is_admin());
create policy "admins manage reviews" on public.product_reviews for all using(public.is_admin()) with check(public.is_admin());
