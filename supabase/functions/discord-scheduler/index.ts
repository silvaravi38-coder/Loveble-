import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {runWorker} from './worker.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='GET'&&new URL(req.url).searchParams.get('health')==='1')return json({version:'scheduled-messages-v1'});
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const token=req.headers.get('X-Nexium-Scheduler-Token')||'';if(!/^[a-f0-9]{64}$/.test(token))return json({error:'UNAUTHORIZED'},401);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const accepted=await db.from('discord_scheduler_auth').select('token_hash').eq('token_hash',hash).maybeSingle();if(accepted.error||!accepted.data)return json({error:'UNAUTHORIZED'},401);
 try{const result=await runWorker(db);await db.from('discord_scheduler_auth').update({last_seen_at:new Date().toISOString()}).eq('token_hash',hash);return json({ok:true,...result});}catch{return json({error:'WORKER_FAILED'},500);}
});
