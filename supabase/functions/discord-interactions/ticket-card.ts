import {nexiumBrand} from './brand.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord,safeText} from './api.ts';
import {ticketControls} from './ticket-ui.ts';

const priorityLabel:Record<string,string>={low:'🟢 Baixa',normal:'🔵 Normal',high:'🟠 Alta',urgent:'🔴 Urgente'};

export function ticketCard(id:string,ticket:any,owner:any,assigned:any,staffRole?:string){
 const closed=['resolved','closed'].includes(ticket.status);
 const avatar=owner.avatar&&/^[a-f0-9_]+$/i.test(owner.avatar)?`https://cdn.discordapp.com/avatars/${owner.id}/${owner.avatar}.png?size=128`:undefined;
 const opened=Math.floor(Date.parse(ticket.created_at)/1000);
 const ownerLabel=owner.id?`<@${owner.id}>`:safeText(owner.username||owner.name||'Cliente',100);
 const assignedLabel=assigned?safeText(assigned.username||assigned.full_name,100):'Aguardando equipe';
 return {
  content:null,
  allowed_mentions:{parse:[]},
  embeds:[{
   image:{url:nexiumBrand.banner},
   author:{name:safeText(owner.username||owner.name||'Cliente',100),...(avatar?{icon_url:avatar}:{})},
   title:closed?'🔒 | Atendimento encerrado':'Atendimento • '+safeText(ticket.subject?.split(':')[0]||'Suporte',100),
   description:closed
    ?`O atendimento de ${ownerLabel} foi encerrado. O histórico continua registrado na Nexium Store.`
    :`Olá, ${ownerLabel}! Bem-vindo ao seu atendimento privado.\n\nConte o que você precisa e acompanhe a conversa por aqui. A equipe e o atendimento automático podem ajudar neste canal.`,
   color:closed?nexiumBrand.muted:ticket.assigned_to?nexiumBrand.success:nexiumBrand.accent,
   ...(avatar?{thumbnail:{url:avatar}}:{}),
   fields:[
    {name:'STATUS',value:closed?(ticket.status==='resolved'?'Resolvido':'Encerrado'):(ticket.assigned_to?'Em atendimento':'Aguardando atendimento'),inline:true},
    {name:'ATENDENTE',value:assignedLabel,inline:true},
    {name:'PRIORIDADE',value:priorityLabel[ticket.priority]||safeText(ticket.priority||'Normal',30),inline:true},
    {name:'DETALHES',value:[`**Cliente:** ${ownerLabel}`,`**Aberto:** <t:${opened}:f>`,staffRole?`**Equipe:** <@&${staffRole}>`:'**Equipe:** Suporte Nexium'].join('\n')},
    {name:'💬 | Assunto',value:safeText(ticket.subject||'Atendimento',500)},
    ...(ticket.order_id?[{name:'📦 | Pedido relacionado',value:`\`${ticket.order_id}\``}]:[]),
    {name:'📌 | Avisos',value:closed
      ?'⭐ Você pode avaliar o atendimento abaixo. O transcript permanece disponível para consulta.'
      :'• Se a dúvida for sobre uma compra, informe o número do pedido.\n• Proteja seus dados: não envie senhas ou códigos de acesso.\n• Use o menu abaixo para acessar suas opções.'}
   ],
   footer:{text:`Nexium Store • Ticket #${id.slice(0,8)}`},
   timestamp:ticket.created_at
  }],
  components:ticketControls(id,closed)
 };
}
export async function refreshTicketCard(db:SupabaseClient,view:any){
 if(!view.discord.card_message_id||!view.discord.channel_id||view.discord.deleted_at)return;
 const owner=checked(await db.from('discord_account_links').select('discord_user_id,discord_username').eq('profile_id',view.ticket.user_id).single());
 const assigned=view.ticket.assigned_to?checked(await db.from('profiles').select('full_name').eq('id',view.ticket.assigned_to).single()):null;
 const settings=checked(await db.from('discord_bot_settings').select('role_support_id').eq('guild_id',view.discord.guild_id).maybeSingle());
 await discord(`/channels/${view.discord.channel_id}/messages/${view.discord.card_message_id}`,'PATCH',ticketCard(view.ticket.id,view.ticket,{id:owner.discord_user_id,username:owner.discord_username},assigned,settings?.role_support_id));
}
