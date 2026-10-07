import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,uuid,row,button,safeText} from './api.ts';
import {openTicket,actTicket,ticketRpc} from './tickets.ts';
export const ticketSubjects=[
 {label:'Suporte',value:'support',description:'Clique aqui caso precise de suporte.'},
 {label:'Dúvida',value:'doubt',description:'Clique aqui caso tenha dúvida.'},
 {label:'Receber Produto',value:'delivery',description:'Clique aqui para receber seu produto.'},
 {label:'Vaga Staff',value:'staff',description:'Clique aqui caso deseje ser Staff.'},
];
export function ticketPanel(panel:any,disabled=false,emojis:any[]=[]){
 const local=(names:string[],fallback:string)=>{const emoji=names.flatMap(name=>emojis.filter(e=>e.available!==false&&!(e.roles?.length)&&e.name.toLowerCase().includes(name)))[0];return emoji?{id:emoji.id,name:emoji.name,animated:!!emoji.animated}:{name:fallback};};
 const text=(emoji:any)=>emoji.id?`<${emoji.animated?'a':''}:${emoji.name}:${emoji.id}>`:emoji.name;
 const support=local(['suporte','support','headphone','atendimento'],'🎧'),clock=local(['relogio','clock','time','info'],'🕒'),arrow=local(['seta','arrow','right'],'➡️');
 const icons=[support,local(['sino','bell','duvida','notify','info'],'🔔'),local(['caixa','box','produto','package'],'📦'),local(['trevo','clover','staff','admingreen','roles1'],'🍀')];
 return {content:null,allowed_mentions:{parse:[]},embeds:[{title:'Bem-vindo à Central de Atendimento',description:disabled?'Este painel está despublicado.':`${text(support)} **Bem-vindo à Central de Atendimento**\n> Para que possamos iniciar o seu atendimento, **__escolha um setor no menu abaixo.__**\n\n__**Horário de Atendimento:**__\n\n${text(clock)} __Segunda a Sexta__\n${text(arrow)} **08:00 às 11:00 e 20:30 às 22:00**\n\n${text(clock)} __Sábado__\n${text(arrow)} **10:00 às 21:00**\n\nSelecione uma opção abaixo para continuar:`,color:0xe3e5e8,footer:{text:'Nexium Store • Horário de Brasília'}}],components:disabled?[]:[row([{type:3,custom_id:`nexium:ticket-open:${panel.id}`,placeholder:'➡️ Clique aqui para ver as opções',min_values:1,max_values:1,options:ticketSubjects.map((subject,index)=>({...subject,emoji:icons[index]}))}])]};
}

export function ticketControls(id:string,closed=false){
 if(closed)return [row([button('📄 Transcript',`nexium:ticket-transcript:${id}`,2),button('⭐ Avaliar',`nexium:ticket-rate:${id}`,1),button('🗑️ Deletar',`nexium:ticket-delete:${id}`,4)])];
 return [row([{type:3,custom_id:`nexium:ticket-panels:${id}`,placeholder:'📋 Selecione um painel de opções',options:[{label:'Painel Staff',value:'staff',description:'Ferramentas exclusivas para a equipe',emoji:{id:'1555363276236529745',name:'55609admingreenCopia'}},{label:'Painel Membro',value:'member',description:'Opções disponíveis para você',emoji:{id:'1555363193621188718',name:'roles1'}}]}]),row([button('🕒 Notificar',`nexium:ticket-notify:${id}`),button('🎟️ Assumir Ticket',`nexium:ticket-claim:${id}`,2)]),row([button('🗑️ Deletar e Salvar',`nexium:ticket-save-delete:${id}`,4)])];
}
async function panelFor(db:SupabaseClient,input:any,id:string,message:string){
 if(!uuid(id))throw new BotError('INVALID_ID');
 const panel=checked(await db.from('discord_sales_panels').select('id,message_id').eq('id',id).eq('guild_id',input.guild_id).eq('channel_id',input.channel_id).eq('active',true).eq('panel_kind','tickets').maybeSingle());
 if(!panel||panel.message_id!==message)throw new BotError('PANEL_PRODUCT_MISMATCH');return panel;
}
const textField=(id:string,label:string,required=true,max=450)=>({type:18,label,component:{type:4,custom_id:id,style:id==='order'?1:2,required,...(required?{min_length:3}:{}),max_length:max}});
export function modalValues(input:any){const fields:Record<string,any>={};for(const item of input.data?.components||[]){for(const field of item.component?[item.component]:item.components||[]){if(typeof field.custom_id==='string')fields[field.custom_id]=field.value??field.values?.[0];}}return fields;}
export async function ticketModal(db:SupabaseClient,input:any,user:string){
 if(input.type!==3)return null;const [,original,id]=String(input.data?.custom_id||'').split(':');let action=original;
 if(original==='ticket-save-delete'){const actor=await actorFor(db,user);action=['admin','support'].includes(actor.role)?'ticket-close':'ticket-cancel';}
 if(original==='ticket-manage'){const selected=input.data.values?.[0];if(!['transfer','priority','add_member','remove_member','close','transcript'].includes(selected))throw new BotError('INVALID_TICKET_FORM');action=selected==='close'?'ticket-close':`ticket-${selected}`;}
 if(['ticket-transfer','ticket-priority','ticket-add_member','ticket-remove_member','ticket-rate'].includes(action)){
  if(!uuid(id))throw new BotError('INVALID_ID');const actor=await actorFor(db,user),view=await ticketRpc(db,user,input.guild_id,'view',id);if(view.discord.channel_id!==input.channel_id)throw new BotError('TICKET_NOT_FOUND');
  const rating=action==='ticket-rate';if(rating){if(view.ticket.user_id!==actor.id||!view.discord.closed_at)throw new BotError('RATING_NOT_ALLOWED');}else if(!['admin','support'].includes(actor.role)||(actor.role==='support'&&view.ticket.assigned_to!==actor.id))throw new BotError('CLAIM_REQUIRED');
  const component=rating?{type:3,custom_id:'stars',required:true,options:[1,2,3,4,5].map(n=>({label:`${n} estrela(s)`,value:String(n)}))}:action==='ticket-priority'?{type:3,custom_id:'priority',required:true,options:[{label:'Normal',value:'normal'},{label:'Alta',value:'high'},{label:'Urgente',value:'urgent'}]}:{type:5,custom_id:'target',required:true,min_values:1,max_values:1};
  return {type:9,data:{custom_id:`nexium:ticket-edit:${id}:${action.slice(7)}`,title:rating?'Avaliar atendimento':'Gerenciar atendimento',components:[{type:18,label:rating?'Sua avaliação':action==='ticket-priority'?'Prioridade':'Selecione o membro',component},...(rating?[textField('comment','Comentário (opcional)',false)]:[])]}};
 }
 // Ticket opening is processed after the deferred acknowledgment in route().
 if(action==='ticket-open')return null;
 if(action==='ticket-close'||action==='ticket-cancel'){
  if(!uuid(id))throw new BotError('INVALID_ID');const actor=await actorFor(db,user),view=await ticketRpc(db,user,input.guild_id,'view',id);
  if(view.discord.channel_id!==input.channel_id)throw new BotError('TICKET_NOT_FOUND');
  if(action==='ticket-close'&&(!['admin','support'].includes(actor.role)||(actor.role==='support'&&view.ticket.assigned_to!==actor.id)))throw new BotError('CLAIM_REQUIRED');
  if(action==='ticket-cancel'&&view.ticket.user_id!==actor.id)throw new BotError('FORBIDDEN');
  if(!['open','in_progress'].includes(view.ticket.status))throw new BotError('TICKET_ALREADY_CLOSED');
  return {type:9,data:{custom_id:`nexium:${action==='ticket-close'?'ticket-finish':'ticket-abort'}:${id}`,title:action==='ticket-close'?'Finalizar atendimento':'Cancelar meu atendimento',components:[textField('reason','Motivo da finalização'),...(action==='ticket-close'?[{type:18,label:'Resultado real do atendimento',component:{type:3,custom_id:'outcome',required:true,options:[{label:'Resolvido',value:'resolved'},{label:'Cancelado / não resolvido',value:'cancelled'},{label:'Ticket duplicado',value:'duplicate'}]}}]:[])]}};
 }
 return null;
}
export async function submitTicketModal(db:SupabaseClient,input:any,user:string){
 const [,action,id,subject,message]=String(input.data?.custom_id||'').split(':'),values=modalValues(input);
 if(action==='ticket-edit'){
  if(!uuid(id))throw new BotError('INVALID_ID');const view=await ticketRpc(db,user,input.guild_id,'view',id);if(view.discord.channel_id!==input.channel_id)throw new BotError('TICKET_NOT_FOUND');
  if(!['transfer','priority','add_member','remove_member','rate'].includes(subject))throw new BotError('INVALID_TICKET_FORM');
  if(subject==='priority'&&!['normal','high','urgent'].includes(values.priority))throw new BotError('INVALID_TICKET_FORM');
  if(subject==='rate'&&!['1','2','3','4','5'].includes(values.stars))throw new BotError('INVALID_TICKET_FORM');
  return actTicket(db,input,user,subject,{ticket:id,target:values.target,priority:values.priority,stars:Number(values.stars),comment:typeof values.comment==='string'?values.comment.slice(0,450):undefined});
 }
 if(typeof values.reason!=='string'||values.reason.trim().length<3||values.reason.length>450)throw new BotError('INVALID_TICKET_FORM');
 if(action==='ticket-new'){
  await panelFor(db,input,id,message);const sector=ticketSubjects.find(s=>s.value===subject);if(!sector)throw new BotError('INVALID_TICKET_FORM');
  const order=typeof values.order==='string'?values.order.trim():'';if(order&&!uuid(order))throw new BotError('INVALID_ID');
  return openTicket(db,input,user,`${sector.label}: ${values.reason.trim()}`,order||undefined);
 }
 if(action!=='ticket-finish'&&action!=='ticket-abort')throw new BotError('UNSUPPORTED_ACTION');
 if(!uuid(id))throw new BotError('INVALID_ID');const view=await ticketRpc(db,user,input.guild_id,'view',id);if(view.discord.channel_id!==input.channel_id)throw new BotError('TICKET_NOT_FOUND');
 if(action==='ticket-finish'&&!['resolved','cancelled','duplicate'].includes(values.outcome))throw new BotError('INVALID_TICKET_FORM');
 return actTicket(db,input,user,action==='ticket-finish'?'close':'cancel',{ticket:id,reason:values.reason.trim(),outcome:values.outcome});
}
