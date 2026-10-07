import {botConfigPanel,botConfigAction} from './bot-config.ts';
import {ticketSubjects} from './ticket-ui.ts';
import {ticketActionButton} from './ticket-actions.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,actorFor,discord,productFor,uuid,snowflake,safeText,audit,fortalezaMonthStart} from './api.ts';
import {commandAliases,commandLabels} from '../discord-executor/commands.ts';
import {adminDashboard,announce,refreshStockRequestPanel,profileCard,productRanking} from './shortcuts.ts';
import {privateMessage,orderMessage} from './security.ts';
import {catalogue,productDetails,publishPanel} from './catalog.ts';
import {startPurchase,paymentStatus,reconcilePayment} from './payments.ts';
import {previewChannelControl,applyChannelControl} from './moderation.ts';
import {executorJob,panelJob} from './jobs.ts';
import {manageSchedules} from './schedules.ts';
import {configureAi,ticketAi} from './ai.ts';
import {openTicket,listTickets,actTicket,ticketId} from './tickets.ts';
export function commandParts(input:any) {
 const name=input.data?.name||'',alias=commandAliases[name];
 const options:Record<string,any>={};
 for(const o of alias?input.data?.options||[]:input.data?.options?.[0]?.options||[])options[o.name]=o.value;
 const command=alias?.command||name;
 let sub=alias?.sub||input.data?.options?.[0]?.name||'';
 if(name==='gerenciar_stock'&&options.acao==='repor'){if(!options.produto)throw new BotError('PRODUCT_REQUIRED');sub='restock';}
 return {command,sub,options};
}
export function eventAction(input:any) {return input.type===2?`${input.data?.name||'unknown'}:${input.data?.options?.[0]?.name||'unknown'}`:[3,5].includes(input.type)?String(input.data?.custom_id||'').split(':').slice(0,2).join(':'):'unsupported';}
async function ownedPanel(db:SupabaseClient,input:any,panelId:string,productId:string,checkMessage=false) {
 if(!uuid(panelId))throw new BotError('INVALID_ID');
 const panel=checked(await db.from('discord_sales_panels').select('*').eq('id',panelId).eq('guild_id',input.guild_id).eq('channel_id',input.channel_id).eq('active',true).maybeSingle());
 if(!panel||!panel.product_ids.includes(productId)||(checkMessage&&panel.message_id!==input.message?.id))throw new BotError('PANEL_PRODUCT_MISMATCH');return panel;
}
async function orders(db:SupabaseClient,userId:string) {const actor=await actorFor(db,userId);return orderMessage(checked(await db.from('orders').select('id,status,created_at').eq('user_id',actor.id).order('created_at',{ascending:false}).limit(5)));}
async function admin(db:SupabaseClient,input:any,userId:string,sub:string,o:Record<string,any>) {
 const actor=await actorFor(db,userId);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(sub==='dashboard')return adminDashboard();
 if(sub==='anunciar')return announce(db,input,actor.id,o);
 if(sub==='painel-estoque')return refreshStockRequestPanel(db,input,actor.id);
 if(sub==='ranking-produtos')return productRanking(db,actor.id,o.periodo);
 if(sub==='produto'){const details=await productDetails(db,o.produto);return {...details,content:'Gestão de produtos e variantes: https://nexium-store.vercel.app/admin'};}
 if(['agendar','mensagens','cancelar-mensagem'].includes(sub))return manageSchedules(db,input,userId,sub,o);
 if(sub==='ia')return configureAi(db,input,userId,o);
 if(sub==='lock'||sub==='unlock')return previewChannelControl(db,input,userId,sub);
 if(sub==='reconciliar')return reconcilePayment(db,o.pedido,input.guild_id,actor.id);
 if(sub==='custos'){
  if(!uuid(o.pedido)||!Number.isFinite(o.custo)||!Number.isFinite(o.taxa)||o.custo<0||o.taxa<0||String(o.motivo).trim().length<3)throw new BotError('INVALID_FINANCE_DATA');
  const order=checked(await db.from('orders').select('id,status').eq('id',o.pedido).single());if(!['paid','processing','delivered'].includes(order.status))throw new BotError('ORDER_NOT_PAID');
  const data={order_id:order.id,cost:o.custo,fee:o.taxa,note:String(o.motivo).slice(0,500),updated_by:actor.id,updated_at:new Date().toISOString()};
  checked(await db.from('discord_order_finance').upsert(data));await audit(db,input.guild_id,actor.id,'order_finance_reconciled',order.id,{cost:o.custo,fee:o.taxa,note:data.note});return privateMessage('Custos e taxas reais registrados. O relatório distingue pedidos conciliados dos que ainda faltam conciliar.');
 }
 if(sub==='painel'||sub==='painel-tickets'){
  const channel=await discord(`/channels/${input.channel_id}`);if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
  const all=checked(await db.from('products').select('id').eq('active',true).order('name').limit(25)) as any[];
  const ids=sub==='painel-tickets'?[]:o.produtos?String(o.produtos).split(',').map(id=>id.trim()):all.map(p=>p.id);
  if(ids.length>25||(sub==='painel'&&!ids.length)||ids.some(id=>!uuid(id)))throw new BotError('PANEL_PRODUCT_LIMIT');
  let lookup=db.from('discord_sales_panels').select('id').eq('guild_id',input.guild_id).eq('channel_id',input.channel_id).eq('panel_kind',sub==='painel-tickets'?'tickets':'sales').eq('active',true);
  if(sub==='painel')lookup=lookup.eq('name',String(o.nome).slice(0,100));
  let panel=checked(await lookup.order('created_at',{ascending:false}).limit(1).maybeSingle());
  const draft={name:String(o.nome).slice(0,100),product_ids:[...new Set(ids)],sync_status:'pending'};
  if(panel)checked(await db.from('discord_sales_panels').update(draft).eq('id',panel.id));
  else panel=checked(await db.from('discord_sales_panels').insert({...draft,slug:`discord-${input.id}`,guild_id:input.guild_id,channel_id:input.channel_id,panel_kind:sub==='painel-tickets'?'tickets':'sales',active:true,created_by:actor.id}).select('id').single());
  return panelJob(db,input.guild_id,actor.id,'publish',panel.id,()=>publishPanel(db,input.guild_id,input.channel_id,actor.id,panel.id));
 }
 if(sub==='paineis'){const panels=checked(await db.from('discord_sales_panels').select('id,name,channel_id,active,sync_status').eq('guild_id',input.guild_id).limit(20)) as any[];return privateMessage(panels.map(p=>`${safeText(p.name,80)} — ${p.id} — ${p.sync_status}`).join('\n')||'Nenhum painel cadastrado.');}
 if(sub==='sincronizar'||sub==='despublicar')return panelJob(db,input.guild_id,actor.id,sub==='despublicar'?'unpublish':'sync',o.painel,()=>publishPanel(db,input.guild_id,input.channel_id,actor.id,o.painel,sub==='despublicar'));
 if(['scan','preview','backup','aplicar'].includes(sub)){if(sub==='aplicar'&&!uuid(o.preview))throw new BotError('INVALID_ID');return executorJob(db,input.guild_id,actor.id,sub==='aplicar'?'apply':sub,o.estrategia||'reuse',o.preview);}
 if(sub==='configurar'){
  if(!Object.keys(o).length)return botConfigPanel(db,input,userId);
  const data:Record<string,unknown>={guild_id:input.guild_id,updated_by:actor.id};
  for(const [option,field] of [['pix','pix_enabled'],['cargo_cliente_apos_pago','grant_customer_role_on_paid'],['dm_pagamento','dm_customer_on_paid'],['dm_entrega','dm_customer_on_delivery']])if(o[option]!==undefined)data[field]=o[option];
  if(o.logs){const c=await discord(`/channels/${o.logs}`);if(c.guild_id!==input.guild_id||![0,5].includes(c.type))throw new BotError('WRONG_PANEL_CHANNEL');data.channel_logs_id=o.logs;}
  if(o.categoria_tickets){const c=await discord(`/channels/${o.categoria_tickets}`);if(c.guild_id!==input.guild_id||c.type!==4)throw new BotError('INVALID_TICKET_CATEGORY');data.category_support_id=o.categoria_tickets;}
  if(o.cliente||o.suporte){const roles=await discord(`/guilds/${input.guild_id}/roles`);for(const [option,field] of [['cliente','role_customer_id'],['suporte','role_support_id']]){if(o[option]){const role=roles.find((r:any)=>r.id===o[option]);if(!role||role.managed||role.id===input.guild_id)throw new BotError('PROTECTED_ROLE');data[field]=role.id;}}}
  if(['cliente','suporte','logs','categoria_tickets'].some(key=>o[key]!==undefined))data.id_mode='manual';
  const previous=checked(await db.from('discord_bot_settings').select('id').eq('guild_id',input.guild_id).maybeSingle());
  if(previous)checked(await db.from('discord_bot_settings').update(data).eq('id',previous.id));else checked(await db.from('discord_bot_settings').insert(data));
  await audit(db,input.guild_id,actor.id,'bot_configured',input.guild_id,data);return privateMessage('Configurações salvas. IDs validados no Discord.');
 }
 if(sub==='estoque'){
  const products=o.produto?[await productFor(db,o.produto)]:checked(await db.from('products').select('id,name,automatic_delivery').eq('active',true).order('name')) as any[];
  const lines=[];for(const p of products){const count=await db.from('supplier_stock_items').select('id',{count:'exact',head:true}).eq('product_id',p.id).eq('status','available');if(count.error)throw new BotError('DATABASE_ERROR');lines.push(`${safeText(p.name,100)}: ${count.count||0} disponível(is) • ${p.automatic_delivery?'automático':'manual'}`);}
  return privateMessage(lines.join('\n')+'\nReponha unidades reais com /nexium-admin restock ou pelo painel de fornecedor. Nenhuma chave de entrega é mostrada neste comando.');
 }
 if(sub==='cupom'){
  const code=String(o.codigo).trim().toUpperCase();if(!/^[A-Z0-9_-]{3,32}$/.test(code)||!Number.isFinite(o.desconto)||o.desconto<1||o.desconto>99||!Number.isInteger(o.limite)||o.limite<1)throw new BotError('INVALID_COUPON');
  const c=checked(await db.from('coupons').insert({code,discount_type:'percent',discount_value:o.desconto,discount_percent:o.desconto,max_uses:o.limite,active:true}).select('id').single());
  await audit(db,input.guild_id,actor.id,'coupon_created',c.id,{code,discount:o.desconto,max_uses:o.limite});return privateMessage(`Cupom ${code} criado: ${o.desconto}% • limite ${o.limite} usos.`);
 }
 if(sub==='financeiro'){
  const report=checked(await db.rpc('discord_finance_report',{p_actor_id:actor.id,p_period:o.periodo||'total'}));const format=(n:number)=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  return privateMessage(`Receita (${report.period}): ${format(report.revenue)} • ${report.orders} pedidos\nTicket médio: ${format(report.average)}\nSite: ${report.site_orders} • Discord: ${report.discord_orders}\nCustos registrados: ${format(report.recorded_costs)} • taxas: ${format(report.recorded_fees)}\nLucro dos pedidos conciliados: ${format(report.net_reconciled)}\nPedidos sem custos/taxas conciliados: ${report.unreconciled_orders}\nMais vendidos:\n`+report.top_products.map((p:any)=>`• ${safeText(p.product_name,90)}: ${p.quantity}`).join('\n'));
 }
 if(sub==='suportes'){
  const start=fortalezaMonthStart();
  const staff=checked(await db.from('profiles').select('id,full_name').eq('role','support')) as any[];
  const lines=[];for(const s of staff){const resolved=await db.from('support_tickets').select('id',{count:'exact',head:true}).eq('resolved_by',s.id).eq('status','resolved').gte('resolved_at',start.toISOString());const claimed=await db.from('support_ticket_claims').select('id',{count:'exact',head:true}).eq('support_id',s.id).gte('claimed_at',start.toISOString());if(resolved.error||claimed.error)throw new BotError('DATABASE_ERROR');lines.push(`${safeText(s.full_name,80)}: ${claimed.count||0} assumidos, ${resolved.count||0} resolvidos • R$ ${(Math.floor((resolved.count||0)/30)*10).toFixed(2)}`);}
  return privateMessage(lines.join('\n')||'Nenhum suporte cadastrado no site.');
 }
 throw new BotError('UNSUPPORTED_ACTION');
}
export async function route(db:SupabaseClient,input:any,userId:string) {
 if(input.type===3){
  const parts=String(input.data.custom_id).split(':');
  if(String(input.data.custom_id).startsWith('nexium:botconfig:'))return botConfigAction(db,input,userId,(sub,o)=>admin(db,input,userId,sub,o));
  if(input.data.custom_id==='nexium:admin-menu:v1'){const action=input.data.values?.[0];if(!['estoque','paineis','financeiro','configurar'].includes(action))throw new BotError('UNSUPPORTED_ACTION');return admin(db,input,userId,action==='configurar'?'dashboard':action,{});}
  if(input.data.custom_id==='nexium:my-orders:v1')return orders(db,userId);
  if(input.data.custom_id==='nexium:catalog:v1')return productDetails(db,input.data.values?.[0]||'');
  if(['ticket-panels','ticket-member','ticket-notify','ticket-staff','ticket-payment','ticket-delete','ticket-delete-confirm','ticket-manage'].includes(parts[1]))return ticketActionButton(db,input,userId,parts[1],parts[2]);
  if(parts[1]==='ticket-open'){
   if(!uuid(parts[2]))throw new BotError('INVALID_ID');const panel=checked(await db.from('discord_sales_panels').select('*').eq('id',parts[2]).eq('guild_id',input.guild_id).eq('channel_id',input.channel_id).eq('active',true).eq('panel_kind','tickets').maybeSingle());
   if(!panel||panel.message_id!==input.message?.id)throw new BotError('PANEL_PRODUCT_MISMATCH');const subject=ticketSubjects.find(s=>s.value===(parts[3]||input.data.values?.[0]));if(!subject)throw new BotError('INVALID_TICKET_FORM');return openTicket(db,input,userId,subject.label);
  }
  if(parts[1]==='panel'){const product=input.data.values?.[0];await ownedPanel(db,input,parts[2],product,true);return productDetails(db,product,parts[2]);}
  if(parts[1]==='buy'||parts[1]==='variant'){
   const panel=parts[3]==='direct'?undefined:parts[3];if(panel)await ownedPanel(db,input,panel,parts[2]);
   return startPurchase(db,input,userId,parts[2],parts[1]==='variant'?input.data.values?.[0]:undefined,panel);
  }
  if(parts[1]==='control-confirm')return applyChannelControl(db,input,userId,parts[2]);
  if(parts[1]==='payment')return paymentStatus(db,userId,parts[2]);
  if(['ticket-claim','ticket-view','ticket-transcript'].includes(parts[1]))return actTicket(db,input,userId,parts[1]==='ticket-claim'?'claim':parts[1]==='ticket-transcript'?'transcript':'view',{ticket:parts[2]});
  throw new BotError('UNSUPPORTED_ACTION');
 }
 const {command,sub,options:o}=commandParts(input);
 if(command==='nexium-admin')return admin(db,input,userId,sub,o);
 if(command==='ticket'){
  if(sub==='abrir')return openTicket(db,input,userId,o.motivo,o.pedido);
  if(sub==='listar')return listTickets(db,userId,input.guild_id);
  if(sub==='ia'||sub==='resumo')return ticketAi(db,userId,input.guild_id,await ticketId(db,input.guild_id,input.channel_id,o.ticket),sub==='resumo'?'summary':'suggest');
  const map:Record<string,string>={cancelar:'cancel',ver:'view',mensagem:'message',assumir:'claim',transferir:'transfer',prioridade:'priority',finalizar:'close',avaliar:'rate',transcript:'transcript',adicionar:'add_member',remover:'remove_member'};
  if(!map[sub])throw new BotError('UNSUPPORTED_ACTION');
  return actTicket(db,input,userId,map[sub],{ticket:o.ticket,text:o.texto,target:o.atendente||o.membro,priority:o.nivel,reason:o.motivo,outcome:o.resultado,stars:o.estrelas,comment:o.comentario});
 }
 if(command!=='nexium')throw new BotError('UNSUPPORTED_ACTION');
 if(sub==='teste')return {...privateMessage('Nexium conectado. Catálogo, pedidos, PIX e suporte disponíveis. Use /nexium ajuda.'),components:[{type:1,components:[{type:2,style:1,label:'Meus pedidos',custom_id:'nexium:my-orders:v1'}]}]};
 if(sub==='ajuda')return privateMessage(commandLabels().join('\n')+'\nAções de staff/admin exigem conta vinculada e perfil autorizado na loja.');
 if(sub==='vincular')return privateMessage('Abra https://nexium-store.vercel.app → Minha conta → Conectar minha conta Discord.');
 if(sub==='perfil')return profileCard(db,userId);
 if(sub==='pedidos')return orders(db,userId);
 if(sub==='catalogo')return catalogue(db);
 if(sub==='produto')return productDetails(db,o.produto);
 if(sub==='comprar'){const p=await productFor(db,o.produto);return startPurchase(db,input,userId,p.id,o.variante,undefined,o.cupom);}
 if(sub==='pagamento')return paymentStatus(db,userId,o.pedido);
 if(sub==='entrega'){
  if(!uuid(o.pedido))throw new BotError('INVALID_ID');const actor=await actorFor(db,userId);
  const order=checked(await db.from('orders').select('id,status').eq('id',o.pedido).eq('user_id',actor.id).maybeSingle());if(!order)throw new BotError('ORDER_NOT_OWNED');
  const delivered=await db.from('order_deliveries').select('id',{count:'exact',head:true}).eq('order_id',order.id);if(delivered.error)throw new BotError('DATABASE_ERROR');
  return privateMessage(`Pedido #${order.id.slice(0,8)}: ${order.status}\n${delivered.count?'Entrega disponível em Minha conta no site. As chaves e anexos ficam na área protegida da loja.':'Nenhuma entrega registrada até agora.'}`);
 }
 if(sub==='suporte')return openTicket(db,input,userId,o.motivo,o.pedido);
 throw new BotError('UNSUPPORTED_ACTION');
}
export const errorMessages:Record<string,string>={PRODUCT_REQUIRED:'Informe o produto para repor o estoque.',INVALID_ANNOUNCEMENT:'Informe um anúncio de 1 a 1800 caracteres.',STOCK_PANEL_NOT_CONFIGURED:'O painel de solicitar estoque ainda não está mapeado neste servidor.',REQUEST_COOLDOWN:'Aguarde 3 minutos entre solicitações de produtos.',INVALID_REFERENCE_URL:'Informe um link de referência válido (http ou https).',
 TICKET_PAYMENT_OWNER_REQUIRED:'O pagamento deve ser aberto pelo próprio cliente. Oriente-o a clicar neste botão; nenhuma cobrança foi criada para o atendente.',TICKET_CLOSE_BEFORE_DELETE:'Finalize ou cancele o atendimento primeiro. Depois gere o preview de exclusão.',PROTECTED_TICKET_CHANNEL:'Somente um canal de ticket criado pela Nexium, íntegro e encerrado, pode ser excluído.',TRANSCRIPT_PARTIAL_DELETE_BLOCKED:'Transcript parcial: exclusão bloqueada. Preserve o canal e solicite revisão do administrador.',INVALID_TICKET_FORM:'Preencha o motivo e selecione uma opção válida. O pedido é opcional e deve usar o ID completo.',TICKET_ALREADY_CLOSED:'Este atendimento já está encerrado. Consulte os detalhes ou abra um novo ticket.',SCHEDULE_DATE_REQUIRED:'Informe data futura com fuso: 2026-10-07T12:00:00-03:00. Mínimo um minuto de antecedência.',SCHEDULE_NOT_QUEUED:'Só mensagens ainda na fila podem ser canceladas.', PAYMENT_DISABLED:'O PIX Discord está desligado nas configurações da loja.', AI_KEY_REQUIRED:'A IA precisa de AI_GATEWAY_API_KEY nos secrets do Supabase. Não envie essa chave no chat.',AI_DISABLED:'A IA está desligada.',AI_PAUSED:'A IA automática está pausada neste ticket.',AI_LIMIT_REACHED:'O limite de IA desta hora foi atingido.', CHANNEL_CHANGED_REVIEW_REQUIRED:'As permissões mudaram. Nenhuma alteração foi aplicada; gere um novo preview.',CHANNEL_ALREADY_LOCKED:'Este canal já está bloqueado pela Nexium. Use unlock para restaurar o backup.',CONTROL_PREVIEW_EXPIRED:'Preview expirado ou já usado. Gere um novo preview.',CHANNEL_LOCK_BACKUP_REQUIRED:'Não existe backup de bloqueio Nexium para este canal.', DUPLICATE_STOCK:'Essa reposição contém uma unidade já cadastrada. Nenhuma unidade foi adicionada.',INVALID_STOCK:'Informe entre 1 e 50 unidades reais diferentes, uma por linha.', LINK_REQUIRED:'Conecte sua conta Discord em https://nexium-store.vercel.app → Minha conta.',FORBIDDEN:'Seu perfil não tem permissão para esta ação.',OUT_OF_STOCK:'Este produto está sem estoque. Nenhuma cobrança PIX foi criada.',VARIANT_UNAVAILABLE:'Esta opção está sem estoque.',VARIANT_REQUIRED:'Selecione uma opção em /nexium produto.',COUPON_UNAVAILABLE:'Cupom inválido, expirado ou sem usos disponíveis.',TOO_MANY_PENDING_ORDERS:'Você já tem três pedidos pendentes. Consulte /nexium pedidos.',PAYMENT_NOT_CONFIGURED:'O PIX ainda aguarda configuração do responsável pela loja.',PAYMENT_RESULT_UNCERTAIN:'O provedor não respondeu a tempo. Não repita a compra; procure o suporte para reconciliar o pedido.',PAYMENT_CREDENTIALS_INVALID:'O provedor recusou as credenciais da loja. Nenhum pagamento foi confirmado.',AMBIGUOUS_PRODUCT:'Encontrei mais de um produto. Informe o nome completo, slug ou ID.',PRODUCT_UNAVAILABLE:'Produto indisponível.',ORDER_NOT_OWNED:'Esse pedido não pertence à sua conta.',INVALID_ID:'Informe o ID completo correto.',ALREADY_ASSIGNED:'Este ticket já está com outro atendente.',CLAIM_REQUIRED:'Assuma o ticket antes de alterar ou finalizar.',TICKET_ID_REQUIRED:'Use este comando no canal do ticket ou informe o ID completo.',TICKET_NOT_FOUND:'Ticket não encontrado neste servidor.',STAFF_NOT_AUTHORIZED:'O atendente precisa de conta vinculada e cargo de suporte/admin no site.',TOO_MANY_OPEN_TICKETS:'Você já tem três tickets abertos.',RATING_NOT_ALLOWED:'Somente o cliente pode avaliar seu ticket encerrado.',CLOSE_REASON_REQUIRED:'Informe um motivo de pelo menos três caracteres e o resultado real.',PROTECTED_TICKET_MEMBER:'O cliente dono do ticket e o bot não podem ser removidos.',DISCORD_PERMISSION_DENIED:'O Discord recusou a permissão do bot para esta ação.',PANEL_BUSY_REVIEW:'Painel em processamento ou com resultado incerto. O administrador precisa revisar antes de repetir.',PANEL_PRODUCT_MISMATCH:'Esse painel está desativado ou não oferece mais esse produto.',MUTATION_UNCERTAIN:'O Discord não confirmou o resultado. Não repita a operação; solicite revisão do administrador.'};
