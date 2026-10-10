import {nexiumBrand} from './brand.ts';
import {paymentConfigStatus} from './payment-config.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,row,button,linkButton,safeText,snowflake} from './api.ts';
import {privateMessage} from './security.ts';
const prefix='nexium:botconfig:';
const back=()=>row([{...button('Voltar à central',prefix+'tab:home',2),emoji:{name:'↩️'}}]);
const icons:Record<string,string>={home:'🏠',marketplace:'🛍️',atendimento:'🎧',definicoes:'⚙️',automacoes:'🔄',moderacao:'🛡️',rendimento:'📊',tools:'🧰',permissoes:'👥',pagamentos:'💳',cargos:'👤',canais:'📂',notificacoes:'🔔',ia:'🤖',divulgacao:'📣',personalizacao:'🎨',oauth:'☁️'};
const nav=(label:string,tab:string)=>({...button(label,prefix+'tab:'+tab,['marketplace','atendimento'].includes(tab)?1:2),emoji:{name:icons[tab]||'⚙️'}});
const fields='pix_enabled,role_customer_id,role_support_id,category_support_id,channel_logs_id,grant_customer_role_on_paid,dm_customer_on_paid,dm_customer_on_delivery';
const settingOptions:Record<string,string>={pix_enabled:'pix',grant_customer_role_on_paid:'cargo_cliente_apos_pago',dm_customer_on_paid:'dm_pagamento',dm_customer_on_delivery:'dm_entrega',role_customer_id:'cliente',role_support_id:'suporte',category_support_id:'categoria_tickets',channel_logs_id:'logs'};
const pages=new Set(['home','marketplace','atendimento','definicoes','automacoes','moderacao','rendimento','tools','permissoes','pagamentos','cargos','canais','notificacoes','ia','divulgacao','personalizacao','oauth']);
const toggle=(label:string,field:string,enabled:boolean)=>button(`${label}: ${enabled?'Ligado':'Desligado'}`,prefix+`toggle:${field}:${enabled?'off':'on'}`,enabled?3:2);
const roleSelect=(field:string,label:string)=>row([{type:6,custom_id:prefix+'set:'+field,placeholder:label,min_values:1,max_values:1}]);
const channelSelect=(field:string,label:string,types:number[])=>row([{type:8,custom_id:prefix+'set:'+field,placeholder:label,channel_types:types,min_values:1,max_values:1}]);
const ref=(id:unknown,kind='role')=>snowflake(id)?kind==='role'?`<@&${id}>`:`<#${id}>`:'Não configurado';
export async function botConfigPanel(db:SupabaseClient,input:any,user:string,page='home',notice=''){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(!pages.has(page))throw new BotError('UNSUPPORTED_ACTION');
 const settings=checked(await db.from('discord_bot_settings').select(fields).eq('guild_id',input.guild_id).maybeSingle())||{};
 const name=safeText(input.member?.nick||input.member?.user?.global_name||actor.full_name,80);
 let title='Central de Controle',description='',components:any[]=[],summary:any[]=[];
 const call=(label:string,action:string,option='')=>button(label,prefix+'run:'+action+(option?':'+option:''),2);
 if(page==='home'){
  title=`Olá, ${name||'Administrador'}!`;
  description='Bem-vindo à **Central de Controle da Nexium Store**.\nGerencie sua loja, acompanhe os resultados e cuide dos seus clientes.\n\n**O que deseja fazer agora?**\nEscolha uma área nos botões abaixo.';
  summary=[
   {name:'💳 Vendas Pix',value:settings.pix_enabled?'🟢 Abertas':'⏸️ Pausadas',inline:true},
   {name:'🎧 Equipe de suporte',value:ref(settings.role_support_id),inline:true},
   {name:'👤 Cargo de cliente',value:ref(settings.role_customer_id),inline:true},
  ];
  components=[row([toggle('Vendas Pix', 'pix_enabled',!!settings.pix_enabled),nav('Marketplace','marketplace'),nav('Atendimento','atendimento')]),row([nav('Definições','definicoes'),nav('Automações','automacoes'),nav('Moderação','moderacao')]),row([nav('Rendimento','rendimento'),nav('Ferramentas e backups','tools'),nav('Permissões','permissoes')]),row([nav('Personalização','personalizacao'),nav('Conexão e nuvem','oauth')])];
 }else if(page==='marketplace'){
  title='Gerenciar Marketplace';description='Crie canais de venda automaticamente para cada produto ativo do site. Cada canal recebe o card atualizado do produto com preço, imagem, opções e botão de compra.\n\nConsulte estoque e painéis, ou atualize o painel de solicitar produtos.\n**Entregas manuais:** os pedidos pagos aparecem no canal privado de logs, com confirmação de entrega e alerta após 9 horas.\n**Repor estoque:** /gerenciar_stock acao:repor produto:nome\n**Criar cupom:** /cupom\n**Editar produtos e variantes:** administração da loja.';
  components=[row([call('Criar canais de venda','canais-vendas')]),row([call('Consultar estoque','estoque'),call('Listar painéis','paineis'),call('Painel de estoque','painel-estoque')]),row([linkButton('Produtos e variantes','https://nexium-store.vercel.app/admin')]),back()];
 }else if(page==='atendimento'||page==='permissoes'){
  title=page==='atendimento'?'Gerenciar Atendimento':'Gerenciar Permissões';description=`**Equipe de suporte:** ${ref(settings.role_support_id)}\n**Clientes:** ${ref(settings.role_customer_id)}\n**Categoria de suporte:** ${ref(settings.category_support_id,'channel')}\n\nNovos tickets abrem como conversas privadas dentro do canal do painel de atendimento.\n\nSelecione os cargos e a categoria abaixo. As ações administrativas continuam exigindo perfil admin na loja. O cargo Discord sozinho não concede acesso administrativo.`;
  components=[roleSelect('role_support_id','Escolher cargo de Suporte'),roleSelect('role_customer_id','Escolher cargo de Cliente'),channelSelect('category_support_id','Escolher categoria de tickets',[4]),row([call('Relatório da equipe','suportes')]),back()];
 }else if(page==='definicoes'){
  title='O que precisa configurar?';description='Gerencie pagamentos, cargos, canais e notificações. Escolha uma categoria para continuar.';
  components=[row([nav('Formas de pagamento','pagamentos')]),row([nav('Cargos','cargos'),nav('Canais','canais')]),row([nav('Notificações','notificacoes')]),back()];
 }else if(page==='pagamentos'){
  const status=await paymentConfigStatus(db,input.guild_id);
  title='Formas de pagamento';description=`**Pix no Discord:** ${settings.pix_enabled?'Ligado':'Desligado'}\n**Provedor:** TurbofyPay\n**Conexão:** ${status.configured?'Configurada':'Aguardando credenciais'} • ${status.source}\n\nUse Configurar Pix para salvar ou substituir o Client ID e o Client Secret neste formulário privado. As credenciais não são exibidas novamente.\n\nO QR Code e o copia e cola são gerados para cada pedido. Pagamentos são confirmados pelo provedor. Para consultar uma cobrança, use /payments com o ID do pedido.`;
  components=[row([toggle('Vendas Pix','pix_enabled',!!settings.pix_enabled)]),row([button('Configurar Pix','nexium:payment-config:edit')]),back()];
 }else if(page==='cargos'){
  title='Configurar Cargos';description=`**Cliente:** ${ref(settings.role_customer_id)}\n**Suporte:** ${ref(settings.role_support_id)}\nEscolhas manuais de cargos são preservadas pelo organizador.`;
  components=[roleSelect('role_customer_id','Escolher cargo de Cliente'),roleSelect('role_support_id','Escolher cargo de Suporte'),row([toggle('Cliente após pagamento','grant_customer_role_on_paid',!!settings.grant_customer_role_on_paid)]),back()];
 }else if(page==='canais'){
  title='Configurar Canais';description=`**Logs:** ${ref(settings.channel_logs_id,'channel')}\n**Categoria de tickets:** ${ref(settings.category_support_id,'channel')}\nSelecione canais deste servidor.`;
  components=[channelSelect('channel_logs_id','Escolher canal de logs',[0,5]),channelSelect('category_support_id','Escolher categoria de tickets',[4]),back()];
 }else if(page==='notificacoes'){
  title='Notificações';description=`**DM de pagamento:** ${settings.dm_customer_on_paid?'Ligada':'Desligada'}\n**DM de entrega:** ${settings.dm_customer_on_delivery?'Ligada':'Desligada'}\nAvisos usam pagamentos e entregas confirmados. O cliente pode bloquear mensagens diretas no Discord.`;
  components=[row([toggle('DM pagamento','dm_customer_on_paid',!!settings.dm_customer_on_paid),toggle('DM entrega','dm_customer_on_delivery',!!settings.dm_customer_on_delivery)]),back()];
 }else if(page==='automacoes'){
  title='Ações Automáticas';description='Escolha uma automação para gerenciar. Mensagens programadas, notificações e IA utilizam os serviços já configurados na Nexium.';
  components=[row([{type:3,custom_id:prefix+'select:automation',placeholder:'Escolha uma automação para configurar',min_values:1,max_values:1,options:[{label:'Mensagens Automáticas',value:'divulgacao',description:'Anúncios e mensagens programadas'},{label:'Notificações de compra',value:'notificacoes',description:'Avisos de pagamento e entrega confirmados'},{label:'Gerenciar Canais (Lock/Unlock)',value:'moderacao',description:'Preview e restauração de permissões'},{label:'Atendimento por IA',value:'ia',description:'Ligar, desligar e consultar configuração'}]}]),back()];
 }else if(page==='ia'){
  title='Atendimento por IA';const ai=checked(await db.from('discord_ai_settings').select('enabled,mode,model').eq('guild_id',input.guild_id).maybeSingle());
  const maps=checked(await db.from('discord_tickets').select('ticket_id').eq('guild_id',input.guild_id).is('closed_at',null).limit(100)) as any[];
  const health=maps.length?checked(await db.from('discord_ticket_chat_cursors').select('last_error').in('ticket_id',maps.map(m=>m.ticket_id)).not('last_error','is',null).order('last_polled_at',{ascending:false}).limit(1)) as any[]:[];
  description=`**IA:** ${ai?.enabled?'Ligada':'Desligada'}\n**Modo:** ${ai?.mode==='automatic'?'Responder no ticket':'Sugestões para a equipe'}\n**Modelo:** ${safeText(typeof Deno!=='undefined'&&Deno.env.get('GROQ_API_KEY')?'Groq • openai/gpt-oss-20b':ai?.model||'Padrão',100)}\n\n**Usar sugestões:** /ticket ia (staff).\n**Resposta no ticket:** escreva normalmente no canal (verificação a cada minuto) ou use /ticket mensagem.\nPara ler o chat, Message Content Intent precisa estar ativo no Discord Developer Portal. Assumir o ticket pausa as respostas automáticas.`;
  description+='\n\n**Sem cartão:** respostas básicas pelo catálogo quando o provedor está sem créditos. Para IA completa sem AI Gateway, configure GROQ_API_KEY nos secrets do Supabase. Não envie chaves no chat.';
  components=[row([call(ai?.enabled?'Desligar IA':'Ligar IA','ia',ai?.enabled?'off':'on')]),row([call('Somente sugestões','ia','suggest'),call('Responder no chat do ticket','ia','automatic')]),back()];
  if(health[0]?.last_error==='AI_BILLING_REQUIRED'){description+='\n\n**Modo básico disponível:** o AI Gateway está bloqueado por faturamento; novas mensagens recebem orientações automáticas do catálogo.';components.splice(2,0,row([linkButton('Configurar conta do AI Gateway','https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card')]));}
  else if(health[0]?.last_error){description+=health[0].last_error==='MESSAGE_CONTENT_REQUIRED'?'\n\n**Leitura do chat bloqueada:** ative Message Content Intent em Bot → Privileged Gateway Intents no Developer Portal e salve.':'\n\n**Último erro do atendimento:** '+safeText(health[0].last_error,100);components.splice(2,0,row([linkButton('Abrir configurações do Discord','https://discord.com/developers/applications/1557132199227031552/bot')]));}
 }else if(page==='divulgacao'){
  title='Divulgação e Mensagens Automáticas';description='**Publicar agora:** /anunciar texto:mensagem\n**Agendar:** /nexium-admin agendar texto:mensagem quando:data\nUse data e horário com fuso, por exemplo 2026-10-08T12:00:00-03:00.\n**Cancelar:** /nexium-admin cancelar-mensagem mensagem:ID\nMenções automáticas ficam desativadas.';
  components=[row([call('Ver mensagens programadas','mensagens')]),back()];
 }else if(page==='personalizacao'){
  title='Personalização da Loja';description='A identidade visual da Nexium é gerenciada na administração da loja. Para mensagens do catálogo, consulte os painéis publicados. O QR Pix é gerado pelo provedor para cada pedido.';
  components=[row([linkButton('Personalizar loja e banners','https://nexium-store.vercel.app/admin')]),row([nav('Mensagens de venda','marketplace'),nav('QR Code Pix','pagamentos')]),back()];
 }else if(page==='oauth'){
  title='Conexão Discord e Nuvem';description='A Nexium usa OAuth para conectar a conta Discord à conta do cliente na loja.\n**Vincular conta:** /nexium vincular\n**Backups:** estrutura do servidor salva no Supabase. Mensagens não são incluídas.\nEsta conexão identifica o cliente; ela não transfere membros entre servidores.';
  components=[row([linkButton('Conectar minha conta','https://nexium-store.vercel.app'),nav('Backups e nuvem','tools')]),back()];
 }else if(page==='moderacao'){
  title='Moderação';description='Bloquear ou desbloquear o canal onde você abriu a central. Cada alteração mostra um preview e exige confirmação; as permissões anteriores ficam salvas.';
  components=[row([call('Bloquear canal','lock'),call('Desbloquear canal','unlock')]),back()];
 }else if(page==='rendimento'){
  title='Rendimento';description='Receita de pedidos confirmados, custos e taxas registrados. Pedidos sem conciliação são identificados no relatório.';
  components=[row([call('Hoje','financeiro','today'),call('Últimos 7 dias','financeiro','7days'),call('Últimos 30 dias','financeiro','30days')]),row([call('Este mês','financeiro','month'),call('Total','financeiro','total')]),row([call('Ranking de produtos','ranking-produtos'),call('Relatório de suporte','suportes')]),back()];
 }else{
  title='Ferramentas e backups';description='Escanear e salvar backups da estrutura do servidor. O preview mostra as mudanças propostas. A aplicação continua pelo comando /nexium-admin aplicar com o ID do preview revisado.\nBackups incluem estrutura e permissões; mensagens não são incluídas.';
  components=[row([nav('Divulgação','divulgacao'),call('Checkers da loja','diagnostico')]),row([call('Escanear servidor','scan'),call('Backup estrutural','backup'),call('Preview organizador','preview')]),row([linkButton('Admin e logs','https://nexium-store.vercel.app/admin')]),back()];
 }
 const userInfo=input.member?.user;
 const avatar=snowflake(userInfo?.id)&&/^[a-f0-9_]+$/i.test(userInfo?.avatar||'')?`https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png?size=128`:undefined;
 return {...privateMessage(''),embeds:[{author:{name:'NEXIUM STORE • CENTRAL DE CONTROLE'},title:`${icons[page]||'⚙️'} ${title}`,description,...(summary.length||notice?{fields:[...summary,...(notice?[{name:'✅ Atualização concluída',value:safeText(notice,500),inline:false}]:[])]}:{}),...(page==='home'&&avatar?{thumbnail:{url:avatar}}:{}),color:notice?nexiumBrand.success:nexiumBrand.accent,footer:{text:'Nexium Store • Painel exclusivo da administração'},timestamp:new Date().toISOString()}],components};
}
export async function botConfigAction(db:SupabaseClient,input:any,user:string,execute:(sub:string,options:Record<string,any>)=>Promise<any>){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const [action,value,argument,extra]=String(input.data.custom_id).slice(prefix.length).split(':');if(extra)throw new BotError('UNSUPPORTED_ACTION');
 if(action==='select'){if(value!=='automation'||input.data.values?.length!==1||!['divulgacao','notificacoes','moderacao','ia'].includes(input.data.values[0]))throw new BotError('UNSUPPORTED_ACTION');return botConfigPanel(db,input,user,input.data.values[0]);}
 if(action==='tab')return botConfigPanel(db,input,user,value);
 if(action==='toggle'){
  if(!['pix_enabled','grant_customer_role_on_paid','dm_customer_on_paid','dm_customer_on_delivery'].includes(value)||!['on','off'].includes(argument))throw new BotError('UNSUPPORTED_ACTION');
  await execute('configurar',{[settingOptions[value]]:argument==='on'});
  return botConfigPanel(db,input,user,value==='pix_enabled'?'pagamentos':value==='grant_customer_role_on_paid'?'cargos':'notificacoes','Configuração salva.');
 }
 if(action==='set'){
  if(!['role_customer_id','role_support_id','category_support_id','channel_logs_id'].includes(value)||input.data.values?.length!==1||!snowflake(input.data.values[0]))throw new BotError('INVALID_ID');
  await execute('configurar',{[settingOptions[value]]:input.data.values[0]});
  return botConfigPanel(db,input,user,value==='channel_logs_id'?'canais':value==='category_support_id'?'canais':'cargos','Configuração salva.');
 }
 if(action==='run'){
  if(!['estoque','paineis','painel-estoque','canais-vendas','suportes','mensagens','lock','unlock','financeiro','ranking-produtos','scan','backup','preview','ia','diagnostico'].includes(value))throw new BotError('UNSUPPORTED_ACTION');
  if(argument&&!((value==='financeiro'&&['today','month','total','7days','30days'].includes(argument))||(value==='ia'&&['on','off','suggest','automatic'].includes(argument))))throw new BotError('UNSUPPORTED_ACTION');
  const result=await execute(value,value==='financeiro'?{periodo:argument||'total'}:value==='ia'?['suggest','automatic'].includes(argument)?{modo:argument}:{ligada:argument==='on'}:{});
  if(value==='ia')return botConfigPanel(db,input,user,'ia','Configuração da IA salva.');
  return {...result,components:[...(result.components||[]),back()]};
 }
 throw new BotError('UNSUPPORTED_ACTION');
}
