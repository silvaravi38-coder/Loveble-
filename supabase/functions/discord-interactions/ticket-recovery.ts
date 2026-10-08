import {isTicketChannel,threadMemberAccess} from './ticket-channel.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord} from './api.ts';
export function ownerTicketOverwrite(channel:any,user:string,guild:string,ticket:string){
 if(channel.guild_id!==guild||channel.type!==0||channel.topic!==`Nexium ticket ${ticket}`)throw new BotError('PROTECTED_TICKET_CHANNEL');
 const own=channel.permission_overwrites?.find((o:any)=>o.id===user&&Number(o.type)===1);
 const access=117760n,allow=BigInt(own?.allow||'0'),deny=BigInt(own?.deny||'0');
 if((allow&access)===access&&(deny&access)===0n)return null;
 return {type:1,allow:String(allow|access),deny:String(deny&~access)};
}
export async function checkTicketChannel(db:SupabaseClient,user:string,guild:string,ticket:any,request:typeof discord=discord){
 if(!ticket.channel_id){
  if(ticket.channel_state==='failed')checked(await db.rpc('discord_reconcile_missing_ticket',{p_user:user,p_guild:guild,p_ticket:ticket.ticket_id,p_channel:null,p_reason:'creation_failed'}));
  return;
 }
 let channel;
 try{channel=await request(`/channels/${ticket.channel_id}`);}catch(error){
  // Only a confirmed Discord 404 releases a slot; permission/network errors retain it.
  if(!(error instanceof BotError)||error.code!=='DISCORD_RESOURCE_NOT_FOUND')throw error;
  checked(await db.rpc('discord_reconcile_missing_ticket',{p_user:user,p_guild:guild,p_ticket:ticket.ticket_id,p_channel:ticket.channel_id,p_reason:'channel_missing'}));return;
 }
 if(channel.type===12){if(!isTicketChannel(channel,guild,ticket.ticket_id,ticket.channel_id))throw new BotError('PROTECTED_TICKET_CHANNEL');await threadMemberAccess(channel,user,false,request);return;}
 const repair=ownerTicketOverwrite(channel,user,guild,ticket.ticket_id);
 if(repair)await request(`/channels/${ticket.channel_id}/permissions/${user}`,'PUT',repair);
}
export async function recoverOwnerTickets(db:SupabaseClient,user:string,profile:string,guild:string){
 const tickets=checked(await db.from('discord_tickets').select('ticket_id,channel_id,channel_state,support_tickets!inner(user_id)').eq('guild_id',guild).eq('support_tickets.user_id',profile).is('closed_at',null).limit(10)) as any[];
 for(const ticket of tickets)await checkTicketChannel(db,user,guild,ticket);
}
