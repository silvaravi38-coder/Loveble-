import {isTicketChannel} from './ticket-channel.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,checked,BotError,discord,row,button,uuid,audit} from './api.ts';
import {privateMessage} from './security.ts';
import {ticketRpc,captureTranscript,actTicket} from './tickets.ts';
import {catalogue} from './catalog.ts';
import {paymentStatus} from './payments.ts';
export function channelFingerprint(channel:any){return JSON.stringify({id:channel.id,guild:channel.guild_id,type:channel.type,name:channel.name,topic:channel.topic,parent:channel.parent_id,permissions:[...(channel.permission_overwrites||[])].sort((a,b)=>a.id.localeCompare(b.id))});}
export function requireDeletableTicket(view:any,channel:any,guild:string){if(!view.discord.closed_at||!['resolved','closed'].includes(view.ticket.status))throw new BotError('TICKET_CLOSE_BEFORE_DELETE');if(view.discord.deleted_at||view.discord.channel_state!=='ready'||!isTicketChannel(channel,guild,view.ticket.id,view.discord.channel_id))throw new BotError('PROTECTED_TICKET_CHANNEL');}
export async function ticketActionButton(db:SupabaseClient,input:any,user:string,action:string,id:string){
 if(action==='ticket-delete-confirm')return confirmDelete(db,input,user,id);
 if(!uuid(id))throw new BotError('INVALID_ID');const actor=await actorFor(db,user),view=await ticketRpc(db,user,input.guild_id,'view',id);
 if(view.discord.channel_id!==input.channel_id)throw new BotError('TICKET_NOT_FOUND');
 if(action==='ticket-panels'){
  const selected=input.data.values?.[0];if(!['staff','member'].includes(selected))throw new BotError('INVALID_TICKET_FORM');action=selected==='staff'?'ticket-staff':'ticket-member';
 }
 if(action==='ticket-member'){
  if(view.ticket.user_id!==actor.id)throw new BotError('FORBIDDEN');
  return {...privateMessage('👤 **Painel Membro • Nexium Store**\nConsulte seu histórico, acompanhe pagamentos ou encerre seu atendimento.'),components:[row([button('📄 Meu histórico',`nexium:ticket-transcript:${id}`,2),button('💰 Pagamento',`nexium:ticket-payment:${id}`,3)]),row([button('🚪 Encerrar meu ticket',`nexium:ticket-cancel:${id}`,4)])]};
 }
 if(action==='ticket-notify'){
  if(view.discord.closed_at)throw new BotError('TICKET_ALREADY_CLOSED');
  const prior=checked(await db.from('discord_audit_events').select('id').eq('guild_id',input.guild_id).eq('actor_id',actor.id).eq('action','ticket_notify').eq('entity_id',id).gt('created_at',new Date(Date.now()-180000).toISOString()).limit(1)) as any[];
  if(prior.length)throw new BotError('REQUEST_COOLDOWN');
  const isStaff=['admin','support'].includes(actor.role);
  const owner=checked(await db.from('discord_account_links').select('discord_user_id').eq('profile_id',view.ticket.user_id).single());
  const config=checked(await db.from('discord_bot_settings').select('role_support_id').eq('guild_id',input.guild_id).single());
  const target=isStaff?owner.discord_user_id:config.role_support_id;
  if(!target)throw new BotError('STAFF_NOT_AUTHORIZED');
  await audit(db,input.guild_id,actor.id,'ticket_notify',id,{target});
  await discord(`/channels/${input.channel_id}/messages`,'POST',{content:isStaff?`<@${target}> A equipe aguarda sua resposta neste atendimento.`:`<@&${target}> O cliente está aguardando atendimento neste ticket.`,allowed_mentions:{parse:[],users:isStaff?[target]:[],roles:isStaff?[]:[target]}});
  return privateMessage('🔔 Notificação enviada. Aguarde 3 minutos antes de notificar novamente.');
 }
 if(action==='ticket-staff'){
  if(!['admin','support'].includes(actor.role))throw new BotError('FORBIDDEN');
  return {...privateMessage('🔧 **Painel Staff • Nexium Store**\n\nGerencie este atendimento por aqui. Para transferir, alterar prioridade, adicionar/remover membros ou finalizar, o ticket deve estar sob responsabilidade da equipe. Todas as ações ficam registradas no histórico.'),components:[row([{type:3,custom_id:`nexium:ticket-manage:${id}`,placeholder:'🔧 Selecione uma ação da equipe',options:[{label:'Transferir atendimento',value:'transfer',emoji:{name:'🔄'},description:'Passe o ticket para outro atendente'},{label:'Alterar prioridade',value:'priority',emoji:{name:'⚡'},description:'Defina a urgência deste atendimento'},{label:'Adicionar membro',value:'add_member',emoji:{name:'➕'},description:'Libere acesso ao canal para um membro'},{label:'Remover membro',value:'remove_member',emoji:{name:'➖'},description:'Remova o acesso de um membro'},{label:'Finalizar atendimento',value:'close',emoji:{name:'✅'},description:'Encerre registrando motivo e resultado'},{label:'Consultar transcript',value:'transcript',emoji:{name:'📄'},description:'Consulte o histórico do atendimento'}]}])]};
 }
 if(action==='ticket-payment'){
  if(view.ticket.user_id!==actor.id)throw new BotError('TICKET_PAYMENT_OWNER_REQUIRED');
  if(view.ticket.order_id)return paymentStatus(db,user,view.ticket.order_id);
  return catalogue(db);
 }
 if(action==='ticket-manage'&&input.data.values?.[0]==='transcript'){if(!['admin','support'].includes(actor.role))throw new BotError('FORBIDDEN');return actTicket(db,input,user,'transcript',{ticket:id});}
 if(action!=='ticket-delete')throw new BotError('UNSUPPORTED_ACTION');
 if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const channel=await discord(`/channels/${view.discord.channel_id}`);requireDeletableTicket(view,channel,input.guild_id);
 const transcript=await captureTranscript(db,id,channel.id,actor.id);if(!transcript.complete)throw new BotError('TRANSCRIPT_PARTIAL_DELETE_BLOCKED');
 const preview=checked(await db.from('discord_ticket_delete_previews').insert({ticket_id:id,guild_id:input.guild_id,channel_id:channel.id,requested_by:actor.id,channel_backup:channel}).select('id').single());
 await audit(db,input.guild_id,actor.id,'ticket_delete_preview',id,{preview_id:preview.id,message_count:transcript.count});
 return {...privateMessage(`Preview: excluir somente o canal <#${channel.id}> do ticket ${id}.\nO atendimento já está encerrado. Transcript com ${transcript.count} mensagens e backup da configuração foram salvos.\nO histórico da loja será preservado; arquivos anexados têm referências, não cópias. Excluir o canal não permite recuperar o mesmo ID nem as mensagens no Discord.\nConfirmação válida por 5 minutos, exclusiva do administrador que a solicitou.`),components:[row([button('🗑️ Confirmar exclusão',`nexium:ticket-delete-confirm:${preview.id}`,4)])]};
}
async function confirmDelete(db:SupabaseClient,input:any,user:string,id:string){
 if(!uuid(id))throw new BotError('INVALID_ID');const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const preview=checked(await db.from('discord_ticket_delete_previews').select('*').eq('id',id).eq('guild_id',input.guild_id).eq('channel_id',input.channel_id).eq('requested_by',actor.id).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle());if(!preview)throw new BotError('CONTROL_PREVIEW_EXPIRED');
 const view=await ticketRpc(db,user,input.guild_id,'view',preview.ticket_id),channel=await discord(`/channels/${preview.channel_id}`);requireDeletableTicket(view,channel,input.guild_id);
 if(channelFingerprint(channel)!==channelFingerprint(preview.channel_backup))throw new BotError('CHANNEL_CHANGED_REVIEW_REQUIRED');
 return {...privateMessage('Exclusão confirmada. O canal será apagado após esta resposta. Histórico, avaliação e transcript permanecem salvos na Nexium.'),afterDelivery:async()=>{
 const claim=checked(await db.from('discord_ticket_delete_previews').update({status:'running'}).eq('id',id).eq('status','pending').gt('expires_at',new Date().toISOString()).select('id').maybeSingle());if(!claim)throw new BotError('CONTROL_PREVIEW_EXPIRED');
 let jobId:string|undefined,accepted=false;
 try{
  const config=checked(await db.from('discord_builder_configs').select('id').eq('guild_id',input.guild_id).order('updated_at',{ascending:false}).limit(1).single());
  const job=checked(await db.from('discord_jobs').insert({config_id:config.id,guild_id:input.guild_id,action:'apply',requested_by:actor.id,idempotency_key:id,status:'running',attempts:1,started_at:new Date().toISOString(),input:{target:'ticket_delete',ticket_id:preview.ticket_id,preview_id:id}}).select('id').single());jobId=job.id;
  checked(await db.from('discord_job_logs').insert({job_id:jobId,level:'info',code:'TICKET_DELETE_CONFIRMED',details:{preview_id:id}}));
  const transcript=await captureTranscript(db,preview.ticket_id,channel.id,actor.id);if(!transcript.complete)throw new BotError('TRANSCRIPT_PARTIAL_DELETE_BLOCKED');
  await discord(`/channels/${channel.id}`,'DELETE');accepted=true;
  checked(await db.from('discord_tickets').update({deleted_at:new Date().toISOString()}).eq('ticket_id',preview.ticket_id));
  checked(await db.from('discord_ticket_delete_previews').update({status:'completed',finished_at:new Date().toISOString()}).eq('id',id));
  await audit(db,input.guild_id,actor.id,'ticket_channel_deleted',preview.ticket_id,{preview_id:id,channel_id:channel.id});
  checked(await db.from('discord_jobs').update({status:'succeeded',finished_at:new Date().toISOString(),result:{ticket_id:preview.ticket_id,channel_id:channel.id,preview_id:id}}).eq('id',jobId));
  checked(await db.from('discord_job_logs').insert({job_id:jobId,level:'info',code:'TICKET_CHANNEL_DELETED'}));

 }catch(error){const code=error instanceof BotError?error.code:'DATABASE_ERROR';await db.from('discord_ticket_delete_previews').update({status:accepted||code==='MUTATION_UNCERTAIN'?'uncertain':'failed',finished_at:new Date().toISOString()}).eq('id',id);if(jobId){await db.from('discord_jobs').update({status:'failed',error_code:code,error_message:code,finished_at:new Date().toISOString()}).eq('id',jobId);await db.from('discord_job_logs').insert({job_id:jobId,level:'error',code});}throw error;}
 }};
}
