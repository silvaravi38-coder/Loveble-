-- Fase 2: produtos, painéis de venda, pedidos e administradores do painel web.
alter table discord_settings
  add column if not exists orders_channel_id text,
  add column if not exists manual_pix_key text,
  add column if not exists delivery_note text not null default 'Entrega em até 10 horas após a confirmação do pagamento.',
  add column if not exists order_expire_minutes int not null default 30;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists sales_panels (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  name text not null default 'Vendas',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists panel_products (
  panel_id uuid not null references sales_panels(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  primary key (panel_id, product_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  guild_id text not null,
  user_id text not null,
  variant_id uuid not null references product_variants(id),
  product_name text not null,
  variant_name text not null,
  price_cents int not null,
  status text not null default 'pending' check (status in ('pending','paid','delivered','cancelled','expired')),
  pix_charge_id text unique,
  pix_payload text,
  staff_channel_id text,
  staff_message_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  paid_at timestamptz,
  delivered_at timestamptz
);
-- Cliques repetidos não criam pedidos duplicados: um pendente por cliente e plano.
create unique index if not exists orders_one_pending on orders (user_id, variant_id) where status = 'pending';

create table if not exists order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  type text not null,
  actor text not null,
  at timestamptz not null default now()
);

create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table products enable row level security;
alter table product_variants enable row level security;
alter table sales_panels enable row level security;
alter table panel_products enable row level security;
alter table orders enable row level security;
alter table order_events enable row level security;
alter table admin_users enable row level security;
-- Sem políticas: só o servidor (service role) acessa. A checagem de administrador é feita no servidor.
