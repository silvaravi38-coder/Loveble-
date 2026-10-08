import {createPrivateTicketThread,threadMemberAccess,isTicketChannel} from './ticket-channel.ts';
import {recoverOwnerTickets} from './ticket-recovery.ts';
import {deleteClosedTicketChannel} from './ticket-lifecycle.ts';
import {ticketCard,refreshTicketCard} from './ticket-card.ts';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord,audit,actorFor,uuid,snowflake,safeText,row,button} from './api.ts';
import {ticketAi} from './ai.ts';
import {privateMessage} from './security.ts';
export async function ticketId(db:SupabaseClient,guild:string,channel:string,value?:string) {
 if(value){if(!uuid(value))throw new BotError('INVALID_ID');return value;}
 const t=checked(await db.from('discord_tickets').select('ticket_id').eq('guild_id',guild).eq('channel_id',channel).maybeSingle());
 if(!t)throw new BotError('TICKET_ID_REQUIRED');return t.ticket_id as string;
}
export async function ticketRpc(db:SupabaseClient,user:string,guild:string,action:string,id:string|null,data:unknown={}) {
 const result=await db.rpc('discord_ticket_action',{p_discord_user_id:user,p_guild_id:guild,p_action:action,p_ticket_id:id,p_data:data});
 if(result.error){const code=String(result.error.message);throw new BotError(['LINK_REQUIRED','ORDER_NOT_OWNED','FORBIDDEN','ALREADY_ASSIGNED','CLAIM_REQUIRED','STAFF_NOT_AUTHORIZED','TICKET_NOT_FOUND','RATING_NOT_ALLOWED','TOO_MANY_OPEN_TICKETS','CLOSE_REASON_REQUIRED'].find(c=>code.includes(c))||'TICKET_ACTION_FAILED');}return result.data;
}
export async function openTicket(db:SupabaseClient,input:any,user:string,reason:string,order?:string) {
 if(order&&!uuid(order))throw new BotError('INVALID_ID');
 const actor=await actorFor(db,user);
 await recoverOwnerTickets(db,user,actor.id,input.guild_id);
 const created=await ticketRpc(db,user,input.guild_id,'open',null,{reason:reason.trim(),order_id:order||null,interaction_id:input.id});
 if(created.reused)return {...privateMessage(created.channel_id?`🎫 Você já tem um atendimento para este assunto: <#${created.channel_id}>`:'🎫 Este atendimento já foi solicitado. Aguarde ou peça à equipe para revisar a abertura.'),components:created.channel_id?[row([{type:2,style:5,label:'Ir para meu ticket',url:`https://discord.com/channels/${input.guild_id}/${created.channel_id}`}])]:[]};
 checked(await db.from('support_messages').insert({ticket_id:created.ticket_id,sender_id:actor.id,sender_role:actor.role,sender_name:actor.full_name,message:reason}));
 let createdChannel:string|undefined;
 try{
 const config=checked(await db.from('discord_bot_settings').select('role_support_id').eq('guild_id',input.guild_id).maybeSingle());
 const panels=checked(await db.from('discord_sales_panels').select('channel_id').eq('guild_id',input.guild_id).eq('active',true).eq('panel_kind','tickets').eq('sync_status','synced').order('created_at',{ascending:false}).limit(25)) as any[];
 const parentId=panels.find(p=>p.channel_id===input.channel_id)?.channel_id||panels[0]?.channel_id;
 if(!parentId)throw new BotError('TICKET_PANEL_REQUIRED');
 const parent=await discord(`/channels/${parentId}`);if(parent.guild_id!==input.guild_id||parent.type!==0)throw new BotError('INVALID_TICKET_PARENT');
  const channel=await createPrivateTicketThread(parent,input.guild_id,created.ticket_id,reason,input.member.user);
  createdChannel=channel.id;
  checked(await db.from('discord_tickets').update({channel_id:channel.id,channel_state:'uncertain'}).eq('ticket_id',created.ticket_id));
  await threadMemberAccess(channel,user);
  const team=checked(await db.from('profiles').select('id').in('role',['admin','support']).limit(50)) as any[];
  const links=team.length?checked(await db.from('discord_account_links').select('discord_user_id').in('profile_id',team.map(p=>p.id))):[];
  for(const member of links){if(member.discord_user_id===user)continue;try{await discord(`/guilds/${input.guild_id}/members/${member.discord_user_id}`);await threadMemberAccess(channel,member.discord_user_id);}catch(error){if(!(error instanceof BotError)||error.code!=='DISCORD_RESOURCE_NOT_FOUND')throw error;}}
  checked(await db.from('discord_tickets').update({channel_state:'ready'}).eq('ticket_id',created.ticket_id));
  const ticket=checked(await db.from('support_tickets').select('*').eq('id',created.ticket_id).single());
  const payload=ticketCard(created.ticket_id,{...ticket,subject:reason},input.member.user,null,config?.role_support_id);
  const welcome=await discord(`/channels/${channel.id}/messages`,'POST',{...payload,content:`<@${user}>${config?.role_support_id?` • <@&${config.role_support_id}>`:''}`,allowed_mentions:{parse:[],users:[user],roles:config?.role_support_id?[config.role_support_id]:[]}});
  checked(await db.from('discord_tickets').update({card_message_id:welcome.id}).eq('ticket_id',created.ticket_id));
  return {...privateMessage(`🎫 Ticket aberto: <#${channel.id}>\nEntre no canal para conversar com a equipe.`),components:[row([{type:2,style:5,label:'Ir para meu ticket',url:`https://discord.com/channels/${input.guild_id}/${channel.id}`}])]};
 }catch(error){await db.from('discord_tickets').update({...(createdChannel?{channel_id:createdChannel}:{}),channel_state:createdChannel||error instanceof BotError&&error.code==='MUTATION_UNCERTAIN'?'uncertain':'failed'}).eq('ticket_id',created.ticket_id);throw error;}
}
export async function captureTranscript(db:SupabaseClient,id:string,channelId:string,actorId:string) {
 const messages:any[]=[];let before:string|undefined;let complete=false;
 for(let page=0;page<10;page++){
  const batch=await discord(`/channels/${channelId}/messages?limit=100${before?`&before=${before}`:''}`) as any[];
  messages.push(...batch.map(m=>({id:m.id,author_id:m.author?.id,author_name:m.author?.username,content:m.content,timestamp:m.timestamp,attachments:(m.attachments||[]).map((a:any)=>({id:a.id,name:a.filename,url:a.url})),embeds:m.embeds||[]})));
  if(batch.length<100){complete=true;break;}before=batch[batch.length-1].id;
 }
 checked(await db.from('discord_ticket_transcripts').upsert({ticket_id:id,messages:messages.reverse(),complete,created_by:actorId,created_at:new Date().toISOString()}));
 return {complete,count:messages.length};
}
export async function listTickets(db:SupabaseClient,userId:string,guild:string) {
 const actor=await actorFor(db,userId);let query=db.from('support_tickets').select('id,subject,status,assigned_to,priority').order('created_at',{ascending:false}).limit(15);
 if(!['admin','support'].includes(actor.role))query=query.eq('user_id',actor.id);
 const rows=checked(await query) as any[];const ids=rows.map(t=>t.id);
 const maps=ids.length?checked(await db.from('discord_tickets').select('ticket_id,channel_id').eq('guild_id',guild).in('ticket_id',ids)):[];
 return privateMessage(rows.filter(t=>maps.some((m:any)=>m.ticket_id===t.id)).map(t=>`${t.id} — ${safeText(t.subject,80)} — ${t.status}`).join('\n')||'Nenhum ticket Discord encontrado.');
}
export async function actTicket(db:SupabaseClient,input:any,userId:string,action:string,options:Record<string,any>) {
 const id=await ticketId(db,input.guild_id,input.channel_id,options.ticket);
 const actor=await actorFor(db,userId);
 const view=await ticketRpc(db,userId,input.guild_id,'view',id);
 const channelId=view.discord.channel_id;
 if(action==='close'||action==='cancel') {
  if(action==='cancel'&&view.ticket.user_id!==actor.id)throw new BotError('FORBIDDEN');
  if(action==='close'&&(!['admin','support'].includes(actor.role)||(actor.role==='support'&&view.ticket.assigned_to!==actor.id)))throw new BotError('CLAIM_REQUIRED');
  if(!options.reason||options.reason.trim().length<3)throw new BotError('CLOSE_REASON_REQUIRED');
  if(channelId&&!view.discord.deleted_at){const transcript=await captureTranscript(db,id,channelId,actor.id);if(!transcript.complete)throw new BotError('TRANSCRIPT_PARTIAL_DELETE_BLOCKED');}
 }
 if(['add_member','remove_member','transfer'].includes(action)) {
  const memberId=options.target;if(!snowflake(memberId))throw new BotError('INVALID_ID');
  await discord(`/guilds/${input.guild_id}/members/${memberId}`);
  if(['add_member','remove_member'].includes(action)){
    if(!channelId)throw new BotError('TICKET_CHANNEL_UNAVAILABLE');
    const owner=checked(await db.from('discord_account_links').select('discord_user_id').eq('profile_id',view.ticket.user_id).single());
    if(action==='remove_member'&&[owner.discord_user_id,'1557132199227031552'].includes(memberId))throw new BotError('PROTECTED_TICKET_MEMBER');
  }
 }
 const result=await ticketRpc(db,userId,input.guild_id,action,id,{...options,message:options.text,reason:options.reason,outcome:options.outcome,stars:options.stars,comment:options.comment,priority:options.priority,target:options.target});
 if(['claim','transfer','add_member','remove_member'].includes(action)&&channelId){
  const channel=await discord(`/channels/${channelId}`);if(!isTicketChannel(channel,input.guild_id,id,channelId))throw new BotError('PROTECTED_TICKET_CHANNEL');
  const member=action==='claim'?userId:options.target;
  if(channel.type===12)await threadMemberAccess(channel,member,action==='remove_member');
  else await discord(`/channels/${channelId}/permissions/${member}`,action==='remove_member'?'DELETE':'PUT',action==='remove_member'?undefined:{type:1,allow:'117760',deny:'0'});
 }
 if(action==='message'&&channelId)await discord(`/channels/${channelId}/messages`,'POST',{content:`${safeText(actor.full_name,100)}: ${safeText(options.text,1800)}`,allowed_mentions:{parse:[]}});
 if(action==='message'&&actor.role!=='admin'&&actor.role!=='support'){try{await ticketAi(db,userId,input.guild_id,id,'reply');}catch{ /* Disabled, paused or provider failure never prevents staff support. */ }}
 if(['claim','transfer','priority'].includes(action)){try{await refreshTicketCard(db,result);}catch{/* Ticket state remains authoritative; do not repeat a completed action for a card failure. */}}
 if(action==='claim')return privateMessage(`Ticket assumido por **${safeText(input.member?.nick||input.member?.user?.global_name||input.member?.user?.username||actor.full_name||'Atendente',100)}**.`);
 const afterDelivery=(action==='close'||action==='cancel')&&channelId?async()=>{
  await deleteClosedTicketChannel(result,input.guild_id);
  checked(await db.from('discord_tickets').update({deleted_at:new Date().toISOString()}).eq('ticket_id',id));
  await audit(db,input.guild_id,actor.id,'ticket_channel_deleted',id,{channel_id:channelId,automatic:true});
 }:undefined;
 if(action==='transcript'){
  if(channelId&&!view.discord.deleted_at)await captureTranscript(db,id,channelId,actor.id);
  const transcript=checked(await db.from('discord_ticket_transcripts').select('messages,complete').eq('ticket_id',id).maybeSingle());
  const siteMessages=checked(await db.from('support_messages').select('sender_name,message,created_at').eq('ticket_id',id).order('created_at').limit(20)) as any[];
  const latest=transcript?.messages?.slice(-10)||siteMessages;
  return {...privateMessage(`Histórico #${id.slice(0,8)}${transcript&&!transcript.complete?' (captura parcial)':''}\n`+latest.map((m:any)=>`${safeText(m.author_name||m.sender_name,60)}: ${safeText(m.content||m.message,130)}`).join('\n')+'\nHistórico permanente guardado no backend; anexos são referências, não cópias dos arquivos.'),files:[{name:`ticket-${id}.json`,type:'application/json',content:JSON.stringify({ticket_id:id,ticket:view.ticket,closure:view.discord,complete:transcript?.complete??false,messages:transcript?.messages||siteMessages},null,2)}]};
 }
 const minutes=Math.max(0,Math.round(((result.discord.closed_at?Date.parse(result.discord.closed_at):Date.now())-Date.parse(result.ticket.created_at))/60000));
 const priority:Record<string,string>={low:'Baixa',normal:'Normal',high:'Alta',urgent:'Urgente'};
 if(action==='close')return {...privateMessage(`✅ **Atendimento finalizado!**\n\nSeu ticket foi encerrado com sucesso.\n📌 **Status:** ${options.outcome==='resolved'?'Resolvido':'Encerrado'}\n⏱️ **Duração:** ${minutes} min\n🗑️ O histórico ficou salvo na Nexium. O canal será apagado após esta confirmação.`),afterDelivery};
 if(action==='cancel')return {...privateMessage('🚪 **Ticket encerrado.**\n\nO atendimento foi cancelado e o histórico foi salvo. O canal será apagado após esta confirmação.'),afterDelivery};
 if(action==='priority')return privateMessage(`⚡ **Prioridade atualizada:** ${priority[result.ticket.priority]||'Normal'}.`);
 if(action==='transfer')return privateMessage('🔄 **Atendimento transferido com sucesso.**');
 if(action==='add_member')return privateMessage('➕ **Membro adicionado ao atendimento.**');
 if(action==='remove_member')return privateMessage('➖ **Membro removido do atendimento.**');
 if(action==='rate')return privateMessage('⭐ **Avaliação enviada. Obrigado pelo feedback!**');
 return privateMessage('✅ **Ação concluída com sucesso.**');
}
