-- Execute no SQL Editor do Supabase depois da migração inicial.
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
create policy "admins manage products" on public.products for all using(public.is_admin()) with check(public.is_admin());
create policy "admins manage categories" on public.categories for all using(public.is_admin()) with check(public.is_admin());
create policy "admins read all profiles" on public.profiles for select using(public.is_admin());
create policy "admins manage orders" on public.orders for all using(public.is_admin()) with check(public.is_admin());
create policy "admins manage order items" on public.order_items for all using(public.is_admin()) with check(public.is_admin());
create policy "admins manage payments" on public.payments for all using(public.is_admin()) with check(public.is_admin());
create policy "admins manage deliveries" on public.digital_deliveries for all using(public.is_admin()) with check(public.is_admin());
