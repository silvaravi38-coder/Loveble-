-- Nexium Store CMS: settings, banners and admin-managed categories
create table if not exists public.store_settings (
  id text primary key default 'main',
  store_name text not null default 'Nexium Store',
  slogan text not null default 'Seu universo digital em um só lugar.',
  announcement text default 'Problema com algum produto? Fale com o suporte Nexium.',
  hero_title text default 'Seu universo digital em um só lugar.',
  hero_text text default 'Produtos digitais, licenças e serviços autorizados com uma experiência rápida, segura e premium.',
  support_email text,
  support_discord text,
  maintenance_mode boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.store_settings(id) values ('main') on conflict do nothing;
alter table public.store_settings enable row level security;
create policy "public read store settings" on public.store_settings for select using(true);
create policy "admins manage store settings" on public.store_settings for all using(public.is_admin()) with check(public.is_admin());

create policy "admins manage banners" on public.banners for all using(public.is_admin()) with check(public.is_admin());
create policy "admins manage coupons" on public.coupons for all using(public.is_admin()) with check(public.is_admin());
