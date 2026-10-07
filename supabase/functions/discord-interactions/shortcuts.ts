import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,audit,BotError,checked,discord,linkButton,row,safeText,snowflake} from './api.ts';
import {privateMessage,applicationId} from './security.ts';
import {productRequestPanel} from './product-requests.ts';
import {syncInformationMessage} from '../discord-executor/information.ts';

export function adminDashboard(){return {...privateMessage('Central administrativa Nexium\nSelecione uma consulta abaixo. Para alterar cargos, canais ou Pix, use /botconfig com as opções desejadas.\nProdutos e variantes: /gerenciar_produto\nReposição: /gerenciar_stock acao:repor produto:nome\nCupons: /cupom • Anúncios: /anunciar'),components:[row([{type:3,custom_id:'nexium:admin-menu:v1',placeholder:'Selecione uma ferramenta administrativa',options:[{label:'Estoque',value:'estoque',description:'Consultar unidades disponíveis, sem mostrar chaves'},{label:'Painéis',value:'paineis',description:'Consultar painéis e seus IDs'},{label:'Financeiro',value:'financeiro',description:'Receita, custos e produtos mais vendidos'}]}]),row([linkButton('Abrir administração da loja','https://nexium-store.vercel.app/admin')])]};}
export async function profileCard(db:SupabaseClient,user:string){
 const actor=await actorFor(db,user);
 const count=await db.from('orders').select('id',{count:'exact',head:true}).eq('user_id',actor.id);
 if(count.error)throw new BotError('DATABASE_ERROR');
 const labels:Record<string,string>={admin:'Administrador',support:'Suporte',customer:'Cliente',supplier:'Fornecedor'};
 return {...privateMessage(`Seu perfil Nexium\nNome: ${safeText(actor.full_name,100)}\nPerfil: ${labels[actor.role]||'Membro'}\nPedidos na sua conta: ${count.count||0}\nUse /meus-pedidos para consultar as últimas compras.`),components:[row([linkButton('Abrir loja → Minha conta','https://nexium-store.vercel.app')])]};
}
export async function announce(db:SupabaseClient,input:any,actor:string,o:any){
 if(typeof o.texto!=='string'||!o.texto.trim()||o.texto.length>1800)throw new BotError('INVALID_ANNOUNCEMENT');
 const channelId=o.canal||input.channel_id;
 if(!snowflake(channelId))throw new BotError('INVALID_ID');
 const channel=await discord(`/channels/${channelId}`);
 if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 await audit(db,input.guild_id,actor,'announcement_requested',input.id,{channel_id:channelId});
 const message=await discord(`/channels/${channelId}/messages`,'POST',{content:o.texto.trim(),allowed_mentions:{parse:[]},nonce:input.id,enforce_nonce:true});
 await audit(db,input.guild_id,actor,'announcement_published',message.id,{channel_id:channelId});
 return privateMessage(`Anúncio publicado: https://discord.com/channels/${input.guild_id}/${channelId}/${message.id}`);
}
export async function refreshStockRequestPanel(db:SupabaseClient,input:any,actor:string){
 const mapping=checked(await db.from('discord_resource_mappings').select('discord_id,parent_id').eq('guild_id',input.guild_id).eq('resource_type','message').eq('logical_key','panel:channel:solicitarproduto').maybeSingle());
 if(!mapping||!snowflake(mapping.parent_id))throw new BotError('STOCK_PANEL_NOT_CONFIGURED');
 const channel=await discord(`/channels/${mapping.parent_id}`);
 if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 const message=await syncInformationMessage(mapping.parent_id,mapping.discord_id,productRequestPanel(),'panel:channel:solicitarproduto',applicationId,Deno.env.get('DISCORD_BOT_TOKEN')!);
 checked(await db.rpc('discord_bind_resource',{p_resource:{guild_id:input.guild_id,discord_id:message.id,resource_type:'message',logical_key:'panel:channel:solicitarproduto',name:'Solicitar Produtos para Estoque',parent_id:mapping.parent_id,managed_by_nexium:true,last_seen_at:new Date().toISOString()}}));
 await audit(db,input.guild_id,actor,'stock_request_panel_synced',message.id,{channel_id:mapping.parent_id});
 return privateMessage(`Painel de solicitação de estoque atualizado em <#${mapping.parent_id}>. O formulário mantém o cooldown de 3 minutos.`);
}
export async function productRanking(db:SupabaseClient,actor:string,period='total'){
 if(!['today','month','total'].includes(period))throw new BotError('INVALID_FINANCE_DATA');
 const report=checked(await db.rpc('discord_finance_report',{p_actor_id:actor,p_period:period}));
 return privateMessage(`Produtos mais vendidos (${period==='today'?'hoje':period==='month'?'mês':'total'})\n`+(report.top_products.length?report.top_products.map((p:any,i:number)=>`${i+1}. ${safeText(p.product_name,90)} — ${p.quantity} unidade(s)`).join('\n'):'Nenhuma venda confirmada neste período.'));
}
