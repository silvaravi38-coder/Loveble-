import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {runWorker} from './worker.ts';
import {auditFunctions} from '../discord-interactions/function-audit.ts';
import {ticketAi} from '../discord-interactions/ai.ts';
import {checked,uuid,BotError} from '../discord-interactions/api.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='GET'&&new URL(req.url).searchParams.get('health')==='1')return json({version:'scheduled-messages-v1'});
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const token=req.headers.get('X-Nexium-Scheduler-Token')||'';if(!/^[a-f0-9]{64}$/.test(token))return json({error:'UNAUTHORIZED'},401);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const accepted=await db.from('discord_scheduler_auth').select('token_hash').eq('token_hash',hash).maybeSingle();if(accepted.error||!accepted.data)return json({error:'UNAUTHORIZED'},401);
 try{
  const body=await req.json().catch(()=>({}));
  // Private support diagnostic: replay only an unclaimed ticket owned by a linked administrator.
  if(body.action==='verify_ai'||body.action==='verify_bot'){
   if(!uuid(body.ticket_id))return json({error:'INVALID_ID'},400);
   const ticket=checked(await db.from('support_tickets').select('user_id,assigned_to,status').eq('id',body.ticket_id).single());
   const owner=checked(await db.from('profiles').select('role').eq('id',ticket.user_id).single());
   const map=checked(await db.from('discord_tickets').select('guild_id,channel_id,channel_state').eq('ticket_id',body.ticket_id).is('closed_at',null).single());
   const link=checked(await db.from('discord_account_links').select('discord_user_id').eq('profile_id',ticket.user_id).single());
   if(owner.role!=='admin'||ticket.assigned_to||!['open','in_progress'].includes(ticket.status)||map.channel_state!=='ready')return json({error:'FORBIDDEN'},403);
   if(body.action==='verify_bot')return json(await auditFunctions(db,map.guild_id,link.discord_user_id,map.channel_id,body.ticket_id));
   await ticketAi(db,link.discord_user_id,map.guild_id,body.ticket_id,'reply');return json({ok:true,verified_ai:true});
  }
  const result=await runWorker(db);await db.from('discord_scheduler_auth').update({last_seen_at:new Date().toISOString()}).eq('token_hash',hash);return json({ok:true,...result});
 }catch(e){return json({error:e instanceof BotError?e.code:'WORKER_FAILED'},500);}
});
