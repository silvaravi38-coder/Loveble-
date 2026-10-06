create or replace function public.discord_complete_ai(p_run uuid,p_result text,p_tokens integer) returns boolean language plpgsql security invoker set search_path=public as $$
declare v_run discord_ai_runs%rowtype;v_ticket support_tickets%rowtype;
begin
 select * into v_run from discord_ai_runs where id=p_run for update;if not found or v_run.status<>'running' then raise exception 'AI_RUN_NOT_ACTIVE';end if;
 select * into v_ticket from support_tickets where id=v_run.ticket_id for update;
 if v_run.kind='reply' and (v_ticket.assigned_to is not null or v_ticket.status not in ('open','in_progress')) then update discord_ai_runs set status='cancelled',error_code='STAFF_ASSUMED',finished_at=now() where id=p_run;return false;end if;
 update discord_ai_runs set status='succeeded',result=left(p_result,1800),tokens=p_tokens,finished_at=now() where id=p_run;
 if v_run.kind='reply' then insert into support_messages(ticket_id,sender_id,sender_name,sender_role,message,is_system) values(v_run.ticket_id,null,'Nexium IA','ai',left(p_result,1800),true);end if;
 return true;
end;$$;
revoke all on function public.discord_complete_ai(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.discord_complete_ai(uuid,text,integer) to service_role;
