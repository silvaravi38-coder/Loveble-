begin;
do $$ declare request_id uuid;again uuid;blocked boolean=false;begin
 request_id:=public.discord_submit_product_request('999999999999999991','1555045658636062770','999999999999999991','Produto teste','Descrição de teste',null);
 again:=public.discord_submit_product_request('999999999999999991','1555045658636062770','999999999999999991','Produto teste','Descrição de teste',null);
 if request_id<>again then raise exception 'idempotency failed';end if;
 if (select count(*) from public.discord_bot_outbox where dedupe_key='product-request:'||request_id)<>1 then raise exception 'notification missing or duplicate';end if;
 begin perform public.discord_submit_product_request('999999999999999992','1555045658636062770','999999999999999991','Outro produto','Descrição de teste',null);exception when raise_exception then if sqlerrm<>'REQUEST_COOLDOWN' then raise;end if;blocked=true;end;
 if not blocked then raise exception 'cooldown failed';end if;
 if has_function_privilege('authenticated','public.discord_submit_product_request(text,text,text,text,text,text)','EXECUTE') then raise exception 'public RPC access';end if;
 if has_table_privilege('anon','public.discord_product_requests','SELECT') then raise exception 'public data access';end if;
end $$;
set local role authenticated;
do $$ begin if exists(select from public.discord_product_requests) then raise exception 'nonadmin RLS leaked requests';end if;end $$;
reset role;
select 'PASS: cooldown, idempotency, atomic notification, private RPC and RLS' result;
rollback;
