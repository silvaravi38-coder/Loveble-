import {isTicketChannel} from './ticket-channel.ts';
import {BotError,discord} from './api.ts';
export function ticketChannelName(reason:string,id:string){
 const subjects:Record<string,string>={'Suporte':'suporte','Dúvida':'duvida','Receber Produto':'receber-produto','Vaga Staff':'vaga-staff','Ajuda com produto':'ajuda-produto','Compra e entrega':'compra-entrega','Pagamento PIX':'pagamento-pix','Outros assuntos':'outros-assuntos'};
 const subject=reason.split(':')[0].trim();
 const slug=subjects[subject]||subject.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'atendimento';
 return `${slug}-${id.slice(0,8)}`;
}
export async function deleteClosedTicketChannel(view:any,guild:string,request:typeof discord=discord){
 if(!view.discord.closed_at||!['resolved','closed'].includes(view.ticket.status))throw new BotError('TICKET_CLOSE_BEFORE_DELETE');
 if(view.discord.deleted_at||!view.discord.channel_id)return;
 const path=`/channels/${view.discord.channel_id}`;
 let channel;
 try{channel=await request(path);}catch(error){if(error instanceof BotError&&error.code==='DISCORD_RESOURCE_NOT_FOUND')return;throw error;}
 if(!isTicketChannel(channel,guild,view.ticket.id,view.discord.channel_id)||view.discord.channel_state!=='ready')throw new BotError('PROTECTED_TICKET_CHANNEL');
 try{await request(path,'DELETE');}catch(error){if(!(error instanceof BotError)||error.code!=='DISCORD_RESOURCE_NOT_FOUND')throw error;}
}
