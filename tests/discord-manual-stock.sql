begin;
do $$
declare actor uuid; customer uuid; prod uuid; variant uuid; result jsonb; ord uuid; pay text:=gen_random_uuid()::text; caught boolean;
begin
 select id into actor from profiles where role='admin' limit 1;
 select id into customer from profiles where id<>actor order by created_at limit 1;
 insert into discord_account_links(profile_id,discord_user_id,discord_username) values(actor,'999999999999999932','manual-admin'),(customer,'999999999999999931','manual-customer') on conflict(profile_id) do update set discord_user_id=excluded.discord_user_id;
 insert into products(name,slug,price,active,automatic_delivery) values('Manual fixture','manual-fixture-'||gen_random_uuid(),5,true,true) returning id into prod;
 caught:=false;begin perform discord_set_manual_quantity('999999999999999931','999999999999999930',prod,17);exception when others then if sqlerrm='FORBIDDEN' then caught:=true;else raise;end if;end;if not caught then raise exception 'customer changed manual stock';end if;
 perform discord_set_manual_quantity('999999999999999932','999999999999999930',prod,17);
 if not exists(select from products where id=prod and not automatic_delivery and manual_display_quantity=17) then raise exception 'manual configuration failed';end if;
 insert into product_variants(product_id,name,price,stock,active) values(prod,'Manual plan',5,0,true) returning id into variant;
 result:=discord_prepare_checkout('manual-expired-fixture','999999999999999931','999999999999999930','999999999999999933',prod,variant);ord:=(result->>'order_id')::uuid;
 if exists(select from discord_stock_reservations where order_id=ord) or (select variant_stock_reserved from discord_checkout_requests where order_id=ord) then raise exception 'manual reserved real stock';end if;
 insert into payments(order_id,provider,provider_payment_id,status,amount) values(ord,'turbofypay',pay,'pending',5);
 perform discord_settle_payment(pay,jsonb_build_object('id',pay,'status','EXPIRED','amountCents',500));
 if (select stock from product_variants where id=variant)<>0 then raise exception 'expiration inflated variant stock';end if;
 result:=discord_prepare_checkout('manual-paid-fixture','999999999999999931','999999999999999930','999999999999999933',prod,variant);ord:=(result->>'order_id')::uuid;
 insert into payments(order_id,provider,provider_payment_id,status,amount) values(ord,'turbofypay','paid-'||pay,'pending',5);
 perform discord_settle_payment('paid-'||pay,jsonb_build_object('id','paid-'||pay,'status','PAID','amountCents',500));
 if (select status from orders where id=ord)<>'paid' or exists(select from order_deliveries where order_id=ord) then raise exception 'manual payment faked delivery';end if;
 if (select manual_display_quantity from products where id=prod)<>17 then raise exception 'display quantity changed on checkout';end if;
 perform discord_set_manual_quantity('999999999999999932','999999999999999930',prod,null);
 if (select manual_display_quantity from products where id=prod) is not null then raise exception 'display not cleared';end if;
 if has_function_privilege('authenticated','discord_set_manual_quantity(text,text,uuid,integer)','execute') then raise exception 'manual quantity RPC public';end if;
end $$;
select 'PASS: administrator-only manual quantity, empty variant checkout without keys, no stock inflation on expiration, paid remains manual and display quantity stays informational; rolled back' as test_result;
rollback;
