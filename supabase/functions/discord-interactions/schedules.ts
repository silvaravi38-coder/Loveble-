import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord,actorFor,uuid,audit} from './api.ts';
import {privateMessage} from './security.ts';
export function scheduledDate(value:string,now=Date.now()){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new BotError('SCHEDULE_DATE_REQUIRED');const date=Date.parse(value);if(!Number.isFinite(date)||date<now+60000||date>now+31536000000)throw new BotError('SCHEDULE_DATE_REQUIRED');return new Date(date).toISOString();}
export async function manageSchedules(db:SupabaseClient,input:any,user:string,sub:string,o:any){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(sub==='mensagens'){const rows=checked(await db.from('discord_scheduled_messages').select('id,channel_id,scheduled_at,status').eq('guild_id',input.guild_id).order('created_at',{ascending:false}).limit(20)) as any[];return privateMessage(rows.map(r=>`${r.id} — ${r.status} — ${r.scheduled_at} — <#${r.channel_id}>`).join('\n')||'Nenhuma mensagem programada.');}
 if(sub==='cancelar-mensagem'){if(!uuid(o.mensagem))throw new BotError('INVALID_ID');const row=checked(await db.from('discord_scheduled_messages').update({status:'cancelled',finished_at:new Date().toISOString()}).eq('id',o.mensagem).eq('guild_id',input.guild_id).eq('status','queued').select('id').maybeSingle());if(!row)throw new BotError('SCHEDULE_NOT_QUEUED');await audit(db,input.guild_id,actor.id,'scheduled_message_cancelled',row.id);return privateMessage('Mensagem programada cancelada antes do envio.');}
 const date=scheduledDate(o.quando),channelId=o.canal||input.channel_id;const channel=await discord(`/channels/${channelId}`);if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 const row=checked(await db.from('discord_scheduled_messages').insert({guild_id:input.guild_id,channel_id:channelId,content:String(o.texto).slice(0,1800),scheduled_at:date,requested_by:actor.id}).select('id').single());
 await audit(db,input.guild_id,actor.id,'scheduled_message_created',row.id,{channel_id:channelId,scheduled_at:date});return privateMessage(`Mensagem agendada: ${row.id}\n${date} em <#${channelId}>. O worker consulta a fila a cada minuto; menções ficam desativadas.`);
}
