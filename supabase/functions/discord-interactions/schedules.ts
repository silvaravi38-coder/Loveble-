import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord,actorFor,uuid,audit,safeText} from './api.ts';
import {privateEmbed} from './security.ts';
const scheduledStatus:Record<string,{label:string;icon:string}>={queued:{label:'Na fila',icon:'🕒'},running:{label:'Enviando',icon:'⚙️'},sent:{label:'Enviada',icon:'✅'},failed:{label:'Falhou',icon:'❌'},uncertain:{label:'Precisa de revisão',icon:'⚠️'},cancelled:{label:'Cancelada',icon:'⛔'}};
function localScheduleTime(value:string){return new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Fortaleza'}).format(new Date(value));}
function discordScheduleTime(value:string){const seconds=Math.floor(Date.parse(value)/1000);return `<t:${seconds}:F>\n<t:${seconds}:R>`;}
export function scheduledDate(value:string,now=Date.now()){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new BotError('SCHEDULE_DATE_REQUIRED');const date=Date.parse(value);if(!Number.isFinite(date)||date<now+60000||date>now+31536000000)throw new BotError('SCHEDULE_DATE_REQUIRED');return new Date(date).toISOString();}
export async function manageSchedules(db:SupabaseClient,input:any,user:string,sub:string,o:any){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(sub==='mensagens'){
  const rows=checked(await db.from('discord_scheduled_messages').select('id,channel_id,content,scheduled_at,status').eq('guild_id',input.guild_id).order('created_at',{ascending:false}).limit(20)) as any[];
  if(!rows.length)return privateEmbed('⏰ Mensagens programadas','A fila está vazia.\n\nPara criar uma, use `/nexium-admin agendar` e informe o texto, a data/hora com fuso e, se quiser, o canal.');
  const fields=rows.map(r=>{const status=scheduledStatus[r.status]||{label:safeText(r.status,30)||'Status desconhecido',icon:'🔎'};return {name:`${status.icon} ${localScheduleTime(r.scheduled_at)} • ${status.label}`,value:`**Horário:** ${discordScheduleTime(r.scheduled_at)}\n**Canal:** <#${r.channel_id}>\n**Mensagem:** ${safeText(r.content,180)||'—'}\n**ID:** \`${r.id}\``,inline:false};});
  return privateEmbed(`⏰ Mensagens programadas • ${rows.length}`,`Agendamentos recentes. Os horários fixos estão no fuso de Fortaleza (UTC−03:00); a prévia do Discord acompanha o fuso de quem está visualizando.`,fields);
 }
 if(sub==='cancelar-mensagem'){
  if(!uuid(o.mensagem))throw new BotError('INVALID_ID');
  const row=checked(await db.from('discord_scheduled_messages').update({status:'cancelled',finished_at:new Date().toISOString()}).eq('id',o.mensagem).eq('guild_id',input.guild_id).eq('status','queued').select('id').maybeSingle());
  if(!row)throw new BotError('SCHEDULE_NOT_QUEUED');
  await audit(db,input.guild_id,actor.id,'scheduled_message_cancelled',row.id);
  return privateEmbed('✅ Agendamento cancelado',`A mensagem foi retirada da fila e não será enviada.\n\n**🆔 Identificador:** \`${row.id}\``);
 }
 if(typeof o.texto!=='string'||!o.texto.trim()||o.texto.length>1800)throw new BotError('INVALID_SCHEDULE_MESSAGE');
 const date=scheduledDate(o.quando),channelId=o.canal||input.channel_id;const channel=await discord(`/channels/${channelId}`);if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 const row=checked(await db.from('discord_scheduled_messages').insert({guild_id:input.guild_id,channel_id:channelId,content:String(o.texto).slice(0,1800),scheduled_at:date,requested_by:actor.id}).select('id').single());
 await audit(db,input.guild_id,actor.id,'scheduled_message_created',row.id,{channel_id:channelId,scheduled_at:date});
 return privateEmbed('✅ Mensagem agendada',`**💬 Texto**\n${safeText(o.texto,1800)}`,[
  {name:'🕒 Quando',value:`${localScheduleTime(date)} • Fortaleza (UTC−03:00)\n${discordScheduleTime(date)}`,inline:false},
  {name:'📍 Canal de envio',value:`<#${channelId}>`,inline:true},
  {name:'🆔 Identificador',value:`\`${row.id}\``,inline:true},
  {name:'🔔 Notificações',value:'Menções automáticas desativadas. O envio é processado pelo bot no horário escolhido.',inline:false},
 ]);
}
