-- Nexium Store: prepara pedidos de visitante sem liberar escrita publica.
-- O pedido real sera criado por backend seguro quando o pagamento for integrado.

alter table public.orders alter column user_id drop not null;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_email text;
alter table public.orders add column if not exists customer_discord text;

alter table public.order_items add column if not exists variant_id uuid references public.product_variants(id) on delete set null;
alter table public.order_items add column if not exists variant_name text;

create index if not exists orders_customer_email_idx on public.orders (lower(customer_email));
create index if not exists order_items_variant_id_idx on public.order_items (variant_id);

-- Mantemos RLS ativa. Nenhuma policy publica de INSERT e criada aqui.
-- Quando o gateway PIX for conectado, uma Edge Function/backend validara
-- produto, variacao, estoque e preco no banco antes de criar o pedido.
