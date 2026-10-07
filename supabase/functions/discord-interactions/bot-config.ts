import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,row,button,linkButton,safeText,snowflake} from './api.ts';
import {privateMessage} from './security.ts';
const prefix='nexium:botconfig:';
const back=()=>row([button('Voltar à central',prefix+'tab:home',2)]);
const nav=(label:string,tab:string)=>button(label,prefix+'tab:'+tab,2);
const fields='pix_enabled,role_customer_id,role_support_id,category_support_id,channel_logs_id,grant_customer_role_on_paid,dm_customer_on_paid,dm_customer_on_delivery';
const settingOptions:Record<string,string>={pix_enabled:'pix',grant_customer_role_on_paid:'cargo_cliente_apos_pago',dm_customer_on_paid:'dm_pagamento',dm_customer_on_delivery:'dm_entrega',role_customer_id:'cliente',role_support_id:'suporte',category_support_id:'categoria_tickets',channel_logs_id:'logs'};
const pages=new Set(['home','marketplace','atendimento','definicoes','automacoes','moderacao','rendimento','tools','permissoes']);
const toggle=(label:string,field:string,enabled:boolean)=>button(`${label}: ${enabled?'Ligado':'Desligado'}`,prefix+`toggle:${field}:${enabled?'off':'on'}`,enabled?3:2);
const roleSelect=(field:string,label:string)=>row([{type:6,custom_id:prefix+'set:'+field,placeholder:label,min_values:1,max_values:1}]);
const channelSelect=(field:string,label:string,types:number[])=>row([{type:8,custom_id:prefix+'set:'+field,placeholder:label,channel_types:types,min_values:1,max_values:1}]);
const ref=(id:unknown,kind='role')=>snowflake(id)?kind==='role'?`<@&${id}>`:`<#${id}>`:'Não configurado';
export async function botConfigPanel(db:SupabaseClient,input:any,user:string,page='home',notice=''){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(!pages.has(page))throw new BotError('UNSUPPORTED_ACTION');
 const settings=checked(await db.from('discord_bot_settings').select(fields).eq('guild_id',input.guild_id).maybeSingle())||{};
 const name=safeText(input.member?.nick||input.member?.user?.global_name||actor.full_name,80);
 let title='Central de Controle',description='',components:any[]=[];
 const call=(label:string,action:string,option='')=>button(label,prefix+'run:'+action+(option?':'+option:''),2);
 if(page==='home'){
  title=`Olá, ${name} — Central de Controle`;
  description=`**Nexium Store**\n**Vendas Pix no Discord:** ${settings.pix_enabled?'Abertas':'Pausadas'}\n**Cargo Cliente:** ${ref(settings.role_customer_id)}\n**Cargo Suporte:** ${ref(settings.role_support_id)}\n**Categoria de tickets:** ${ref(settings.category_support_id,'channel')}\n\nSelecione uma área abaixo para gerenciar a loja. Alterações se aplicam a este servidor.`;
  components=[row([toggle('Vendas Pix', 'pix_enabled',!!settings.pix_enabled),nav('Marketplace','marketplace'),nav('Atendimento','atendimento')]),row([nav('Definições','definicoes'),nav('Automações','automacoes'),nav('Moderação','moderacao')]),row([nav('Rendimento','rendimento'),nav('Tools e backups','tools'),nav('Permissões','permissoes')]),row([linkButton('Personalizar loja','https://nexium-store.vercel.app/admin')])];
 }else if(page==='marketplace'){
  title='Gerenciar Marketplace';description='Consulte estoque e painéis, ou atualize o painel de solicitar produtos.\n**Repor estoque:** /gerenciar_stock acao:repor produto:nome\n**Criar cupom:** /cupom\n**Editar produtos e variantes:** administração da loja.';
  components=[row([call('Consultar estoque','estoque'),call('Listar painéis','paineis'),call('Painel de estoque','painel-estoque')]),row([linkButton('Produtos e variantes','https://nexium-store.vercel.app/admin')]),back()];
 }else if(page==='atendimento'||page==='permissoes'){
  title=page==='atendimento'?'Gerenciar Atendimento':'Gerenciar Permissões';description=`**Equipe de suporte:** ${ref(settings.role_support_id)}\n**Clientes:** ${ref(settings.role_customer_id)}\n**Tickets:** ${ref(settings.category_support_id,'channel')}\n\nSelecione os cargos e a categoria abaixo. As ações administrativas continuam exigindo perfil admin na loja. O cargo Discord sozinho não concede acesso administrativo.`;
  components=[roleSelect('role_support_id','Escolher cargo de Suporte'),roleSelect('role_customer_id','Escolher cargo de Cliente'),channelSelect('category_support_id','Escolher categoria de tickets',[4]),row([call('Relatório da equipe','suportes')]),back()];
 }else if(page==='definicoes'){
  title='Definições da Nexium';description=`**Logs:** ${ref(settings.channel_logs_id,'channel')}\n**Cliente após pagamento:** ${settings.grant_customer_role_on_paid?'Ligado':'Desligado'}\n**DM de pagamento:** ${settings.dm_customer_on_paid?'Ligada':'Desligada'}\n**DM de entrega:** ${settings.dm_customer_on_delivery?'Ligada':'Desligada'}\n\nOs avisos usam pagamento e entrega confirmados.`;
  components=[channelSelect('channel_logs_id','Escolher canal de logs',[0,5]),row([toggle('Cargo Cliente','grant_customer_role_on_paid',!!settings.grant_customer_role_on_paid)]),row([toggle('DM pagamento','dm_customer_on_paid',!!settings.dm_customer_on_paid),toggle('DM entrega','dm_customer_on_delivery',!!settings.dm_customer_on_delivery)]),back()];
 }else if(page==='automacoes'){
  title='Automações';const ai=checked(await db.from('discord_ai_settings').select('enabled,mode,model').eq('guild_id',input.guild_id).maybeSingle());
  description=`**IA:** ${ai?.enabled?'Ligada':'Desligada'}\n**Modo:** ${ai?.mode==='automatic'?'Responder no ticket':'Sugestões para a equipe'}\n**Modelo:** ${safeText(ai?.model||'Padrão',100)}\n\n**Agendar anúncio:** /nexium-admin agendar\n**Ajustar IA:** /nexium-admin ia\nPara ligar a IA, a chave do provedor precisa estar configurada no Supabase.`;
  components=[row([call(ai?.enabled?'Desligar IA':'Ligar IA','ia',ai?.enabled?'off':'on'),call('Mensagens programadas','mensagens')]),back()];
 }else if(page==='moderacao'){
  title='Moderação';description='Bloquear ou desbloquear o canal onde você abriu a central. Cada alteração mostra um preview e exige confirmação; as permissões anteriores ficam salvas.';
  components=[row([call('Bloquear canal','lock'),call('Desbloquear canal','unlock')]),back()];
 }else if(page==='rendimento'){
  title='Rendimento';description='Receita de pedidos confirmados, custos e taxas registrados. Pedidos sem conciliação são identificados no relatório.';
  components=[row([call('Hoje','financeiro','today'),call('Este mês','financeiro','month'),call('Total','financeiro','total')]),row([call('Ranking de produtos','ranking-produtos'),call('Relatório de suporte','suportes')]),back()];
 }else{
  title='Tools e backups';description='Escanear e salvar backups da estrutura do servidor. O preview mostra as mudanças propostas. A aplicação continua pelo comando /nexium-admin aplicar com o ID do preview revisado.\nBackups incluem estrutura e permissões; mensagens não são incluídas.';
  components=[row([call('Escanear servidor','scan'),call('Backup estrutural','backup'),call('Preview organizador','preview')]),row([linkButton('Admin e logs','https://nexium-store.vercel.app/admin')]),back()];
 }
 return {...privateMessage(notice),embeds:[{title,description,color:0xe3e5e8,footer:{text:'Nexium Store • Controle administrativo'},timestamp:new Date().toISOString()}],components};
}
export async function botConfigAction(db:SupabaseClient,input:any,user:string,execute:(sub:string,options:Record<string,any>)=>Promise<any>){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const [action,value,argument,extra]=String(input.data.custom_id).slice(prefix.length).split(':');if(extra)throw new BotError('UNSUPPORTED_ACTION');
 if(action==='tab')return botConfigPanel(db,input,user,value);
 if(action==='toggle'){
  if(!['pix_enabled','grant_customer_role_on_paid','dm_customer_on_paid','dm_customer_on_delivery'].includes(value)||!['on','off'].includes(argument))throw new BotError('UNSUPPORTED_ACTION');
  await execute('configurar',{[settingOptions[value]]:argument==='on'});
  return botConfigPanel(db,input,user,value==='pix_enabled'?'home':'definicoes','Configuração salva.');
 }
 if(action==='set'){
  if(!['role_customer_id','role_support_id','category_support_id','channel_logs_id'].includes(value)||input.data.values?.length!==1||!snowflake(input.data.values[0]))throw new BotError('INVALID_ID');
  await execute('configurar',{[settingOptions[value]]:input.data.values[0]});
  return botConfigPanel(db,input,user,value==='channel_logs_id'?'definicoes':'atendimento','Configuração salva.');
 }
 if(action==='run'){
  if(!['estoque','paineis','painel-estoque','suportes','mensagens','lock','unlock','financeiro','ranking-produtos','scan','backup','preview','ia'].includes(value))throw new BotError('UNSUPPORTED_ACTION');
  if(argument&&!((value==='financeiro'&&['today','month','total'].includes(argument))||(value==='ia'&&['on','off'].includes(argument))))throw new BotError('UNSUPPORTED_ACTION');
  const result=await execute(value,value==='financeiro'?{periodo:argument||'total'}:value==='ia'?{ligada:argument==='on'}:{});
  if(value==='ia')return botConfigPanel(db,input,user,'automacoes','Configuração da IA salva.');
  return {...result,components:[...(result.components||[]),back()]};
 }
 throw new BotError('UNSUPPORTED_ACTION');
}
