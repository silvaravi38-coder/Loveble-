import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord,safeText} from './api.ts';
import {ticketControls} from './ticket-ui.ts';
export function ticketCard(id:string,ticket:any,owner:any,assigned:any,staffRole?:string){
 const closed=['resolved','closed'].includes(ticket.status),avatar=owner.avatar&&/^[a-f0-9_]+$/i.test(owner.avatar)?`https://cdn.discordapp.com/avatars/${owner.id}/${owner.avatar}.png?size=128`:undefined;
 return {content:null,allowed_mentions:{parse:[]},embeds:[{title:closed?'Atendimento encerrado • Nexium':'Seu atendimento • Nexium',description:'Este espaço é privado para você e a equipe. Explique sua dúvida e envie as informações necessárias para analisarmos o caso.',color:closed?0x747f8d:0x202225,...(avatar?{thumbnail:{url:avatar}}:{}),fields:[{name:'Cliente',value:safeText(owner.username||owner.name||owner.id,100),inline:true},{name:'Status',value:closed?(ticket.status==='resolved'?'Resolvido':'Encerrado'):(ticket.assigned_to?'Em atendimento':'Aguardando atendimento'),inline:true},{name:'Atendente',value:assigned?safeText(assigned.username||assigned.full_name,100):'Aguardando a equipe',inline:true},{name:'Assunto',value:safeText(ticket.subject,500)},{name:'Abertura',value:`<t:${Math.floor(Date.parse(ticket.created_at)/1000)}:F>`,inline:true},{name:'Prioridade',value:({low:'Baixa',normal:'Normal',high:'Alta',urgent:'Urgente'} as Record<string,string>)[ticket.priority]||safeText(ticket.priority,30),inline:true},...(ticket.order_id?[{name:'Pedido relacionado',value:ticket.order_id}]:[]),...(staffRole?[{name:'Equipe responsável',value:`<@&${staffRole}>`}]:[]),{name:'Como agilizar o atendimento',value:'Conte o que aconteceu e inclua o número do pedido quando houver. Não envie senhas ou dados bancários. Aguarde a resposta da equipe neste canal.'}],footer:{text:`Nexium • Ticket ${id}`},timestamp:ticket.created_at}],components:ticketControls(id,closed)};
}
export async function refreshTicketCard(db:SupabaseClient,view:any){
 if(!view.discord.card_message_id||!view.discord.channel_id||view.discord.deleted_at)return;
 const owner=checked(await db.from('discord_account_links').select('discord_user_id,discord_username').eq('profile_id',view.ticket.user_id).single());
 const assigned=view.ticket.assigned_to?checked(await db.from('profiles').select('full_name').eq('id',view.ticket.assigned_to).single()):null;
 const settings=checked(await db.from('discord_bot_settings').select('role_support_id').eq('guild_id',view.discord.guild_id).maybeSingle());
 await discord(`/channels/${view.discord.channel_id}/messages/${view.discord.card_message_id}`,'PATCH',ticketCard(view.ticket.id,view.ticket,{id:owner.discord_user_id,username:owner.discord_username},assigned,settings?.role_support_id));
}
