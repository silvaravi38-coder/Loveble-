import {manualQuantityModal} from './manual-stock.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,productFor,BotError,checked,uuid,audit} from './api.ts';
import {commandParts} from './router.ts';
import {privateMessage} from './security.ts';
export async function restockModal(db:SupabaseClient,input:any,userId:string) {
 const {command,sub,options}=commandParts(input);if(input.type!==2||command!=='nexium-admin'||sub!=='restock')return null;
 const actor=await actorFor(db,userId);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const product=await productFor(db,options.produto);
 if(options.acao==='manual'||!product.automatic_delivery)return manualQuantityModal(product);
 return {type:9,data:{custom_id:`nexium:restock:${product.id}`,title:'Repor estoque Nexium',components:[{type:1,components:[{type:4,custom_id:'units',label:'Uma unidade/chave real por linha (máximo 50)',style:2,required:true,min_length:1,max_length:4000}]}]}};
}
export function restockUnits(value:string){const units=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!units.length||units.length>50||new Set(units).size!==units.length)throw new BotError('INVALID_STOCK');return units;}
export async function saveRestock(db:SupabaseClient,input:any,userId:string){
 const actor=await actorFor(db,userId);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const productId=String(input.data.custom_id).split(':')[2];if(!uuid(productId))throw new BotError('INVALID_ID');
 const product=await productFor(db,productId);const raw=input.data.components?.flatMap((r:any)=>r.components||[]).find((c:any)=>c.custom_id==='units')?.value;
 if(typeof raw!=='string'||raw.length>4000)throw new BotError('INVALID_STOCK');const units=restockUnits(raw);
 const result=await db.rpc('discord_restock',{p_discord_user_id:userId,p_guild_id:input.guild_id,p_product_id:product.id,p_units:units,p_interaction_id:input.id});if(result.error)throw new BotError(String(result.error.message).includes('DUPLICATE_STOCK')?'DUPLICATE_STOCK':'RESTOCK_FAILED');
 return privateMessage(`Estoque de ${product.name}: ${units.length} unidade(s) adicionada(s). As chaves não foram publicadas no canal nem nos registros de auditoria.`);
}
