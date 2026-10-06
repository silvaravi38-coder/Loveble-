import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,discord,audit,uuid,row,button} from './api.ts';
import {privateMessage,applicationId} from './security.ts';
const sendBits=2048n|274877906944n|34359738368n|68719476736n;
export function canonicalOverwrites(overwrites:any[]){return JSON.stringify(overwrites.map(o=>({id:o.id,type:o.type,allow:BigInt(o.allow||0).toString(),deny:BigInt(o.deny||0).toString()})).sort((a,b)=>a.id.localeCompare(b.id)));}
export function lockOverwrites(overwrites:any[],guild:string,staffRoles:string[]){
 const rows=overwrites.map(o=>({...o}));for(const id of [...staffRoles,applicationId])if(!rows.some(o=>o.id===id))rows.push({id,type:id===applicationId?1:0,allow:sendBits.toString(),deny:'0'});if(!rows.some(o=>o.id===guild))rows.push({id:guild,type:0,allow:'0',deny:'0'});
 return rows.map(o=>staffRoles.includes(o.id)||o.id===applicationId?o:{...o,allow:(BigInt(o.allow||0)&~sendBits).toString(),deny:(BigInt(o.deny||0)|sendBits).toString()});
}
export async function previewChannelControl(db:SupabaseClient,input:any,user:string,action:'lock'|'unlock'){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const channel=await discord(`/channels/${input.channel_id}`);if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 const settings=checked(await db.from('discord_bot_settings').select('role_support_id,role_manager_id').eq('guild_id',input.guild_id).maybeSingle());
 let plan:any[];
 if(action==='lock'){
  const prior=checked(await db.from('discord_channel_controls').select('id').eq('guild_id',input.guild_id).eq('channel_id',channel.id).eq('action','lock').eq('status','applied').order('created_at',{ascending:false}).limit(1).maybeSingle());
  if(prior){const unlock=checked(await db.from('discord_channel_controls').select('created_at').eq('guild_id',input.guild_id).eq('channel_id',channel.id).eq('action','unlock').eq('status','applied').order('created_at',{ascending:false}).limit(1).maybeSingle());const locked=checked(await db.from('discord_channel_controls').select('created_at').eq('id',prior.id).single());if(!unlock||unlock.created_at<locked.created_at)throw new BotError('CHANNEL_ALREADY_LOCKED');}
  plan=lockOverwrites(channel.permission_overwrites||[],input.guild_id,[settings?.role_support_id,settings?.role_manager_id].filter(Boolean));
 }else{
  const previous=checked(await db.from('discord_channel_controls').select('backup,planned_overwrites').eq('guild_id',input.guild_id).eq('channel_id',channel.id).eq('action','lock').eq('status','applied').order('created_at',{ascending:false}).limit(1).maybeSingle());
  if(!previous)throw new BotError('CHANNEL_LOCK_BACKUP_REQUIRED');if(canonicalOverwrites(channel.permission_overwrites||[])!==canonicalOverwrites(previous.planned_overwrites))throw new BotError('CHANNEL_CHANGED_REVIEW_REQUIRED');plan=previous.backup.permission_overwrites||[];
 }
 const preview=checked(await db.from('discord_channel_controls').insert({guild_id:input.guild_id,channel_id:channel.id,requested_by:actor.id,action,backup:channel,planned_overwrites:plan}).select('id').single());
 return {...privateMessage(`${action==='lock'?'Bloquear envio de mensagens e criação de threads':'Restaurar permissões anteriores'} neste canal: <#${channel.id}>.\nBackup de permissões salvo: ${preview.id}.\nOs canais, cargos e mensagens serão preservados. Confirmação válida por cinco minutos.`),components:[row([button('Confirmar alteração',`nexium:control-confirm:${preview.id}`,4)])]};
}
export async function applyChannelControl(db:SupabaseClient,input:any,user:string,id:string){
 if(!uuid(id))throw new BotError('INVALID_ID');const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const preview=checked(await db.from('discord_channel_controls').select('*').eq('id',id).eq('guild_id',input.guild_id).eq('requested_by',actor.id).eq('status','preview').maybeSingle());
 if(!preview||Date.parse(preview.expires_at)<Date.now())throw new BotError('CONTROL_PREVIEW_EXPIRED');
 const channel=await discord(`/channels/${preview.channel_id}`);if(channel.guild_id!==preview.guild_id||canonicalOverwrites(channel.permission_overwrites||[])!==canonicalOverwrites(preview.backup.permission_overwrites||[]))throw new BotError('CHANNEL_CHANGED_REVIEW_REQUIRED');
 const config=checked(await db.from('discord_builder_configs').select('id').eq('guild_id',input.guild_id).limit(1).single());
 const job=checked(await db.from('discord_jobs').insert({config_id:config.id,guild_id:input.guild_id,action:'apply',requested_by:actor.id,idempotency_key:crypto.randomUUID(),status:'running',attempts:1,started_at:new Date().toISOString(),input:{target:'channel_permissions',preview_id:id}}).select('id').single());
 let accepted=false;
 try{
  const claim=checked(await db.from('discord_channel_controls').update({status:'applying',job_id:job.id}).eq('id',id).eq('status','preview').select('id').maybeSingle());if(!claim)throw new BotError('CONTROL_PREVIEW_EXPIRED');
  await discord(`/channels/${channel.id}`,'PATCH',{permission_overwrites:preview.planned_overwrites});accepted=true;
  const verify=await discord(`/channels/${channel.id}`);if(canonicalOverwrites(verify.permission_overwrites||[])!==canonicalOverwrites(preview.planned_overwrites))throw new BotError('CONTROL_VERIFICATION_FAILED');
  await audit(db,input.guild_id,actor.id,`channel_${preview.action}`,channel.id,{preview_id:id,job_id:job.id});
  checked(await db.from('discord_channel_controls').update({status:'applied',finished_at:new Date().toISOString()}).eq('id',id));checked(await db.from('discord_jobs').update({status:'succeeded',result:{channel_id:channel.id,backup_id:id},finished_at:new Date().toISOString()}).eq('id',job.id));
  return privateMessage(`Canal ${preview.action==='lock'?'bloqueado':'restaurado'} e permissões verificadas. Backup: ${id}.`);
 }catch(e){const code=e instanceof BotError?e.code:'INTERNAL_ERROR';await db.from('discord_channel_controls').update({status:accepted||code==='MUTATION_UNCERTAIN'?'uncertain':'failed',error_code:code,finished_at:new Date().toISOString()}).eq('id',id);await db.from('discord_jobs').update({status:'failed',error_code:code,error_message:code,finished_at:new Date().toISOString()}).eq('id',job.id);throw e;}
}
