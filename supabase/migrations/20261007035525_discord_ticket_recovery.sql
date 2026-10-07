create function public.discord_reconcile_missing_ticket(p_user text,p_guild text,p_ticket uuid,p_channel text,p_reason text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare actor uuid; ticket public.support_tickets%rowtype; mapping public.discord_tickets%rowtype;
begin
 select profile_id into actor from public.discord_account_links where discord_user_id=p_user;
 if actor is null then raise exception 'LINK_REQUIRED';end if;
 perform 1 from public.profiles where id=actor for update;
 select * into ticket from public.support_tickets where id=p_ticket for update;
 select * into mapping from public.discord_tickets where ticket_id=p_ticket and guild_id=p_guild for update;
 if ticket.id is null or mapping.ticket_id is null or ticket.user_id<>actor then raise exception 'FORBIDDEN';end if;
 if mapping.closed_at is not null or mapping.channel_id is distinct from p_channel then return false;end if;
 if p_reason not in ('channel_missing','creation_failed') or p_reason is null or (p_reason='creation_failed' and (mapping.channel_id is not null or mapping.channel_state<>'failed')) or (p_reason='channel_missing' and mapping.channel_id is null) then raise exception 'INVALID_RECOVERY';end if;
 update public.discord_tickets set closed_at=now(),close_reason=case when p_reason='channel_missing' then 'Canal excluído no Discord; registro reconciliado.' else 'A criação do canal falhou; registro reconciliado.' end,resolution_outcome='cancelled',channel_state='failed',deleted_at=case when p_reason='channel_missing' then now() else deleted_at end where ticket_id=p_ticket;
 update public.support_tickets set status='closed',resolved_by=null,resolved_at=null,updated_at=now() where id=p_ticket;
 insert into public.discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild,actor,'ticket_orphan_reconciled',p_ticket::text,jsonb_build_object('reason',p_reason,'channel_id',p_channel));
 return true;
end $$;
revoke all on function discord_reconcile_missing_ticket(text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function discord_reconcile_missing_ticket(text,text,uuid,text,text) to service_role;
