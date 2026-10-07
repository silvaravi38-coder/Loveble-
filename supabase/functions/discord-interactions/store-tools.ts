import {paymentConfigStatus} from './payment-config.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,discord,safeText,row,button} from './api.ts';
import {privateMessage} from './security.ts';
import {commandParts} from './router.ts';
import {publishPanel} from './catalog.ts';
import {panelJob} from './jobs.ts';
export function productDraft(name:unknown,price:unknown,description:unknown,mode:unknown){
 const value=String(price).trim().replace(',','.');const amount=Number(value);
 if(typeof name!=='string'||name.trim().length<2||name.trim().length>100||!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value)||amount<0.01||amount>100000||typeof description!=='string'||description.length>2000||!['manual','key'].includes(String(mode)))throw new BotError('INVALID_PRODUCT');
 return {name:name.trim(),price:amount,description,mode};
}
export async function createProductModal(db:SupabaseClient,input:any,user:string){
 const {command,sub}=commandParts(input);
 if(!((input.type===2&&command==='criar'&&sub==='produto')||(input.type===3&&input.data?.custom_id==='nexium:store:create')))return null;
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 return {type:9,data:{custom_id:'nexium:store:create-submit',title:'Cadastrar produto Nexium',components:[
  ['name','Nome do produto',1,100],['price','Preço em reais (ex.: 5,39)',1,20],['description','Descrição e condições da oferta',2,2000],['mode','Entrega: manual ou key',1,10]
 ].map(([id,label,style,max])=>({type:1,components:[{type:4,custom_id:id,label,style,max_length:max,required:true,...(id==='mode'?{value:'manual'}:{})}]}))}};
}
export async function createAndPublish(db:SupabaseClient,input:any,user:string,draft:any,interaction=input.id){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const settings=checked(await db.from('discord_bot_settings').select('channel_sales_id').eq('guild_id',input.guild_id).maybeSingle());
 const channelId=settings?.channel_sales_id||input.channel_id;const channel=await discord(`/channels/${channelId}`);if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 const p=checked(await db.rpc('discord_create_product',{p_user:user,p_guild:input.guild_id,p_channel:channelId,p_interaction:interaction,p_data:productDraft(draft.name,draft.price,draft.description,draft.mode)}));
 try{return await panelJob(db,input.guild_id,actor.id,'publish',p.panel_id,()=>publishPanel(db,input.guild_id,channelId,actor.id,p.panel_id));}
 catch{return privateMessage(`Produto cadastrado. A publicação aguarda revisão. Não cadastre novamente.\nProduto: ${p.product_id}\nPainel: ${p.panel_id}\nUse /nexium-admin sincronizar painel:${p.panel_id}.`);}
}
export async function submitCreatedProduct(db:SupabaseClient,input:any,user:string){
 const fields=Object.fromEntries((input.data.components||[]).flatMap((r:any)=>r.components||[]).map((c:any)=>[c.custom_id,c.value]));
 return createAndPublish(db,input,user,productDraft(fields.name,fields.price,fields.description,fields.mode));
}
export async function setupChecklist(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const config=checked(await db.from('discord_bot_settings').select('pix_enabled,channel_sales_id,role_support_id,category_support_id').eq('guild_id',input.guild_id).maybeSingle());
 const products=checked(await db.from('products').select('id,automatic_delivery').eq('active',true));
 const panels=checked(await db.from('discord_sales_panels').select('id').eq('guild_id',input.guild_id).eq('active',true).eq('panel_kind','sales').eq('sync_status','synced'));
 const payment=await paymentConfigStatus(db,input.guild_id);
 const checks:[boolean,string][]=[[true,'Conta administrativa vinculada'],[!!config?.pix_enabled&&payment.configured,'Pix ativado e credenciais configuradas'],[!!config?.channel_sales_id,'Canal de vendas escolhido'],[!!config?.role_support_id&&!!config?.category_support_id,'Equipe e categoria de tickets configuradas'],[products.length>0,'Produtos cadastrados'],[panels.length>0,'Painéis publicados']];
 return {...privateMessage(`**Configuração da Nexium Store**\n${checks.map(([ok,label])=>`${ok?'✅':'⬜'} ${label}`).join('\n')}\n\n${checks.filter(([ok])=>ok).length}/${checks.length} etapas concluídas. Configure cargo ou arquivo com /produto-entrega; keys com /gerenciar_stock.\nIA administrativa: /loja-ia texto:...`),components:[row([{type:8,custom_id:'nexium:store:sales-channel',channel_types:[0,5],placeholder:'Escolher canal de vendas',min_values:1,max_values:1}]),row([button('Cadastrar produto','nexium:store:create'),button('Configurações','nexium:botconfig:tab:home',2),button('Atualizar checklist','nexium:store:checklist',2)])]};
}
export async function setSalesChannel(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const id=input.data.values?.[0],channel=await discord(`/channels/${id}`);if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 checked(await db.from('discord_bot_settings').upsert({guild_id:input.guild_id,channel_sales_id:id,id_mode:'manual',updated_by:actor.id},{onConflict:'guild_id'}));
 return setupChecklist(db,input,user);
}
