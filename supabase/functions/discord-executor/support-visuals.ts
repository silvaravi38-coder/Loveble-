import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked} from '../discord-interactions/api.ts';
import {publishPanel} from '../discord-interactions/catalog.ts';
import {refreshTicketCard} from '../discord-interactions/ticket-card.ts';
import {ticketRpc} from '../discord-interactions/tickets.ts';
export async function syncSupportVisuals(db:SupabaseClient,guild:string,actor:string){
 const profile=checked(await db.from('profiles').select('role').eq('id',actor).single());
 if(profile.role!=='admin')throw new BotError('FORBIDDEN');
 const link=checked(await db.from('discord_account_links').select('discord_user_id').eq('profile_id',actor).single());
 const panels=checked(await db.from('discord_sales_panels').select('id,channel_id').eq('guild_id',guild).eq('active',true).eq('panel_kind','tickets').limit(25)) as any[];
 const tickets=checked(await db.from('discord_tickets').select('ticket_id').eq('guild_id',guild).eq('channel_state','ready').is('closed_at',null).is('deleted_at',null).limit(25)) as any[];
 const updatedPanels:string[]=[],updatedTickets:string[]=[],errors:{id:string,code:string}[]=[];
 for(const panel of panels){try{await publishPanel(db,guild,panel.channel_id,actor,panel.id);updatedPanels.push(panel.id);}catch(e){errors.push({id:panel.id,code:e instanceof BotError?e.code:'SYNC_FAILED'});}}
 for(const ticket of tickets){try{await refreshTicketCard(db,await ticketRpc(db,link.discord_user_id,guild,'view',ticket.ticket_id));updatedTickets.push(ticket.ticket_id);}catch(e){errors.push({id:ticket.ticket_id,code:e instanceof BotError?e.code:'SYNC_FAILED'});}}
 return {updated_panels:updatedPanels,updated_tickets:updatedTickets,errors};
}
