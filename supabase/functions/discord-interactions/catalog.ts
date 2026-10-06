import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord,audit,row,button,linkButton,safeText,productFor,uuid} from './api.ts';
import {applicationId,privateMessage} from './security.ts';
const money=(value:unknown)=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export async function catalogue(db:SupabaseClient) {
 const products=checked(await db.from('products').select('id,name,price').eq('active',true).order('name').limit(25)) as any[];
 return {...privateMessage('Catálogo Nexium — selecione um produto para ver detalhes.'),components:products.length?[row([{type:3,custom_id:'nexium:catalog:v1',placeholder:'Escolher produto',options:products.map(p=>({label:safeText(p.name,100),value:p.id,description:`A partir de ${money(p.price)}`}))}])]:[]};
}
export async function productDetails(db:SupabaseClient,term:string,panelId?:string) {
 const p=await productFor(db,term),variants=checked(await db.from('product_variants').select('id,name,price,stock').eq('product_id',p.id).eq('active',true).order('price')) as any[];
 const stock=await db.from('supplier_stock_items').select('id',{count:'exact',head:true}).eq('product_id',p.id).eq('status','available');if(stock.error)throw new BotError('DATABASE_ERROR');
 const available=!p.automatic_delivery||(stock.count||0)>0;
 const components:unknown[]=[];
 if(available){
   if(variants.length)components.push(row([{type:3,custom_id:`nexium:variant:${p.id}:${panelId||'direct'}`,placeholder:'Escolher opção para comprar',options:variants.slice(0,25).map(v=>({label:safeText(`${v.name} — ${money(v.price)}`,100),value:v.id,description:v.stock>0?'Disponível':'Sem estoque'}))}]));
   else components.push(row([button('Comprar com PIX',`nexium:buy:${p.id}:${panelId||'direct'}`)]));
 }
 components.push(row([linkButton('Ver no site',`https://nexium-store.vercel.app/?product=${encodeURIComponent(p.slug)}`)]));
 return {...privateMessage(`**${safeText(p.name,150)}**\n${safeText(p.description,900)}\nA partir de ${money(p.price)}\n${available?'Disponível':'Sem estoque para entrega automática'}\n${p.requirements?'Requisitos: '+safeText(p.requirements,400):''}`),components};
}
export async function panelPayload(db:SupabaseClient,panel:any,disabled=false) {
 if(panel.panel_kind==='tickets')return {content:null,allowed_mentions:{parse:[]},embeds:[{title:safeText(panel.name,200),description:disabled?'Este painel está despublicado.':'Precisa de ajuda? Abra um atendimento privado. Vincule sua conta Nexium para relacionar suas compras.',color:0xe3e5e8}],components:disabled?[]:[row([button('Abrir atendimento',`nexium:ticket-open:${panel.id}`)])]};
 const ids=panel.product_ids as string[];if(ids.length>25 || !ids.length)throw new BotError('PANEL_PRODUCT_LIMIT');
 const products=checked(await db.from('products').select('id,name,price').eq('active',true).in('id',ids).order('name')) as any[];
 return {content:null,allowed_mentions:{parse:[]},embeds:[{title:safeText(panel.name,200),description:disabled?'Este painel está despublicado.':products.map(p=>`• **${safeText(p.name,120)}** — ${money(p.price)}`).join('\n')||'Nenhum produto disponível.',color:0xe3e5e8,footer:{text:'Nexium Store • Catálogo atualizado pelo backend'}}],components:disabled||!products.length?[]:[row([{type:3,custom_id:`nexium:panel:${panel.id}`,placeholder:'Selecione um produto',options:products.map(p=>({label:safeText(p.name,100),value:p.id,description:`A partir de ${money(p.price)}`}))}])]};
}
export async function publishPanel(db:SupabaseClient,guild:string,channelId:string,actorId:string,panelId:string,unpublish=false) {
 if(!uuid(panelId))throw new BotError('INVALID_ID');
 const lease=crypto.randomUUID();
 const claim=await db.from('discord_panel_locks').insert({panel_id:panelId,lease_token:lease,expires_at:new Date(Date.now()+300000).toISOString()});
 if(claim.error)throw new BotError('PANEL_BUSY_REVIEW');
 let uncertain=false;
 try{
  const panel=checked(await db.from('discord_sales_panels').select('*').eq('id',panelId).eq('guild_id',guild).single());
  const channel=await discord(`/channels/${panel.channel_id}`);
  if(channel.guild_id!==guild||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
  const payload=await panelPayload(db,panel,unpublish);let message;
  if(panel.message_id){
   const existing=await discord(`/channels/${panel.channel_id}/messages/${panel.message_id}`);
   if(existing.author?.id!==applicationId)throw new BotError('PROTECTED_MESSAGE');
   message=await discord(`/channels/${panel.channel_id}/messages/${panel.message_id}`,'PATCH',payload);
  }else{
   if(unpublish)throw new BotError('PANEL_NOT_PUBLISHED');
   message=await discord(`/channels/${panel.channel_id}/messages`,'POST',{...payload,nonce:panel.id.replace(/-/g,'').slice(0,24),enforce_nonce:true});
  }
  // Once Discord accepted, any DB failure retains the lock for reconciliation.
  uncertain=true;
  checked(await db.from('discord_sales_panels').update({message_id:message.id,active:!unpublish,sync_status:unpublish?'unpublished':'synced',last_synced_at:new Date().toISOString()}).eq('id',panel.id));
  await audit(db,guild,actorId,unpublish?'panel_unpublished':'panel_synced',panel.id,{channel_id:panel.channel_id,message_id:message.id});
  uncertain=false;return privateMessage(`Painel ${unpublish?'despublicado':'publicado/sincronizado'}: ${panel.name}\nID: ${panel.id}\nMensagem: https://discord.com/channels/${guild}/${panel.channel_id}/${message.id}`);
 }catch(e){if(e instanceof BotError&&e.code==='MUTATION_UNCERTAIN')uncertain=true;throw e;}
 finally{if(!uncertain)await db.from('discord_panel_locks').delete().eq('panel_id',panelId).eq('lease_token',lease);}
}
