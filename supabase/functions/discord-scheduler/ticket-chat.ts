import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {discord,checked,BotError,snowflake} from '../discord-interactions/api.ts';
import {ticketAi} from '../discord-interactions/ai.ts';

export function ownerChatMessages(messages:any[],owner:string,after:string|null){
 return messages.filter(m=>snowflake(m.id)&&m.author?.id===owner&&!m.author?.bot&&!m.webhook_id&&[0,19].includes(m.type)&&(!after||BigInt(m.id)>BigInt(after)))
  .sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
}
export async function pollTicketChat(db:SupabaseClient,record:any,send=discord,reply=ticketAi){
 let error:string|null=null,replied=false;
 try{
  const channel=await send(`/channels/${record.channel_id}`);
  if(channel.guild_id!==record.guild_id||channel.type!==0||channel.topic!==`Nexium ticket ${record.ticket_id}`)throw new BotError('WRONG_TICKET_CHANNEL');
  const messages=await send(`/channels/${record.channel_id}/messages?limit=100${record.cursor?`&after=${record.cursor}`:''}`) as any[];
  const owned=ownerChatMessages(messages,record.discord_user_id,record.cursor);
  // Discord redacts content unless Message Content Intent is enabled. Preserve the cursor to recover later.
  if(owned.some(m=>!m.content?.trim()&&!m.attachments?.length&&!m.embeds?.length))throw new BotError('MESSAGE_CONTENT_REQUIRED');
  const last=messages.filter(m=>snowflake(m.id)).sort((a,b)=>BigInt(a.id)<BigInt(b.id)?1:-1)[0]?.id;
  const imported=checked(await db.rpc('discord_ingest_ticket_chat',{p_ticket:record.ticket_id,p_lease:record.lease,p_cursor:last||record.cursor,p_messages:owned.filter(m=>m.content?.trim()).map(m=>({id:m.id,content:m.content.slice(0,1800),timestamp:m.timestamp}))}));
  if(imported>0){await reply(db,record.discord_user_id,record.guild_id,record.ticket_id,'reply');replied=true;}
 }catch(e){error=e instanceof BotError?e.code:'TICKET_CHAT_FAILED';}
 checked(await db.from('discord_ticket_chat_cursors').update({lease:null,lease_until:null,...(error||replied?{last_error:error}:{})}).eq('ticket_id',record.ticket_id).eq('lease',record.lease));
 return error;
}
export async function pollTicketChats(db:SupabaseClient){
 const records=checked(await db.rpc('discord_claim_ticket_chats')) as any[];
 for(const record of records)await pollTicketChat(db,record);
 return records.length;
}
