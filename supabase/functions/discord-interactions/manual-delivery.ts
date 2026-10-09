import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,uuid,safeText,row,button} from './api.ts';
import {privateMessage} from './security.ts';
export function manualDeliveryCard(payload:any,now=Date.now()){
 if(!uuid(payload.order_id)||!Number.isFinite(Date.parse(payload.paid_at)))throw new BotError('INVALID_ID');
 const deadline=Math.floor((Date.parse(payload.paid_at)+10*3600000)/1000),late=now>=deadline*1000;
 return {content:null,allowed_mentions:{parse:[]},embeds:[{title:payload.stage==='deadline'?(late?'🚨 Entrega manual em atraso':'⏰ Entrega perto do prazo'):'📦 Nova entrega manual',color:payload.stage==='deadline'?0xe67e22:0x3498db,description:`**Pedido:** #${payload.order_id.slice(0,8).toUpperCase()}\n**Cliente:** ${safeText(payload.customer_id,20)}\n\n${(payload.items||[]).slice(0,10).map((i:any)=>`• ${safeText(i.name,100)} × ${Number(i.quantity)||1}`).join('\n')}\n\n**Pagamento confirmado:** <t:${Math.floor(Date.parse(payload.paid_at)/1000)}:R>\n**Prazo de entrega:** <t:${deadline}:f>\n\nConfirme apenas depois de entregar todos os itens manuais.`,footer:{text:'Nexium Store • Fila de entregas'}}],components:[row([button('Marcar como entregue',`nexium:manual-delivery:${payload.order_id}`,3)])]};
}
export async function manualDeliveryAction(db:SupabaseClient,input:any,user:string,id:string,confirm=false){
 if(!uuid(id))throw new BotError('INVALID_ID');
 const actor=await actorFor(db,user);if(!['admin','support'].includes(actor.role))throw new BotError('FORBIDDEN');
 const request=checked(await db.from('discord_checkout_requests').select('order_id').eq('order_id',id).eq('guild_id',input.guild_id).maybeSingle());if(!request)throw new BotError('ORDER_NOT_FOUND');
 if(!confirm)return {...privateMessage(`Você já entregou **todos os itens manuais** do pedido #${id.slice(0,8).toUpperCase()}?\nEsta ação registra a entrega e pode avisar o cliente.`),components:[row([button('Sim, já entreguei',`nexium:manual-delivery-confirm:${id}`,3)])]};
 const result=await db.rpc('discord_finish_manual_order',{p_user:user,p_guild:input.guild_id,p_order:id});
 if(result.error)throw new BotError(['FORBIDDEN','CLAIM_REQUIRED','ORDER_NOT_PAID','ORDER_NOT_FOUND','AUTOMATIC_DELIVERY_PENDING'].find(c=>result.error.message.includes(c))||'DATABASE_ERROR');
 return {...privateMessage(result.data.already_delivered?'Este pedido já estava entregue. Nenhuma entrega foi duplicada.':'✅ Entrega registrada com sucesso. O aviso ao cliente seguirá a configuração de notificações.'),components:[]};
}
