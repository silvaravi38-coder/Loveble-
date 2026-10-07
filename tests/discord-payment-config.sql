begin;
do $$
declare admin uuid; customer uuid; v1 uuid; v2 uuid; prod uuid; ord uuid; result jsonb; value jsonb; caught boolean;
begin
 select id into admin from public.profiles where role='admin' limit 1;
 select id into customer from public.profiles where id<>admin order by created_at limit 1;
 insert into discord_account_links(profile_id,discord_user_id,discord_username) values(admin,'999999999999999962','payment-admin'),(customer,'999999999999999961','payment-customer') on conflict(profile_id) do update set discord_user_id=excluded.discord_user_id;
 caught:=false;begin perform discord_save_payment_credentials('999999999999999961','999999999999999960','fixture-denied','TEST-CLIENT-ID','TEST-CLIENT-SECRET');exception when others then if sqlerrm='FORBIDDEN' then caught:=true;else raise;end if;end;if not caught then raise exception 'customer saved payment keys';end if;
 v1:=discord_save_payment_credentials('999999999999999962','999999999999999960','fixture-save-payment','TEST-CLIENT-ID','TEST-CLIENT-SECRET');
 if discord_save_payment_credentials('999999999999999962','999999999999999960','fixture-save-payment','DIFFERENT-CLIENT-ID','DIFFERENT-SECRET')<>v1 then raise exception 'configuration replay created new version';end if;
 if exists(select from vault.secrets s join discord_payment_credentials c on s.id=c.client_secret_secret where c.id=v1 and s.secret::text like '%TEST-CLIENT-SECRET%') then raise exception 'credential not encrypted';end if;
 insert into products(name,slug,price,automatic_delivery,active) values('Credential fixture','credential-fixture-'||gen_random_uuid(),1,false,true) returning id into prod;
 result:=discord_prepare_checkout('fixture-payment-order','999999999999999961','999999999999999960','999999999999999963',prod);ord:=(result->>'order_id')::uuid;
 if (select credential_id from discord_checkout_requests where order_id=ord) is distinct from v1 then raise exception 'credential not snapshotted';end if;
 v2:=discord_save_payment_credentials('999999999999999962','999999999999999960','fixture-rotate-payment','SECOND-CLIENT-ID','SECOND-CLIENT-SECRET');
 value:=discord_get_payment_credentials('999999999999999960',ord);if value->>'secret'<>'TEST-CLIENT-SECRET' then raise exception 'rotation broke old order';end if;
 value:=discord_get_payment_credentials('999999999999999960',null);if value->>'secret'<>'SECOND-CLIENT-SECRET' then raise exception 'new config not active';end if;
 if exists(select from discord_audit_events where action='payment_credentials_configured' and guild_id='999999999999999960' and details::text like '%CLIENT%') then raise exception 'audit contains credentials';end if;
 if has_table_privilege('authenticated','discord_payment_credentials','select') or has_function_privilege('authenticated','discord_get_payment_credentials(text,uuid)','execute') or has_function_privilege('anon','discord_save_payment_credentials(text,text,text,text,text)','execute') then raise exception 'credentials publicly readable';end if;
end $$;
select 'PASS: admin-only configuration, encrypted Vault storage, idempotent replay, immutable checkout credentials, safe rotation, secret-free audit and backend-only reads; rolled back' as test_result;
rollback;
