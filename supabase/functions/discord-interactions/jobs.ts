import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,BotError} from './api.ts';
import {privateMessage} from './security.ts';
export async function executorJob(db:SupabaseClient,guild:string,actorId:string,action:string,strategy='reuse',previewId?:string) {
 const config=checked(await db.from('discord_builder_configs').select('id').eq('guild_id',guild).order('updated_at',{ascending:false}).limit(1).maybeSingle());
 if(!config)throw new BotError('BUILDER_CONFIG_REQUIRED');
 const proof=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof))),b=>b.toString(16).padStart(2,'0')).join('');
 const job=checked(await db.from('discord_jobs').insert({config_id:config.id,guild_id:guild,action,requested_by:actorId,idempotency_key:crypto.randomUUID(),input:{strategy,expected_application_id:'1557132199227031552',...(previewId?{preview_job_id:previewId}:{})}}).select('id').single());
 const dispatch=await db.from('discord_job_dispatches').insert({job_id:job.id,token_hash:hash,expires_at:new Date(Date.now()+180000).toISOString()});if(dispatch.error){await db.from('discord_jobs').update({status:'failed',error_code:'DISPATCH_FAILED',finished_at:new Date().toISOString()}).eq('id',job.id);throw new BotError('DATABASE_ERROR');}
 let response:Response;try{response=await fetch('https://flcqndjlzuhmxxahjudj.supabase.co/functions/v1/discord-executor',{method:'POST',headers:{'Content-Type':'application/json','X-Nexium-Job-Capability':proof},body:JSON.stringify({job_id:job.id}),signal:AbortSignal.timeout(55000)});}catch{return privateMessage(`Job ${job.id} iniciado. Consulte o status no Admin; não repita enquanto estiver em andamento.`);}
 const result=await response.json();
 if(!response.ok)return privateMessage(`Job ${job.id}: ${result.error||'Falha'}\nConsulte os logs no Admin.`);
 const summary=result.job?.result;
 return privateMessage(`Job ${job.id}: ${result.job.status}\n${action==='scan'?`${summary.categories} categorias, ${summary.channels} canais, ${summary.roles} cargos.`:action==='preview'?JSON.stringify(summary.operations.map((o:any)=>({name:o.name,action:o.action}))).slice(0,1500):action==='backup'?`Snapshot estrutural: ${summary.snapshot_id}`:`Criados: ${summary.created?.length||0}. Nenhuma exclusão.`}\n${action==='preview'?'Revise o plano no Admin. Aplicar permite criar faltantes e mover canais conforme o preview, com backup e estrutura inalterada.':''}`);
}
export async function panelJob(db:SupabaseClient,guild:string,actorId:string,action:'publish'|'sync'|'unpublish',panelId:string,execute:()=>Promise<any>) {
 const config=checked(await db.from('discord_builder_configs').select('id').eq('guild_id',guild).order('updated_at',{ascending:false}).limit(1).single());
 const job=checked(await db.from('discord_jobs').insert({config_id:config.id,guild_id:guild,action,requested_by:actorId,idempotency_key:crypto.randomUUID(),status:'running',attempts:1,started_at:new Date().toISOString(),input:{target:'catalog_panel',panel_id:panelId}}).select('id').single());
 checked(await db.from('discord_job_logs').insert({job_id:job.id,level:'info',code:'PANEL_STARTED',details:{panel_id:panelId}}));
 try{const result=await execute();checked(await db.from('discord_jobs').update({status:'succeeded',result:{panel_id:panelId},finished_at:new Date().toISOString()}).eq('id',job.id));checked(await db.from('discord_job_logs').insert({job_id:job.id,level:'info',code:'PANEL_COMPLETED'}));return result;}
 catch(error){const code=error instanceof BotError?error.code:'INTERNAL_ERROR';await db.from('discord_jobs').update({status:'failed',error_code:code,error_message:code,finished_at:new Date().toISOString()}).eq('id',job.id);await db.from('discord_job_logs').insert({job_id:job.id,level:'error',code});throw error;}
}
