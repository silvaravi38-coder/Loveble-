import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord,safeText} from './api.ts';
import {ticketControls} from './ticket-ui.ts';

const priorityLabel:Record<string,string>={low:'🟢 Baixa',normal:'🔵 Normal',high:'🟠 Alta',urgent:'🔴 Urgente'};

export function ticketCard(id:string,ticket:any,owner:any,assigned:any,staffRole?:string){
 const closed=['resolved','closed'].includes(ticket.status);
 const avatar=owner.avatar&&/^[a-f0-9_]+$/i.test(owner.avatar)?`https://cdn.discordapp.com/avatars/${owner.id}/${owner.avatar}.png?size=128`:undefined;
 const opened=Math.floor(Date.parse(ticket.created_at)/1000);
 const ownerLabel=owner.id?`<@${owner.id}>`:safeText(owner.username||owner.name||'Cliente',100);
 const assignedLabel=assigned?safeText(assigned.username||assigned.full_name,100):'Ninguém';
 return {
  content:null,
  allowed_mentions:{parse:[]},
  embeds:[{
   image:{url:'https://flcqndjlzuhmxxahjudj.supabase.co/storage/v1/object/public/product-images/discord/nexium-atendimento.png'},
   author:{name:safeText(owner.username||owner.name||'Cliente',100),...(avatar?{icon_url:avatar}:{})},
   title:closed?'🔒 | Atendimento encerrado':safeText(ticket.subject?.split(':')[0]||'Suporte',100),
   description:closed
    ?`O atendimento de ${ownerLabel} foi encerrado. O histórico continua registrado na Nexium Store.`
    :`✌️ Olá, ${ownerLabel}. Em que podemos ajudar?\n<:info:1555363211207905280> Por favor, aguarde enquanto um membro da nossa equipe venha lhe atender.\n\nExplique o que precisa neste canal.`,
   color:closed?0x747f8d:0xe3e5e8,
   ...(avatar?{thumbnail:{url:avatar}}:{}),
   fields:[
    {name:'ℹ️ | Informações',value:[
      `🔧 **Setor:** ${safeText(ticket.subject?.split(':')[0]||'Suporte',100)}`,
      `📅 **Data:** <t:${opened}:F>`,
      `👤 **Cliente:** ${ownerLabel}`,
      `👥 **Assumido:** ${assignedLabel}`,
      staffRole?`🛠️ **Suporte:** <@&${staffRole}>`:'🛠️ **Suporte:** Equipe Nexium',
      `📊 **Status:** ${closed?(ticket.status==='resolved'?'Resolvido':'Encerrado'):(ticket.assigned_to?'Em atendimento':'Aguardando atendimento')}`,
      `⚡ **Prioridade:** ${priorityLabel[ticket.priority]||safeText(ticket.priority||'Normal',30)}`
    ].join('\n')},
    {name:'💬 | Assunto',value:safeText(ticket.subject||'Atendimento',500)},
    ...(ticket.order_id?[{name:'📦 | Pedido relacionado',value:`\`${ticket.order_id}\``}]:[]),
    {name:'📌 | Avisos',value:closed
      ?'⭐ Você pode avaliar o atendimento abaixo. O transcript permanece disponível para consulta.'
      :'• Aguarde um atendente assumir o ticket.\n• Não marque a equipe repetidamente.\n• Não envie senhas, códigos de acesso ou dados bancários.\n• Se for sobre uma compra, tenha o número do pedido em mãos.'}
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
