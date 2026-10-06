import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord,BotError} from '../discord-interactions/api.ts';
export async function sendNotification(db:SupabaseClient,record:any,send=discord){
 let accepted=false;
 try{
  let channelId=record.channel_id;
  if(record.kind==='dm')channelId=(await send('/users/@me/channels','POST',{recipient_id:record.recipient_id})).id;
  else{const channel=await send(`/channels/${channelId}`);if(channel.guild_id!==record.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');}
  const message=await send(`/channels/${channelId}/messages`,'POST',{content:record.content,allowed_mentions:{parse:[]},nonce:record.id.replace(/-/g,'').slice(0,24),enforce_nonce:true});accepted=true;
  checked(await db.from('discord_bot_outbox').update({status:'sent',message_id:message.id,finished_at:new Date().toISOString()}).eq('id',record.id));
 }catch(e){const code=e instanceof BotError?e.code:'INTERNAL_ERROR';await db.from('discord_bot_outbox').update({status:accepted||code==='MUTATION_UNCERTAIN'?'uncertain':code==='DISCORD_RATE_LIMIT'&&record.attempts<3?'queued':'failed',error_code:code,finished_at:new Date().toISOString()}).eq('id',record.id);}
}
