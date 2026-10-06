create or replace function public.discord_restock(p_discord_user_id text,p_guild_id text,p_product_id uuid,p_units text[],p_interaction_id text) returns integer language plpgsql security invoker set search_path=public as $$
declare v_actor uuid; v_name text;v_quantity int;
begin
 select p.id into v_actor from discord_account_links l join profiles p on p.id=l.profile_id where l.discord_user_id=p_discord_user_id and p.role='admin';if v_actor is null then raise exception 'FORBIDDEN';end if;
 select name into v_name from products where id=p_product_id and active=true for update;if v_name is null then raise exception 'PRODUCT_UNAVAILABLE';end if;
 v_quantity:=coalesce(array_length(p_units,1),0);
 if v_quantity not between 1 and 50 or exists(select from unnest(p_units) u where length(trim(u)) not between 1 and 4000) or (select count(distinct trim(u)) from unnest(p_units) u)<>v_quantity then raise exception 'INVALID_STOCK';end if;
 if exists(select from supplier_stock_items s where s.product_id=p_product_id and s.secret_content=any(p_units)) then raise exception 'DUPLICATE_STOCK';end if;
 if exists(select from discord_audit_events where action='stock_restocked' and details->>'interaction_id'=p_interaction_id) then raise exception 'RESTOCK_ALREADY_APPLIED';end if;
 insert into supplier_stock_items(supplier_id,product_id,label,secret_content,status) select v_actor,p_product_id,v_name||' • '||right(p_interaction_id,8)||'-'||n,trim(u),'available' from unnest(p_units) with ordinality as units(u,n);
 insert into discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild_id,v_actor,'stock_restocked',p_product_id,jsonb_build_object('quantity',v_quantity,'interaction_id',p_interaction_id));
 return v_quantity;
end;$$;
revoke all on function public.discord_restock(text,text,uuid,text[],text) from public,anon,authenticated;
grant execute on function public.discord_restock(text,text,uuid,text[],text) to service_role;
