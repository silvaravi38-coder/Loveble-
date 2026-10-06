-- Public catalog policies still require is_admin(); remove anonymous access only from staff/supplier RPCs.
do $$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_mark_support_paid','admin_process_supplier_withdrawal','admin_supplier_finance','admin_support_metrics','staff_claim_support_ticket','staff_mark_order_delivered','supplier_deliver_item','supplier_finance_summary','supplier_order_feed','supplier_request_withdrawal') loop
  execute format('revoke execute on function %s from public,anon',fn);execute format('grant execute on function %s to authenticated,service_role',fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('handle_new_user','support_ticket_welcome','touch_support_ticket') loop
  execute format('revoke execute on function %s from public,anon,authenticated',fn);execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;
-- Fix null-role authorization and do not let legacy endpoints reopen closed Discord tickets.
do $$ declare body text;begin
 select pg_get_functiondef('public.admin_mark_support_paid(uuid)'::regprocedure) into body;
 execute replace(body,'if v_role<>''admin'' then','if v_role is distinct from ''admin'' then');
 select pg_get_functiondef('public.staff_claim_support_ticket(uuid)'::regprocedure) into body;
 execute replace(body,'status<>''resolved''' ,'status in (''open'',''in_progress'')');
 select pg_get_functiondef('public.staff_close_support_ticket(uuid)'::regprocedure) into body;
 body:=replace(body,'status<>''resolved''' ,'status in (''open'',''in_progress'')');
 body:=replace(body,'  select assigned_to into v_assigned',E'  if exists(select from public.discord_tickets where ticket_id=p_ticket_id) then raise exception ''Finalize o ticket Discord com /ticket finalizar para registrar motivo, resultado e transcript.'';end if;\n  select assigned_to into v_assigned');
 execute body;
 select pg_get_functiondef('public.admin_support_metrics()'::regprocedure) into body;
 execute replace(body,'t.status<>''resolved''' ,'t.status in (''open'',''in_progress'')');
end $$;
