begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role not in ('admin','support') limit 1),true);
insert into public.discord_ai_settings(guild_id) values('rls-fixture');
do $$ declare ord uuid;prod uuid;begin
 insert into public.orders(user_id,status,total,source) values(auth.uid(),'pending',1,'discord') returning id into ord;
 select id into prod from public.products where active=true limit 1;
 insert into public.discord_checkout_requests(interaction_id,order_id,discord_user_id,guild_id,product_id) values('rls-fixture',ord,'999999999999999997','999999999999999990',prod);
end $$;
set local role authenticated;
do $$ begin
 if exists(select from public.discord_ai_settings) or exists(select from public.discord_order_finance) or exists(select from public.discord_checkout_requests) or exists(select from public.discord_ticket_transcripts) or exists(select from public.discord_ai_runs) or exists(select from public.discord_channel_controls) or exists(select from public.discord_scheduled_messages) then raise exception 'customer can read protected bot data';end if;
 if has_function_privilege('authenticated','public.discord_finance_report(uuid,text)','execute') or has_function_privilege('authenticated','public.discord_restock(text,text,uuid,text[],text)','execute') or has_function_privilege('authenticated','public.discord_complete_ai(uuid,text,integer)','execute') or has_function_privilege('authenticated','public.discord_scheduler_tick()','execute') then raise exception 'backend callable by customer';end if;
 if has_table_privilege('authenticated','public.discord_scheduler_auth','select') then raise exception 'scheduler credential readable';end if;
 if has_schema_privilege('authenticated','vault','usage') then if has_table_privilege('authenticated','vault.decrypted_secrets','select') then raise exception 'Vault readable';end if;end if;
end $$;
set local role anon;
do $$ begin
 if not exists(select from public.products where active=true) then raise exception 'public storefront catalog broken';end if;
 if has_function_privilege('anon','public.admin_mark_support_paid(uuid)','execute') or has_function_privilege('anon','public.staff_claim_support_ticket(uuid)','execute') then raise exception 'anonymous staff RPC';end if;
end $$;
reset role;
select 'PASS: customer RLS, backend-only finance/stock/AI/scheduler RPCs, Vault isolation and public catalog access; rolled back' as test_result;
rollback;
