create or replace function public.discord_pending_fulfilments() returns jsonb language sql security invoker set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from(
 select c.order_id from discord_checkout_requests c join orders o on o.id=c.order_id
 where o.status in ('paid','processing','delivered') and (
 not exists(select from discord_audit_events a where a.entity_id=o.id::text and a.action='payment_fulfilled') or (o.status='delivered' and not exists(select from discord_audit_events a where a.entity_id=o.id::text and a.action='delivery_notification_processed')))
 order by o.updated_at limit 2
 ) t;
$$;
revoke all on function public.discord_pending_fulfilments() from public,anon,authenticated;
grant execute on function public.discord_pending_fulfilments() to service_role;
