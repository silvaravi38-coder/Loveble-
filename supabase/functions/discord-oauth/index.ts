import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {authorizationUrl,callbackUrl,exchangeIdentity,stateHash,storeUrl,validState} from './oauth.ts';
const cors={'Access-Control-Allow-Origin':storeUrl,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const redirect=(status:string)=>new Response(null,{status:303,headers:{Location:`${storeUrl}/?discord=${status}`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:cors});
  const url=new URL(req.url),secret=Deno.env.get('DISCORD_CLIENT_SECRET');
  if(req.method==='GET' && url.searchParams.get('health')==='1') return json({version:'discord-account-link-v1',client_secret_configured:!!secret,callback_url:callbackUrl});
  const backendUrl=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!backendUrl || !service) return json({error:'BACKEND_NOT_CONFIGURED'},503);
  const db=createClient(backendUrl,service,{auth:{persistSession:false,autoRefreshToken:false}});
  if(req.method==='POST'){
    const jwt=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if(!jwt) return json({error:'UNAUTHORIZED'},401);
    const {data,error}=await db.auth.getUser(jwt);
    if(error || !data.user) return json({error:'UNAUTHORIZED'},401);
    if(!secret) return json({error:'DISCORD_CLIENT_SECRET_MISSING'},424);
    const existing=await db.from('discord_account_links').select('profile_id').eq('profile_id',data.user.id).maybeSingle();
    if(existing.error) return json({error:'DATABASE_ERROR'},500);
    if(existing.data) return json({error:'ACCOUNT_ALREADY_LINKED'},409);
    const recent=await db.from('discord_oauth_states').select('*',{count:'exact',head:true}).eq('profile_id',data.user.id).gt('created_at',new Date(Date.now()-60000).toISOString());
    if(recent.error) return json({error:'DATABASE_ERROR'},500);
    if((recent.count||0)>=3) return json({error:'RATE_LIMITED'},429);
    const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const inserted=await db.from('discord_oauth_states').insert({profile_id:data.user.id,state_hash:await stateHash(state)});
    if(inserted.error) return json({error:'DATABASE_ERROR'},500);
    return json({authorization_url:authorizationUrl(state)});
  }
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!secret) return redirect('unconfigured');
  const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  if(!validState(state) || !code || code.length>2048 || url.searchParams.has('error')) return redirect('failed');
  try{
    const claim=await db.rpc('discord_consume_oauth_state',{p_state_hash:await stateHash(state)});
    if(claim.error || !claim.data) return redirect('expired');
    const user=await exchangeIdentity(code,secret);
    // Unique IDs prevent stealing an existing link or linking one Discord account to two customers.
    const inserted=await db.from('discord_account_links').insert({profile_id:claim.data,discord_user_id:user.id,discord_username:user.username});
    if(inserted.error) return redirect(inserted.error.code==='23505'?'already_linked':'failed');
    return redirect('connected');
  }catch{return redirect('failed');}
});
