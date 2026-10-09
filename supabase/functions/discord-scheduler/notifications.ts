import {manualDeliveryCard} from '../discord-interactions/manual-delivery.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord,BotError} from '../discord-interactions/api.ts';
export async function sendNotification(db:SupabaseClient,record:any,send=discord){
 let accepted=false;
 try{
  let channelId=record.channel_id;
  if(record.kind==='dm')channelId=(await send('/users/@me/channels','POST',{recipient_id:record.recipient_id})).id;
  else{const channel=await send(`/channels/${channelId}`);if(channel.guild_id!==record.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');if(record.payload?.type==='manual_delivery'&&!channel.permission_overwrites?.some((o:any)=>o.id===record.guild_id&&(BigInt(o.deny||'0')&1024n)!==0n))throw new BotError('PRIVATE_DELIVERY_CHANNEL_REQUIRED');}
  if(record.payload?.type==='manual_delivery'){const order=checked(await db.from('orders').select('status').eq('id',record.payload.order_id).single());if(!['paid','processing'].includes(order.status)){checked(await db.from('discord_bot_outbox').update({status:'sent',finished_at:new Date().toISOString()}).eq('id',record.id));return;}}
  const payload=record.payload?.type==='manual_delivery'?manualDeliveryCard(record.payload):{content:record.content,allowed_mentions:{parse:[]}};
  const message=await send(`/channels/${channelId}/messages`,'POST',{...payload,nonce:record.id.replace(/-/g,'').slice(0,24),enforce_nonce:true});accepted=true;
  checked(await db.from('discord_bot_outbox').update({status:'sent',message_id:message.id,finished_at:new Date().toISOString()}).eq('id',record.id));
 }catch(e){const code=e instanceof BotError?e.code:'INTERNAL_ERROR';await db.from('discord_bot_outbox').update({status:accepted||code==='MUTATION_UNCERTAIN'?'uncertain':code==='DISCORD_RATE_LIMIT'&&record.attempts<3?'queued':'failed',error_code:code,finished_at:new Date().toISOString()}).eq('id',record.id);}
}
