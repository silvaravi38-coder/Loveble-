import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {applicationId,verifyDiscordSignature,interactionAction,privateMessage,orderMessage} from './security.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
  if(req.method==='GET' && new URL(req.url).searchParams.get('health')==='1')return json({version:'signed-interactions-v1'});
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  const signature=req.headers.get('X-Signature-Ed25519')||'',timestamp=req.headers.get('X-Signature-Timestamp')||'';
  if(!/^[a-f0-9]{128}$/i.test(signature))return json({error:'INVALID_SIGNATURE'},401);
  const body=await req.text();if(body.length>65536)return json({error:'PAYLOAD_TOO_LARGE'},413);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const config=await db.from('discord_runtime_configs').select('public_key,guild_id').eq('application_id',applicationId).maybeSingle();
  if(config.error || !config.data)return json({error:'RUNTIME_NOT_CONFIGURED'},503);
  if(!await verifyDiscordSignature(config.data.public_key,signature,timestamp,body))return json({error:'INVALID_SIGNATURE'},401);
  let input;try{input=JSON.parse(body);}catch{return json({error:'INVALID_JSON'},400);}
  if(input.type===1)return json({type:1});
  if(input.application_id!==applicationId || input.guild_id!==config.data.guild_id)return json({error:'WRONG_APPLICATION_OR_GUILD'},403);
  const userId=input.member?.user?.id;
  if(!/^[0-9]{17,20}$/.test(input.id||'') || !/^[0-9]{17,20}$/.test(userId||'') || typeof input.token!=='string' || !/^[A-Za-z0-9._-]{1,512}$/.test(input.token))return json({error:'INVALID_INTERACTION'},400);
  const action=interactionAction(input);
  const receipt=await db.from('discord_interaction_events').insert({interaction_id:input.id,guild_id:input.guild_id,discord_user_id:userId,action});
  if(receipt.error)return json({error:receipt.error.code==='23505'?'INTERACTION_ALREADY_RECEIVED':'DATABASE_ERROR'},receipt.error.code==='23505'?409:500);
  // Acknowledge privately before querying orders; never expose purchases in a public channel.
  EdgeRuntime.waitUntil((async()=>{
    let message=privateMessage('Não foi possível consultar agora. Tente novamente.');let code='INTERNAL_ERROR';
    try{
      if(action==='test') {
        message={...privateMessage('Nexium conectado. Use /nexium pedidos para consultar os pedidos da sua conta.'),components:[{type:1,components:[{type:2,style:1,label:'Meus pedidos',custom_id:'nexium:my-orders:v1'}]}]} as typeof message;
        code='TEST_OK';
      }else if(action==='orders'){
        const link=await db.from('discord_account_links').select('profile_id').eq('discord_user_id',userId).maybeSingle();
        if(link.error)throw new Error('DATABASE_ERROR');
        if(!link.data){message=privateMessage('Conecte sua conta Discord em https://nexium-store.vercel.app → Minha conta para consultar seus pedidos.');code='LINK_REQUIRED';}
        else{
          const orders=await db.from('orders').select('id,status,created_at').eq('user_id',link.data.profile_id).order('created_at',{ascending:false}).limit(5);
          if(orders.error)throw new Error('DATABASE_ERROR');
          message=orderMessage(orders.data||[]);code='ORDERS_OK';
        }
      }else{message=privateMessage('Esta ação ainda não está disponível.');code='UNSUPPORTED_ACTION';}
    }catch{code='DATABASE_ERROR';}
    // Interaction token is kept only in this request's memory, never in audit records.
    let delivered=false;
    try{const result=await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${encodeURIComponent(input.token)}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(8000)});delivered=result.ok;}catch{}
    await db.from('discord_interaction_events').update({status:delivered&&code!=='DATABASE_ERROR'?'succeeded':'failed',response_code:delivered?code:'RESPONSE_DELIVERY_FAILED',finished_at:new Date().toISOString()}).eq('interaction_id',input.id);
  })());
  return json({type:5,data:{flags:64}});
});
