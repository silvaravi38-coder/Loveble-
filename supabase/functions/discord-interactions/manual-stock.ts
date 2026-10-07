import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,uuid,safeText} from './api.ts';
import {privateMessage} from './security.ts';
import {publishPanel} from './catalog.ts';
export function manualQuantity(value:unknown){
 if(typeof value!=='string')throw new BotError('INVALID_MANUAL_QUANTITY');
 if(value.trim().toLowerCase()==='remover')return null;
 if(!/^\d{1,6}$/.test(value.trim()))throw new BotError('INVALID_MANUAL_QUANTITY');return Number(value.trim());
}
export function manualQuantityModal(product:any){
 return {type:9,data:{custom_id:`nexium:manual-stock:${product.id}`,title:'Quantidade • entrega manual',components:[{type:1,components:[{type:4,custom_id:'quantity',label:'Quantidade exibida (ou remover)',style:1,required:true,max_length:7,...(product.manual_display_quantity!=null?{value:String(product.manual_display_quantity)}:{})}]}]}};
}
export async function saveManualQuantity(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const product=String(input.data.custom_id).split(':')[2];if(!uuid(product))throw new BotError('INVALID_ID');
 const raw=input.data.components?.flatMap((r:any)=>r.components||[]).find((c:any)=>c.custom_id==='quantity')?.value;const quantity=manualQuantity(raw);
 checked(await db.rpc('discord_set_manual_quantity',{p_user:user,p_guild:input.guild_id,p_product:product,p_quantity:quantity}));
 const panels=checked(await db.from('discord_sales_panels').select('id,channel_id').eq('guild_id',input.guild_id).eq('active',true).eq('panel_kind','sales').contains('product_ids',[product]).limit(10)) as any[];
 const pending=[];for(const p of panels){try{await publishPanel(db,input.guild_id,p.channel_id,actor.id,p.id);}catch{pending.push(p.id);}}
 return privateMessage(`Quantidade ${quantity===null?'removida':`definida: ${quantity}`}. Produto configurado com entrega manual.\nEssa quantidade é informativa e não diminui automaticamente; atualize-a neste formulário quando desejar.${pending.length?'\nPainéis que aguardam sincronização: '+pending.map(p=>safeText(p)).join(', '):'\nPainéis existentes atualizados.'}`);
}
