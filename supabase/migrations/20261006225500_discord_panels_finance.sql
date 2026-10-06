alter table public.discord_sales_panels add column if not exists panel_kind text not null default 'sales' check(panel_kind in ('sales','tickets'));
create table if not exists public.discord_order_finance (
 order_id uuid primary key references public.orders(id),
 cost numeric(12,2) not null check(cost>=0),fee numeric(12,2) not null check(fee>=0),
 note text not null check(length(note) between 3 and 500),updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
alter table public.discord_order_finance enable row level security;
create policy discord_order_finance_admin_read on public.discord_order_finance for select to authenticated using(public.is_admin());
revoke all on public.discord_order_finance from anon,authenticated;
grant select on public.discord_order_finance to authenticated;
grant all on public.discord_order_finance to service_role;
create or replace function public.discord_finance_report(p_actor_id uuid,p_period text default 'total') returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_start timestamptz;v_result jsonb;
begin
 if not exists(select 1 from profiles where id=p_actor_id and role='admin') then raise exception 'FORBIDDEN';end if;
 if p_period not in ('today','month','total') then raise exception 'INVALID_PERIOD';end if;
 v_start:=case p_period when 'today' then date_trunc('day',now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza' when 'month' then date_trunc('month',now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza' else null end;
 with selected as (select o.*,f.cost,f.fee from orders o left join discord_order_finance f on f.order_id=o.id where o.status in ('paid','processing','delivered') and (v_start is null or o.created_at>=v_start)),
 top_products as(select i.product_id,i.product_name,sum(i.quantity) quantity,sum(i.unit_price*i.quantity) gross from order_items i join selected s on s.id=i.order_id group by i.product_id,i.product_name order by sum(i.quantity) desc limit 10)
 select jsonb_build_object('period',p_period,'revenue',coalesce(sum(total),0),'orders',count(*),'average',coalesce(avg(total),0),'site_orders',count(*) filter(where source is distinct from 'discord'),'discord_orders',count(*) filter(where source='discord'),'recorded_costs',coalesce(sum(cost),0),'recorded_fees',coalesce(sum(fee),0),'net_reconciled',coalesce(sum(total-cost-fee) filter(where cost is not null),0),'unreconciled_orders',count(*) filter(where cost is null),'top_products',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from top_products t)) into v_result from selected;
 return v_result;
end;$$;
revoke all on function public.discord_finance_report(uuid,text) from public,anon,authenticated;
grant execute on function public.discord_finance_report(uuid,text) to service_role;
