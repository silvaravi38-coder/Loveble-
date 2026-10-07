alter table public.support_messages add column discord_message_id text;
create unique index support_message_discord_unique on public.support_messages(discord_message_id) where discord_message_id is not null;
create table public.discord_ticket_chat_cursors(
 ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
 cursor text,lease uuid,lease_until timestamptz,last_polled_at timestamptz,last_error text
);
alter table public.discord_ticket_chat_cursors enable row level security;
revoke all on public.discord_ticket_chat_cursors from public,anon,authenticated;
grant all on public.discord_ticket_chat_cursors to service_role;

create function public.discord_claim_ticket_chats() returns jsonb language plpgsql security invoker set search_path=public as $$
declare r record;v_lease uuid;v_result jsonb:='[]';
begin
 insert into discord_ticket_chat_cursors(ticket_id,cursor)
 select d.ticket_id,d.card_message_id from discord_tickets d join support_tickets s on s.id=d.ticket_id
 join discord_ai_settings a on a.guild_id=d.guild_id
 where d.channel_state='ready' and d.closed_at is null and d.deleted_at is null and d.card_message_id is not null
 and s.status in ('open','in_progress') and s.assigned_to is null and a.enabled and a.mode='automatic'
 on conflict do nothing;
 for r in select c.ticket_id,c.cursor,d.guild_id,d.channel_id,l.discord_user_id
 from discord_ticket_chat_cursors c join discord_tickets d on d.ticket_id=c.ticket_id
 join support_tickets s on s.id=c.ticket_id join discord_account_links l on l.profile_id=s.user_id
 join discord_ai_settings a on a.guild_id=d.guild_id
 where d.channel_state='ready' and d.closed_at is null and d.deleted_at is null and s.status in ('open','in_progress')
 and s.assigned_to is null and a.enabled and a.mode='automatic' and (c.lease_until is null or c.lease_until<now())
 order by c.last_polled_at nulls first,c.ticket_id limit 2 for update of c skip locked
 loop
  v_lease:=gen_random_uuid();
  update discord_ticket_chat_cursors set lease=v_lease,lease_until=now()+interval '3 minutes',last_polled_at=now() where ticket_id=r.ticket_id;
  v_result:=v_result||jsonb_build_array(to_jsonb(r)||jsonb_build_object('lease',v_lease));
 end loop;
 return v_result;
end;$$;

create function public.discord_ingest_ticket_chat(p_ticket uuid,p_lease uuid,p_cursor text,p_messages jsonb) returns integer language plpgsql security invoker set search_path=public as $$
declare c discord_ticket_chat_cursors%rowtype;s support_tickets%rowtype;v_name text;m jsonb;v_count integer:=0;v_inserted integer;
begin
 select * into c from discord_ticket_chat_cursors where ticket_id=p_ticket for update;
 if not found or c.lease is distinct from p_lease or c.lease_until<now() then raise exception 'CHAT_LEASE_INVALID';end if;
 select t.* into s from support_tickets t join discord_tickets d on d.ticket_id=t.id
 join discord_ai_settings a on a.guild_id=d.guild_id where t.id=p_ticket and d.closed_at is null and d.deleted_at is null
 and d.channel_state='ready' and t.status in ('open','in_progress') and t.assigned_to is null and a.enabled and a.mode='automatic' for update of t;
 if not found then return 0;end if;
 if p_cursor is not null and p_cursor!~'^[0-9]{17,20}$' then raise exception 'INVALID_CHAT_CURSOR';end if;
 if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>100 then raise exception 'INVALID_CHAT_MESSAGES';end if;
 select full_name into v_name from profiles where id=s.user_id;
 for m in select value from jsonb_array_elements(p_messages) loop
  if m->>'id' !~'^[0-9]{17,20}$' or length(trim(m->>'content')) not between 1 and 1800 then raise exception 'INVALID_CHAT_MESSAGE';end if;
  if c.cursor is not null and (m->>'id')::numeric<=c.cursor::numeric then continue;end if;
  if p_cursor is null or (m->>'id')::numeric>p_cursor::numeric then raise exception 'INVALID_CHAT_CURSOR';end if;
  insert into support_messages(ticket_id,sender_id,sender_name,sender_role,message,discord_message_id,created_at)
  values(p_ticket,s.user_id,v_name,'customer',m->>'content',m->>'id',(m->>'timestamp')::timestamptz) on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted>0 and (m->>'timestamp')::timestamptz>now()-interval '30 minutes' then v_count:=v_count+1;end if;
 end loop;
 if p_cursor is not null and (c.cursor is null or p_cursor::numeric>c.cursor::numeric) then
  update discord_ticket_chat_cursors set cursor=p_cursor where ticket_id=p_ticket;
 end if;
 return v_count;
end;$$;
revoke all on function public.discord_claim_ticket_chats(),public.discord_ingest_ticket_chat(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.discord_claim_ticket_chats(),public.discord_ingest_ticket_chat(uuid,uuid,text,jsonb) to service_role;
