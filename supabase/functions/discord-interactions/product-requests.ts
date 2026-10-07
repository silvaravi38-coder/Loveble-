import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,row,button,snowflake,safeText} from './api.ts';
import {privateMessage} from './security.ts';
export function productRequestPanel(){return {content:null,allowed_mentions:{parse:[]},embeds:[{title:'📦 | Solicitar Produtos para Estoque',description:'> Peça um novo produto para que a equipe avalie e adicione à loja.\n\n### 📂 | Como funciona?\n> Clique no botão abaixo e preencha o formulário com os detalhes do produto que gostaria de ver disponível. Sua solicitação será encaminhada para a equipe administrativa.\n\n### ℹ️ | O que incluir\n> ➜ **Nome claro do produto**\n> ➜ **Descrição com características relevantes**\n> ➜ **Link de referência** *(opcional, mas acelera a análise)*\n\n### 🔔 | Atenção\n> Há um cooldown de **3 minutos** entre solicitações. Detalhes claros aumentam a chance da equipe aprovar o pedido.\n\n### 🎉 | Pronto para solicitar?\n> Clique no botão abaixo para abrir o formulário.',color:0xe3e5e8,footer:{text:'🛒 Nexium Store'},timestamp:new Date().toISOString()}],components:[row([button('📦 Solicitar produto','nexium:stock-request:v1')])]};}
async function checkSource(db:SupabaseClient,input:any,messageId:string){
 if(!snowflake(messageId))throw new BotError('INVALID_ID');
 const source=checked(await db.from('discord_resource_mappings').select('discord_id').eq('guild_id',input.guild_id).eq('parent_id',input.channel_id).eq('logical_key','panel:channel:solicitarproduto').eq('resource_type','message').eq('discord_id',messageId).maybeSingle());
 if(!source)throw new BotError('PANEL_PRODUCT_MISMATCH');
}
export async function productRequestModal(db:SupabaseClient,input:any){
 if(input.type!==3||input.data?.custom_id!=='nexium:stock-request:v1')return null;
 await checkSource(db,input,input.message?.id);
 const field=(id:string,label:string,required:boolean,max:number,style=1)=>({type:18,label,component:{type:4,custom_id:id,required,max_length:max,style,...(required?{min_length:3}:{})}});
 return {type:9,data:{custom_id:`nexium:stock-request-submit:${input.message.id}`,title:'Solicitar produto para estoque',components:[field('name','Nome do produto',true,100),field('description','Descrição e características',true,800,2),field('reference','Link de referência (opcional)',false,300)]}};
}
export function requestValues(input:any){const values:Record<string,string>={};for(const row of input.data?.components||[]){for(const f of row.component?[row.component]:row.components||[])values[f.custom_id]=String(f.value||'').trim();}return values;}
export async function submitProductRequest(db:SupabaseClient,input:any,user:string){
 await checkSource(db,input,String(input.data.custom_id).split(':')[2]);
 const v=requestValues(input);
 if(v.name?.length<3||v.name?.length>100||!v.name||!v.description||v.description.length<3||v.description.length>800)throw new BotError('INVALID_TICKET_FORM');
 if(v.reference){try{const url=new URL(v.reference);if(!['http:','https:'].includes(url.protocol)||v.reference.length>300)throw Error();}catch{throw new BotError('INVALID_REFERENCE_URL');}}
 const r=await db.rpc('discord_submit_product_request',{p_interaction:input.id,p_guild:input.guild_id,p_user:user,p_name:safeText(v.name,100),p_description:safeText(v.description,800),p_reference:v.reference||null});
 if(r.error)throw new BotError(String(r.error.message).includes('REQUEST_COOLDOWN')?'REQUEST_COOLDOWN':'DATABASE_ERROR');
 return privateMessage(`✅ Solicitação de **${safeText(v.name,100)}** enviada à equipe administrativa.\nAguarde a análise. Você pode enviar outra solicitação após 3 minutos.`);
}
