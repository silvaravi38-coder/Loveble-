import {reusableDelivery} from './product-fulfilment.ts';
import {ticketPanel} from './ticket-ui.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord,audit,row,button,linkButton,safeText,productFor,uuid} from './api.ts';
import {applicationId,privateMessage} from './security.ts';
const money=(value:unknown)=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export async function catalogue(db:SupabaseClient) {
 const products=checked(await db.from('products').select('id,name,price').eq('active',true).order('name').limit(25)) as any[];
 return {...privateMessage('Catálogo Nexium — selecione um produto para ver detalhes.'),components:products.length?[row([{type:3,custom_id:'nexium:catalog:v1',placeholder:'Escolher produto',options:products.map(p=>({label:safeText(p.name,100),value:p.id,description:`A partir de ${money(p.price)}`}))}])]:[]};
}
export async function productDetails(db:SupabaseClient,term:string,panelId?:string,guild?:string) {
 const p=await productFor(db,term),variants=checked(await db.from('product_variants').select('id,name,price,stock').eq('product_id',p.id).eq('active',true).order('price')) as any[];
 const stock=await db.from('supplier_stock_items').select('id',{count:'exact',head:true}).eq('product_id',p.id).eq('status','available');if(stock.error)throw new BotError('DATABASE_ERROR');
 const template=p.automatic_delivery?await reusableDelivery(db,guild,p.id):null;
 const available=!!template||!p.automatic_delivery||(stock.count||0)>0;
 const components:unknown[]=[];
 if(available){
   if(variants.length)components.push(row([{type:3,custom_id:`nexium:variant:${p.id}:${panelId||'direct'}`,placeholder:'Escolher opção para comprar',options:variants.slice(0,25).map(v=>({label:safeText(`${v.name} — ${money(v.price)}`,100),value:v.id,description:!p.automatic_delivery&&p.manual_display_quantity!=null?'Entrega manual':v.stock>0?'Disponível':'Sem estoque'}))}]));
   else components.push(row([button('Comprar com PIX',`nexium:buy:${p.id}:${panelId||'direct'}`)]));
 }
 components.push(row([linkButton('Ver no site',`https://nexium-store.vercel.app/?product=${encodeURIComponent(p.slug)}`)]));
 return {...privateMessage(`**${safeText(p.name,150)}**\n${safeText(p.description,900)}\nA partir de ${money(p.price)}\n${available?'Disponível':'Sem estoque para entrega automática'}${!p.automatic_delivery?'\nEntrega manual'+(p.manual_display_quantity!=null?' • Quantidade informada: '+p.manual_display_quantity:''):''}\n${p.requirements?'Requisitos: '+safeText(p.requirements,400):''}`),components};
}
export async function panelPayload(db:SupabaseClient,panel:any,disabled=false) {
 if(panel.panel_kind==='tickets')return ticketPanel(panel,disabled,await discord(`/guilds/${panel.guild_id}/emojis`));
 const ids=panel.product_ids as string[];if(ids.length>25 || !ids.length)throw new BotError('PANEL_PRODUCT_LIMIT');
 const products=checked(await db.from('products').select('id,name,price,slug,description,image_url,automatic_delivery,manual_display_quantity').eq('active',true).in('id',ids).order('name')) as any[];
 if(products.length===1&&!disabled){
  const p=products[0];
  const variants=checked(await db.from('product_variants').select('id,name,price,stock').eq('product_id',p.id).eq('active',true).order('price')) as any[];
  const stock=await db.from('supplier_stock_items').select('id',{count:'exact',head:true}).eq('product_id',p.id).eq('status','available');if(stock.error)throw new BotError('DATABASE_ERROR');
  const template=p.automatic_delivery?await reusableDelivery(db,panel.guild_id,p.id):null;
  const remaining=p.automatic_delivery&&!template?(stock.count||0):null;
  const plans=variants.slice(0,15).map(v=>`${safeText(v.name,65)} — ${money(v.price)}${!p.automatic_delivery&&p.manual_display_quantity!=null?' • Entrega manual':v.stock<1?' • Sem estoque':''}`).join('\n');
  const available=remaining===null||remaining>0;
  const components=variants.length?[row([{type:3,custom_id:`nexium:panel:${panel.id}`,placeholder:'Ver planos e comprar com PIX',options:[{label:safeText(p.name,100),value:p.id}]}])]:[row([{...button('Comprar com PIX',`nexium:buy:${p.id}:${panel.id}`),disabled:!available}])];
  components.push(row([linkButton('Ver no site',`https://nexium-store.vercel.app/?product=${encodeURIComponent(p.slug||p.id)}`)]));
  return {content:null,allowed_mentions:{parse:[]},embeds:[{title:safeText(p.name,200),description:safeText(p.description,2000),color:0xe3e5e8,...(p.image_url?{image:{url:p.image_url}}:{}),fields:[{name:'Valor',value:`${variants.length?'A partir de ':''}${money(variants.length?Math.min(...variants.map(v=>Number(v.price))):p.price)}`,inline:true},{name:!p.automatic_delivery?'Quantidade informada':'Estoque',value:!p.automatic_delivery?(p.manual_display_quantity==null?'Entrega manual':String(p.manual_display_quantity)+' • Entrega manual'):template?template.kind==='role'?'Cargo automático':'Arquivo automático':remaining===null?'Entrega manual':String(remaining),inline:true},...(plans?[{name:'Planos disponíveis',value:plans.slice(0,1024)}]:[])],footer:{text:p.automatic_delivery?'Nexium Store • Preço e estoque conferidos na compra':'Nexium Store • Entrega manual • Quantidade informada pela loja'},timestamp:new Date().toISOString()}],components};
 }
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
  message=await publishPanelMessage(panel,payload,unpublish);
  // Once Discord accepted, any DB failure retains the lock for reconciliation.
  uncertain=!!message;
  checked(await db.from('discord_sales_panels').update({message_id:message?.id||panel.message_id,active:!unpublish,sync_status:unpublish?'unpublished':'synced',last_synced_at:new Date().toISOString()}).eq('id',panel.id));
  await audit(db,guild,actorId,unpublish?'panel_unpublished':'panel_synced',panel.id,{channel_id:panel.channel_id,message_id:message?.id||panel.message_id});
  uncertain=false;return privateMessage(`Painel ${unpublish?'despublicado':'publicado/sincronizado'}: ${panel.name}\nID: ${panel.id}\nMensagem: https://discord.com/channels/${guild}/${panel.channel_id}/${message?.id||panel.message_id}`);
 }catch(e){if(e instanceof BotError&&e.code==='MUTATION_UNCERTAIN')uncertain=true;throw e;}
 finally{if(!uncertain)await db.from('discord_panel_locks').delete().eq('panel_id',panelId).eq('lease_token',lease);}
}

// A confirmed 404 is recoverable; network failures and uncertain writes are never retried.
export async function publishPanelMessage(panel:any,payload:any,unpublish=false,request:typeof discord=discord){
 if(panel.message_id){
  let existing;
  try{existing=await request(`/channels/${panel.channel_id}/messages/${panel.message_id}`);}catch(error){if(!(error instanceof BotError)||error.code!=='DISCORD_RESOURCE_NOT_FOUND')throw error;}
  if(existing){
   if(existing.author?.id!==applicationId)throw new BotError('PROTECTED_MESSAGE');
   return request(`/channels/${panel.channel_id}/messages/${panel.message_id}`,'PATCH',payload);
  }
 }
 if(unpublish)return null;
 return request(`/channels/${panel.channel_id}/messages`,'POST',{...payload,nonce:panel.id.replace(/-/g,'').slice(0,24),enforce_nonce:true});
}
