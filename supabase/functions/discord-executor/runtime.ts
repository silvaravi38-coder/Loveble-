import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {discordGet,ExecutorError} from './discord.ts';
import {nexiumCommands} from './commands.ts';
const applicationId='1557132199227031552';
const endpointUrl='https://flcqndjlzuhmxxahjudj.supabase.co/functions/v1/discord-interactions';
export async function connectRuntime(db:SupabaseClient,guildId:string,actorId:string,token:string) {
  const app=await discordGet('/applications/@me',token,async()=>{});
  if(app.id!==applicationId || !/^[a-f0-9]{64}$/.test(app.verify_key||''))throw new ExecutorError('DISCORD_APPLICATION_MISMATCH',424);
  if(app.interactions_endpoint_url && app.interactions_endpoint_url!==endpointUrl)throw new ExecutorError('EXISTING_INTERACTION_ENDPOINT_REVIEW_REQUIRED',409);
  const saved=await db.from('discord_runtime_configs').upsert({application_id:applicationId,public_key:app.verify_key,guild_id:guildId,endpoint_url:endpointUrl,updated_by:actorId});
  if(saved.error)throw new ExecutorError('DATABASE_ERROR',500);
  const edit=await fetch(`https://discord.com/api/v10/applications/@me`,{method:'PATCH',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify({interactions_endpoint_url:endpointUrl}),signal:AbortSignal.timeout(15000)});
  if(!edit.ok)throw new ExecutorError('INTERACTION_ENDPOINT_REGISTRATION_FAILED',424);
  const registered=[];
  for(const definition of nexiumCommands) {
    const response=await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify(definition),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new ExecutorError('COMMAND_REGISTRATION_FAILED',424);
    registered.push(await response.json());
  }
  const created=registered[0];
  const verify=await discordGet('/applications/@me',token,async()=>{});
  const commands=await discordGet(`/applications/${applicationId}/guilds/${guildId}/commands`,token,async()=>{});
  if(verify.interactions_endpoint_url!==endpointUrl || !registered.every(r=>commands.some((c:{id:string})=>c.id===r.id)))throw new ExecutorError('RUNTIME_VERIFICATION_FAILED',502);
  const finished=await db.from('discord_runtime_configs').update({command_id:created.id,connected_at:new Date().toISOString()}).eq('application_id',applicationId);
  if(finished.error)throw new ExecutorError('DATABASE_ERROR',500);
  return {endpoint_url:endpointUrl,command_id:created.id,commands:nexiumCommands.flatMap(c=>c.options.map(s=>`/${c.name} ${s.name}`)),signed_endpoint_verified:true};
}
