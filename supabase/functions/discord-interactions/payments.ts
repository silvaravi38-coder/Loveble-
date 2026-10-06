import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,uuid,actorFor,row,button,linkButton,discord,audit} from './api.ts';
import {privateMessage} from './security.ts';
import {qrAttachment} from './delivery.ts';
export function paymentCredentials() {
 const id=Deno.env.get('TURBOFYPAY_CLIENT_ID'),secret=Deno.env.get('TURBOFYPAY_CLIENT_SECRET');
 if(!id||!secret)throw new BotError('PAYMENT_NOT_CONFIGURED');return {id,secret};
}
export async function webhookProof(orderId:string,secret:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`nexium-discord-payment:${orderId}`))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function sanitiseCharge(charge:any) {return {id:charge.id,status:charge.status,amountCents:charge.amountCents,externalRef:charge.externalRef,pix:charge.pix?{qrCode:charge.pix.qrCode,copyPaste:charge.pix.copyPaste,expiresAt:charge.pix.expiresAt}:undefined};}
export async function providerCharge(id:string) {
 const credentials=paymentCredentials();let response:Response;
 try{response=await fetch(`https://api.turbofypay.com/sellers/pix/${encodeURIComponent(id)}`,{headers:{'x-client-id':credentials.id,'x-client-secret':credentials.secret},signal:AbortSignal.timeout(8000)});}catch{throw new BotError('PAYMENT_PROVIDER_UNAVAILABLE');}
 if(!response.ok)throw new BotError(response.status===401?'PAYMENT_CREDENTIALS_INVALID':'PAYMENT_PROVIDER_UNAVAILABLE');
 return sanitiseCharge(await response.json());
}
export async function fulfilPaid(db:SupabaseClient,orderId:string) {
 const request=checked(await db.from('discord_checkout_requests').select('*').eq('order_id',orderId).single());
 const ord=checked(await db.from('orders').select('user_id,status').eq('id',orderId).single());
 if(!['paid','processing','delivered'].includes(ord.status))return;
 const config=checked(await db.from('discord_bot_settings').select('*').eq('guild_id',request.guild_id).maybeSingle());
 if(config?.grant_customer_role_on_paid&&config.role_customer_id){
  const roles=await discord(`/guilds/${request.guild_id}/roles`),member=await discord(`/guilds/${request.guild_id}/members/1557132199227031552`);
  const target=roles.find((r:any)=>r.id===config.role_customer_id);
  const highest=Math.max(0,...roles.filter((r:any)=>member.roles.includes(r.id)).map((r:any)=>r.position));
  if(!target||target.managed||target.id===request.guild_id||target.position>=highest)throw new BotError('ROLE_HIERARCHY_BLOCKED');
  await discord(`/guilds/${request.guild_id}/members/${request.discord_user_id}/roles/${target.id}`,'PUT');
 }
 const notifications:any[]=[];
 if(config?.dm_customer_on_paid)notifications.push({dedupe_key:`paid-dm:${orderId}`,guild_id:request.guild_id,kind:'dm',recipient_id:request.discord_user_id,content:`Nexium: pagamento confirmado do pedido #${orderId.slice(0,8).toUpperCase()}. Acompanhe o atendimento e a entrega na sua conta. https://nexium-store.vercel.app`});
 if(ord.status==='delivered'&&config?.dm_customer_on_delivery)notifications.push({dedupe_key:`delivery-dm:${orderId}`,guild_id:request.guild_id,kind:'dm',recipient_id:request.discord_user_id,content:`Nexium: entrega disponível do pedido #${orderId.slice(0,8).toUpperCase()}. Acesse sua conta protegida em https://nexium-store.vercel.app`});
 const logChannel=config?.pix_log_channel_id||config?.channel_logs_id;
 if(config?.notify_sale_paid&&logChannel)notifications.push({dedupe_key:`paid-log:${orderId}`,guild_id:request.guild_id,kind:'log',channel_id:logChannel,content:`Nexium • Pedido #${orderId.slice(0,8).toUpperCase()} confirmado pelo provedor. Origem: Discord. Status: ${ord.status}.`});
 if(notifications.length)checked(await db.from('discord_bot_outbox').upsert(notifications,{onConflict:'dedupe_key',ignoreDuplicates:true}));
 if(ord.status==='delivered'){const processed=checked(await db.from('discord_audit_events').select('id').eq('action','delivery_notification_processed').eq('entity_id',orderId).limit(1));if(!processed.length)await audit(db,request.guild_id,ord.user_id,'delivery_notification_processed',orderId);}
 // Delivery is persisted transactionally by settlement, and is available only in the customer's account.
 const prior=await db.from('discord_audit_events').select('id').eq('action','payment_fulfilled').eq('entity_id',orderId).limit(1);
 if(prior.error)throw new BotError('DATABASE_ERROR');
 if(!prior.data?.length)await audit(db,request.guild_id,ord.user_id,'payment_fulfilled',orderId,{delivery_status:ord.status,customer_role_configured:!!config?.role_customer_id});
}
export function pixResponse(orderId:string,payment:any) {
 const copy=String(payment.pix_copy_paste||'');if(!copy||copy.length>1500||copy.includes('`'))throw new BotError('INVALID_PIX_RESPONSE');
 const qr=String(payment.qr_code_url||'');const file=qrAttachment(qr);
 return {...privateMessage(`Pedido #${orderId.slice(0,8).toUpperCase()}\nValor: ${Number(payment.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}\nPIX copia e cola:\n\`\`\`\n${copy}\n\`\`\`\nA entrega só será liberada após confirmação do provedor.`),components:[row([button('Verificar pagamento',`nexium:payment:${orderId}`),linkButton('Minha conta','https://nexium-store.vercel.app')])],...(qr.startsWith('https://')?{embeds:[{title:'QR Code PIX',image:{url:qr}}]}:file?{files:[file],embeds:[{title:'QR Code PIX',image:{url:'attachment://pix.png'}}]}:{})};
}
export async function startPurchase(db:SupabaseClient,input:any,userId:string,productId:string,variantId?:string,panelId?:string,coupon?:string) {
 if(!uuid(productId)||(variantId&&!uuid(variantId))||(panelId&&!uuid(panelId)))throw new BotError('INVALID_ID');
 const settings=checked(await db.from('discord_bot_settings').select('pix_enabled,pix_provider').eq('guild_id',input.guild_id).maybeSingle());if(!settings?.pix_enabled||settings.pix_provider!=='turbofypay')throw new BotError('PAYMENT_DISABLED');
 const credentials=paymentCredentials();
 const prepared=await db.rpc('discord_prepare_checkout',{p_interaction_id:input.id,p_discord_user_id:userId,p_guild_id:input.guild_id,p_channel_id:input.channel_id,p_product_id:productId,p_variant_id:variantId||null,p_panel_id:panelId||null,p_coupon:coupon||null});
 if(prepared.error){const code=String(prepared.error.message);throw new BotError(['OUT_OF_STOCK','VARIANT_UNAVAILABLE','VARIANT_REQUIRED','COUPON_UNAVAILABLE','TOO_MANY_PENDING_ORDERS','LINK_REQUIRED','PANEL_PRODUCT_MISMATCH'].find(c=>code.includes(c))||'CHECKOUT_FAILED');}
 const orderId=prepared.data.order_id;
 let payment=checked(await db.from('payments').select('*').eq('order_id',orderId).eq('provider','turbofypay').maybeSingle());
 if(payment)return pixResponse(orderId,payment);
 const order=checked(await db.from('orders').select('total').eq('id',orderId).single());
 const proof=await webhookProof(orderId,credentials.secret);
 const webhook=`https://flcqndjlzuhmxxahjudj.supabase.co/functions/v1/discord-payment-webhook?order=${orderId}&proof=${proof}`;
 const expiresAt=new Date(Date.now()+1800000).toISOString();let response:Response;
 try{response=await fetch('https://api.turbofypay.com/sellers/pix',{method:'POST',headers:{'Content-Type':'application/json','x-client-id':credentials.id,'x-client-secret':credentials.secret,'x-idempotency-key':orderId},body:JSON.stringify({amountCents:Math.round(Number(order.total)*100),description:`Nexium #${orderId.slice(0,8)}`,externalRef:orderId,expiresAt,metadata:{orderId,source:'discord',panelId:panelId||null,channelId:input.channel_id,productId},webhook_url:webhook}),signal:AbortSignal.timeout(10000)});}catch{throw new BotError('PAYMENT_RESULT_UNCERTAIN');}
 if(!response.ok)throw new BotError(response.status===401?'PAYMENT_CREDENTIALS_INVALID':'PAYMENT_PROVIDER_UNAVAILABLE');
 const charge=sanitiseCharge(await response.json());
 if(!charge.id||!charge.pix?.copyPaste||Number(charge.amountCents)!==Math.round(Number(order.total)*100))throw new BotError('INVALID_PIX_RESPONSE');
 payment=checked(await db.from('payments').insert({order_id:orderId,provider:'turbofypay',provider_payment_id:String(charge.id),status:'pending',amount:order.total,pix_copy_paste:charge.pix.copyPaste,qr_code_url:charge.pix.qrCode,expires_at:charge.pix.expiresAt||expiresAt,provider_payload:charge}).select('*').single());
 const settled=checked(await db.rpc('discord_settle_payment',{p_payment_id:payment.provider_payment_id,p_charge:charge}));
 if(settled.paid){await fulfilPaid(db,orderId);return privateMessage('Pagamento confirmado. A entrega está disponível em Minha conta ou será realizada pelo staff.');}
 return pixResponse(orderId,payment);
}
export async function paymentStatus(db:SupabaseClient,userId:string,orderId:string) {
 if(!uuid(orderId))throw new BotError('INVALID_ID');const actor=await actorFor(db,userId);
 const order=checked(await db.from('orders').select('id,status').eq('id',orderId).eq('user_id',actor.id).maybeSingle());if(!order)throw new BotError('ORDER_NOT_OWNED');
 const payment=checked(await db.from('payments').select('provider_payment_id').eq('order_id',orderId).eq('provider','turbofypay').maybeSingle());
 if(!payment)return privateMessage(`Pedido #${orderId.slice(0,8)}: ${order.status}. Nenhuma cobrança PIX registrada.`);
 const request=checked(await db.from('discord_checkout_requests').select('order_id').eq('order_id',orderId).maybeSingle());
 if(!request)return privateMessage(`Pedido do site: ${order.status}. Consulte os detalhes em Minha conta.`);
 const charge=await providerCharge(payment.provider_payment_id);const settled=checked(await db.rpc('discord_settle_payment',{p_payment_id:payment.provider_payment_id,p_charge:charge}));
 if(settled.paid)await fulfilPaid(db,orderId);
 return privateMessage(`Pedido #${orderId.slice(0,8).toUpperCase()} — ${settled.paid?'Pagamento confirmado. Consulte a entrega na sua conta Nexium.':String(charge.status||'pending')}`);
}
export async function reconcilePayment(db:SupabaseClient,orderId:string,guild:string,actorId:string) {
 if(!uuid(orderId))throw new BotError('INVALID_ID');
 const request=checked(await db.from('discord_checkout_requests').select('order_id,guild_id').eq('order_id',orderId).eq('guild_id',guild).maybeSingle());if(!request)throw new BotError('ORDER_NOT_FOUND');
 const order=checked(await db.from('orders').select('total').eq('id',orderId).single());
 let payment=checked(await db.from('payments').select('provider_payment_id').eq('order_id',orderId).eq('provider','turbofypay').maybeSingle());
 // GET by persisted externalRef recovers an uncertain POST; never create a second charge.
 const charge=await providerCharge(payment?.provider_payment_id||orderId);
 if(!charge.id||Number(charge.amountCents)!==Math.round(Number(order.total)*100)||(charge.externalRef&&charge.externalRef!==orderId))throw new BotError('PAYMENT_MISMATCH');
 if(!payment){
  if(!charge.pix?.copyPaste)throw new BotError('INVALID_PIX_RESPONSE');
  payment=checked(await db.from('payments').insert({order_id:orderId,provider:'turbofypay',provider_payment_id:String(charge.id),status:'pending',amount:order.total,pix_copy_paste:charge.pix.copyPaste,qr_code_url:charge.pix.qrCode,expires_at:charge.pix.expiresAt,provider_payload:charge}).select('provider_payment_id').single());
 }
 const settled=checked(await db.rpc('discord_settle_payment',{p_payment_id:payment.provider_payment_id,p_charge:charge}));
 if(settled.paid)await fulfilPaid(db,orderId);
 await audit(db,guild,actorId,'payment_reconciled',orderId,{paid:!!settled.paid,provider_status:charge.status});
 return privateMessage(`Pedido #${orderId.slice(0,8)} reconciliado: ${settled.paid?'pago':charge.status}. Nenhuma nova cobrança foi criada.`);
}
