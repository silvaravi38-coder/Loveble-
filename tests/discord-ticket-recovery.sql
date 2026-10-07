begin;
do $$
declare actor uuid; other uuid; result jsonb; ticket uuid; caught boolean;
begin
 select id into actor from profiles where role<>'admin' order by created_at limit 1;
 select id into other from profiles where role='admin' limit 1;
 insert into discord_account_links(profile_id,discord_user_id,discord_username) values(actor,'999999999999999941','recovery-fixture'),(other,'999999999999999942','recovery-other') on conflict(profile_id) do update set discord_user_id=excluded.discord_user_id;
 result:=discord_ticket_action('999999999999999941','999999999999999940','open',null,'{"reason":"Recovery fixture","interaction_id":"recovery-fixture"}');ticket:=(result->>'ticket_id')::uuid;
 update discord_tickets set channel_id='999999999999999943',channel_state='ready' where ticket_id=ticket;
 caught:=false;begin perform discord_reconcile_missing_ticket('999999999999999942','999999999999999940',ticket,'999999999999999943','channel_missing');exception when others then if sqlerrm='FORBIDDEN' then caught:=true;else raise;end if;end;if not caught then raise exception 'other owner reconciled ticket';end if;
 if discord_reconcile_missing_ticket('999999999999999941','999999999999999940',ticket,'999999999999999944','channel_missing') then raise exception 'channel compare failed';end if;
 if not discord_reconcile_missing_ticket('999999999999999941','999999999999999940',ticket,'999999999999999943','channel_missing') then raise exception 'missing channel not reconciled';end if;
 if discord_reconcile_missing_ticket('999999999999999941','999999999999999940',ticket,'999999999999999943','channel_missing') then raise exception 'repeated recovery mutated state';end if;
 if not exists(select from support_tickets where id=ticket and status='closed' and resolved_at is null and resolved_by is null) then raise exception 'recovery counted as resolved';end if;
 result:=discord_ticket_action('999999999999999941','999999999999999940','open',null,'{"reason":"Recovery fixture","interaction_id":"recovery-new-fixture"}');if result->>'ticket_id'=ticket::text then raise exception 'stale ticket reused';end if;
 if has_function_privilege('authenticated','discord_reconcile_missing_ticket(text,text,uuid,text,text)','execute') then raise exception 'recovery public';end if;
end $$;
select 'PASS: owner/guild checks, compare-and-set, idempotent orphan closure, non-resolved payroll status and fresh ticket creation; rolled back' as test_result;
rollback;
