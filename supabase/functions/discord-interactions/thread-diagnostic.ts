import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord,BotError} from './api.ts';
import {createPrivateTicketThread,threadMemberAccess,isTicketChannel} from './ticket-channel.ts';
import {deleteClosedTicketChannel} from './ticket-lifecycle.ts';
export async function verifyPrivateThread(db:SupabaseClient,guild:string,user:string){
 const panel=checked(await db.from('discord_sales_panels').select('channel_id').eq('guild_id',guild).eq('active',true).eq('panel_kind','tickets').eq('sync_status','synced').order('created_at',{ascending:false}).limit(1).single());
 const ticket=crypto.randomUUID();let result:any,parent:any,channel:any,stage='identity',permissions='0',bot:any,identity:any;
 try{
  identity=await discord('/users/@me');if(identity.id!=='1557132199227031552')throw new BotError('WRONG_BOT_IDENTITY');
  stage='parent';parent=await discord(`/channels/${panel.channel_id}`);
  stage='roles';bot=await discord(`/guilds/${guild}/members/1557132199227031552`);const roles=await discord(`/guilds/${guild}/roles`);
  permissions=roles.filter((r:any)=>r.id===guild||bot.roles.includes(r.id)).reduce((mask:bigint,r:any)=>mask|BigInt(r.permissions||'0'),0n).toString();
  stage='cleanup_diagnostics';const active=await discord(`/guilds/${guild}/threads/active`);const cleanup=[];
  for(const thread of active.threads||[]){if(thread.type!==12||thread.owner_id!==identity.id||thread.parent_id!==parent.id||!/^teste-privado-diagnostico-[a-f0-9]{8}$/.test(thread.name))continue;
   try{await discord(`/channels/${thread.id}`,'DELETE');cleanup.push({id:thread.id,deleted:true});}catch(e){if(!(e instanceof BotError)||e.code!=='DISCORD_PERMISSION_DENIED')throw e;await discord(`/channels/${thread.id}`,'PATCH',{archived:true});cleanup.push({id:thread.id,archived:true});}}
  if((BigInt(permissions)&((1n<<34n)|8n))===0n)return {ok:false,error:'MANAGE_THREADS_REQUIRED',can_create_private:true,parent_id:parent.id,cleanup};
  stage='create';channel=await createPrivateTicketThread(parent,guild,ticket,'Teste privado',{id:user,username:'diagnostico'});
  stage='invite';await threadMemberAccess(channel,user);
  stage='verify';const member=await discord(`/channels/${channel.id}/thread-members/${user}`);
  const current=await discord(`/channels/${channel.id}`);
  if(!member||!isTicketChannel(current,guild,ticket,channel.id)||current.thread_metadata?.invitable!==false)throw new BotError('THREAD_VERIFICATION_FAILED');
  result={ok:true,private_thread:true,parent_id:parent.id,owner_access:true,bot_permissions:permissions};
 }catch(e){result={ok:false,stage,error:e instanceof BotError?e.code:'THREAD_TEST_FAILED',bot_permissions:permissions,bot_id:identity?.id,bot_roles:bot?.roles,parent_bot_overwrite:parent?.permission_overwrites?.find((o:any)=>o.id==='1557132199227031552')||null};}finally{if(channel)try{await deleteClosedTicketChannel({ticket:{id:ticket,status:'closed'},discord:{closed_at:new Date().toISOString(),channel_id:channel.id,channel_state:'ready'}},guild);result.cleanup=true;}catch(e){result={...result,cleanup:false,cleanup_error:e instanceof BotError?e.code:'CLEANUP_FAILED',diagnostic_channel_id:channel.id};}}
 return result;
}
