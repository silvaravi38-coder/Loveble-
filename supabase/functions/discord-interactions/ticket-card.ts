import {nexiumBrand} from './brand.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord,safeText} from './api.ts';
import {ticketControls,ticketSubjects} from './ticket-ui.ts';

export function ticketCard(id:string,ticket:any,owner:any,_assigned:any,_staffRole?:string){
 const closed=['resolved','closed'].includes(ticket.status);
 const avatar=owner.avatar&&/^[a-f0-9_]+$/i.test(owner.avatar)?`https://cdn.discordapp.com/avatars/${owner.id}/${owner.avatar}.png?size=128`:/^[0-9]{17,20}$/.test(owner.id||'')?`https://cdn.discordapp.com/embed/avatars/${Number((BigInt(owner.id)>>22n)%6n)}.png`:undefined;
 const subject=String(ticket.subject||'Suporte').split(':')[0].trim();
 const sector=ticketSubjects.find(s=>s.label.toLocaleLowerCase('pt-BR')===subject.toLocaleLowerCase('pt-BR'));
 return {
  content:null,
  allowed_mentions:{parse:[]},
  embeds:[{
   author:{name:safeText(owner.username||owner.global_name||owner.name||'Cliente',100),...(avatar?{icon_url:avatar}:{})},
   title:closed?'Atendimento encerrado':safeText(sector?.label||subject,100),
   description:closed?'Este atendimento foi encerrado. O histórico permanece salvo na Nexium Store.':sector?.description||safeText(ticket.subject||'Clique aqui caso precise de suporte.',500),
   image:{url:nexiumBrand.banner},
   color:0xffffff,
   footer:{text:'Nexium Store'},
   timestamp:ticket.created_at
  }],
  components:ticketControls(id,closed)
 };
}
export async function refreshTicketCard(db:SupabaseClient,view:any){
 if(!view.discord.card_message_id||!view.discord.channel_id||view.discord.deleted_at)return;
 const owner=checked(await db.from('discord_account_links').select('discord_user_id,discord_username').eq('profile_id',view.ticket.user_id).single());
 let user={id:owner.discord_user_id,username:owner.discord_username};
 try{const member=await discord(`/guilds/${view.discord.guild_id}/members/${owner.discord_user_id}`);if(member.user?.id===owner.discord_user_id)user=member.user;}catch{/* Keep the existing linked identity if the member lookup is unavailable. */}
 await discord(`/channels/${view.discord.channel_id}/messages/${view.discord.card_message_id}`,'PATCH',ticketCard(view.ticket.id,view.ticket,user,null));
}
