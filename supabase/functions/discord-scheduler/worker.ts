import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {discord,checked,BotError,audit} from '../discord-interactions/api.ts';
import {sendNotification} from './notifications.ts';
import {providerCharge,fulfilPaid} from '../discord-interactions/payments.ts';
import {pollTicketChats} from './ticket-chat.ts';
export async function sendScheduled(db:SupabaseClient,record:any,send=discord){
 try{
  const actor=checked(await db.from('profiles').select('role').eq('id',record.requested_by).maybeSingle());if(actor?.role!=='admin')throw new BotError('REQUESTER_NO_LONGER_ADMIN');
  const channel=await send(`/channels/${record.channel_id}`);if(channel.guild_id!==record.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
  const message=await send(`/channels/${record.channel_id}/messages`,'POST',{content:record.content,allowed_mentions:{parse:[]},nonce:record.id.replace(/-/g,'').slice(0,24),enforce_nonce:true});
  // Store the Discord ID first; an uncertain DB write must never trigger a blind resend.
  const saved=await db.from('discord_scheduled_messages').update({status:'sent',message_id:message.id,finished_at:new Date().toISOString()}).eq('id',record.id).eq('status','running');
  if(saved.error){await db.from('discord_scheduled_messages').update({status:'uncertain',message_id:message.id,error_code:'RESULT_PERSISTENCE_UNCERTAIN'}).eq('id',record.id);return;}
  await audit(db,record.guild_id,record.requested_by,'scheduled_message_sent',record.id,{channel_id:record.channel_id,message_id:message.id});
 }catch(e){const code=e instanceof BotError?e.code:'INTERNAL_ERROR';const retry=code==='DISCORD_RATE_LIMIT'&&record.attempts<3;
  await db.from('discord_scheduled_messages').update({status:retry?'queued':code==='MUTATION_UNCERTAIN'?'uncertain':'failed',error_code:code,scheduled_at:retry?new Date(Date.now()+120000).toISOString():record.scheduled_at,finished_at:new Date().toISOString()}).eq('id',record.id).eq('status','running');}
}
export async function runWorker(db:SupabaseClient){
 const fulfilments=checked(await db.rpc('discord_pending_fulfilments')) as any[];for(const fulfilment of fulfilments){try{await fulfilPaid(db,fulfilment.order_id);}catch{ /* Payment stays confirmed; role/notification delivery can recover later. */ }}
 const outbox=checked(await db.rpc('discord_claim_outbox')) as any[];for(const notification of outbox)await sendNotification(db,notification);
 const records=checked(await db.rpc('discord_claim_scheduled_messages')) as any[];for(const record of records)await sendScheduled(db,record);
 // Expired reservations are released only after the merchant API confirms expiry/cancellation.
 const requests=checked(await db.from('discord_checkout_requests').select('order_id,orders!inner(status)').eq('orders.status','pending').lt('expires_at',new Date().toISOString()).order('expires_at').limit(2)) as any[];
 let reconciled=0;
 for(const request of requests){
  const order=checked(await db.from('orders').select('status').eq('id',request.order_id).single());if(order.status!=='pending')continue;
  const payment=checked(await db.from('payments').select('provider_payment_id').eq('order_id',request.order_id).eq('provider','turbofypay').maybeSingle());if(!payment)continue;
  try{const charge=await providerCharge(payment.provider_payment_id,db,request.order_id);const settled=checked(await db.rpc('discord_settle_payment',{p_payment_id:payment.provider_payment_id,p_charge:charge}));if(settled.paid)await fulfilPaid(db,request.order_id);reconciled++;}catch{ /* Keep reservation until provider truth is available. */ }
 }
 const ticketChats=await pollTicketChats(db);
 return {claimed_notifications:outbox.length,claimed_messages:records.length,reconciled_payments:reconciled,polled_tickets:ticketChats};
}
