create or replace function public.discord_ticket_action(p_discord_user_id text,p_guild_id text,p_action text,p_ticket_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare actor uuid; actor_role text; actor_name text; v_ticket support_tickets%rowtype; v_discord discord_tickets%rowtype; target uuid; new_id uuid; stars integer; order_id uuid;
begin
  select p.id,p.role,p.full_name into actor,actor_role,actor_name from profiles p join discord_account_links l on l.profile_id=p.id where l.discord_user_id=p_discord_user_id;
  if actor is null then raise exception 'LINK_REQUIRED'; end if;
  if p_action='open' then
    perform 1 from profiles where id=actor for update;
    if length(trim(p_data->>'reason')) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
    if (select count(*) from discord_tickets dt join support_tickets st on st.id=dt.ticket_id where st.user_id=actor and dt.guild_id=p_guild_id and dt.closed_at is null)>=3 then raise exception 'TOO_MANY_OPEN_TICKETS'; end if;
    order_id:=nullif(p_data->>'order_id','')::uuid;
    if order_id is not null and not exists(select from orders where id=order_id and user_id=actor) then raise exception 'ORDER_NOT_OWNED'; end if;
    insert into support_tickets(user_id,subject,category,request_type,order_id) values(actor,left(p_data->>'reason',200),'discord',coalesce(p_data->>'request_type','other'),order_id) returning id into new_id;
    insert into discord_tickets(ticket_id,guild_id,interaction_id) values(new_id,p_guild_id,p_data->>'interaction_id');
    insert into discord_audit_events(guild_id,actor_id,action,entity_id) values(p_guild_id,actor,'ticket_opened',new_id::text);
    return jsonb_build_object('ticket_id',new_id,'profile_id',actor);
  end if;
  select * into v_ticket from support_tickets where id=p_ticket_id for update;
  select * into v_discord from discord_tickets where ticket_id=p_ticket_id and guild_id=p_guild_id for update;
  if v_ticket.id is null or v_discord.ticket_id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if actor_role not in ('admin','support') and v_ticket.user_id<>actor then raise exception 'FORBIDDEN'; end if;
  if p_action='cancel' then
    if v_ticket.user_id<>actor or v_discord.closed_at is not null or length(trim(p_data->>'reason')) not between 3 and 500 then raise exception 'FORBIDDEN';end if;
    update discord_tickets set closed_at=now(),close_reason=p_data->>'reason',resolution_outcome='cancelled' where ticket_id=v_ticket.id;
    update support_tickets set status='closed',resolved_by=null,resolved_at=null,updated_at=now() where id=v_ticket.id;
  elsif p_action='rate' then
    if v_ticket.user_id<>actor or v_discord.closed_at is null then raise exception 'RATING_NOT_ALLOWED'; end if;
    stars:=(p_data->>'stars')::integer;
    insert into discord_ticket_ratings(ticket_id,profile_id,stars,comment) values(v_ticket.id,actor,stars,left(coalesce(p_data->>'comment',''),1000));
  elsif p_action='message' then
    if v_discord.closed_at is not null or length(trim(p_data->>'message')) not between 1 and 4000 then raise exception 'MESSAGE_NOT_ALLOWED'; end if;
    insert into support_messages(ticket_id,sender_id,sender_name,sender_role,message) values(v_ticket.id,actor,actor_name,actor_role,p_data->>'message');
    if actor_role in ('admin','support') then update support_tickets set first_response_at=coalesce(first_response_at,now()) where id=v_ticket.id;end if;
  elsif p_action in ('view','transcript') then null;
  else
    if actor_role not in ('admin','support') or v_discord.closed_at is not null then raise exception 'FORBIDDEN'; end if;
    if p_action='claim' then
      if v_ticket.assigned_to is not null and v_ticket.assigned_to<>actor and actor_role<>'admin' then raise exception 'ALREADY_ASSIGNED'; end if;
      update support_tickets set assigned_to=actor,status='in_progress',assumed_at=coalesce(assumed_at,now()),updated_at=now() where id=v_ticket.id;
      insert into support_ticket_claims(ticket_id,support_id) values(v_ticket.id,actor) on conflict(ticket_id,support_id) do nothing;
    else
      if actor_role<>'admin' and v_ticket.assigned_to is distinct from actor then raise exception 'CLAIM_REQUIRED'; end if;
      if p_action='transfer' then
        select p.id into target from profiles p join discord_account_links l on l.profile_id=p.id where l.discord_user_id=p_data->>'target' and p.role in ('admin','support');
        if target is null then raise exception 'STAFF_NOT_AUTHORIZED'; end if;
        update support_tickets set assigned_to=target,status='in_progress',assumed_at=now(),updated_at=now() where id=v_ticket.id;
        insert into support_ticket_claims(ticket_id,support_id) values(v_ticket.id,target) on conflict(ticket_id,support_id) do nothing;
      elsif p_action='priority' then update support_tickets set priority=p_data->>'priority',updated_at=now() where id=v_ticket.id;
      elsif p_action='close' then
        if length(trim(p_data->>'reason')) not between 3 and 500 or coalesce(p_data->>'outcome','') not in ('resolved','cancelled','duplicate') then raise exception 'CLOSE_REASON_REQUIRED'; end if;
        update discord_tickets set closed_at=now(),close_reason=p_data->>'reason',resolution_outcome=p_data->>'outcome' where ticket_id=v_ticket.id;
        update support_tickets set status=case when p_data->>'outcome'='resolved' then 'resolved' else 'closed' end,resolved_by=case when p_data->>'outcome'='resolved' then coalesce(assigned_to,actor) else null end,resolved_at=case when p_data->>'outcome'='resolved' then now() else null end,updated_at=now() where id=v_ticket.id;
      elsif p_action not in ('add_member','remove_member') then raise exception 'UNKNOWN_ACTION'; end if;
    end if;
  end if;
  insert into discord_audit_events(guild_id,actor_id,action,entity_id,details) values(p_guild_id,actor,'ticket_'||p_action,v_ticket.id::text,p_data-'message'-'comment'-'text');
  return (select jsonb_build_object('ticket',to_jsonb(st),'discord',to_jsonb(dt),'profile_id',actor) from support_tickets st join discord_tickets dt on dt.ticket_id=st.id where st.id=p_ticket_id);
end $$;

do $$ declare body text;begin
 select pg_get_functiondef('public.close_my_support_ticket(uuid)'::regprocedure) into body;
 body:=replace(body,'  select assigned_to into v_support',E'  if exists(select from public.discord_tickets where ticket_id=p_ticket_id) then raise exception ''Cancele seu atendimento Discord com /ticket cancelar para guardar motivo e transcript.'';end if;\n  select assigned_to into v_support');
 body:=replace(body,'status<>''resolved''','status in (''open'',''in_progress'')');
 body:=replace(body,'status=''resolved''','status=''closed''');body:=replace(body,'resolved_at=now()','resolved_at=null');body:=replace(body,'resolved_by=v_support','resolved_by=null');execute body;
end $$;
