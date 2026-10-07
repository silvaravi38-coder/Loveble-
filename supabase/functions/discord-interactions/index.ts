import {productRequestModal,submitProductRequest} from './product-requests.ts';
import {ticketModal,submitTicketModal} from './ticket-ui.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {applicationId,verifyDiscordSignature,privateMessage} from './security.ts';
import {route,eventAction,errorMessages} from './router.ts';
import {BotError} from './api.ts';
import {deliverResponse} from './delivery.ts';
import {restockModal,saveRestock} from './restock.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
  if(req.method==='GET' && new URL(req.url).searchParams.get('health')==='1')return json({version:'commerce-tickets-v1',ai_configured:!!Deno.env.get('AI_GATEWAY_API_KEY'),pix_configured:!!Deno.env.get('TURBOFYPAY_CLIENT_ID')&&!!Deno.env.get('TURBOFYPAY_CLIENT_SECRET')});
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
  try{const modal=await productRequestModal(db,input)||await ticketModal(db,input,userId)||await restockModal(db,input,userId);if(modal)return json(modal);}catch(error){const code=error instanceof BotError?error.code:'INTERNAL_ERROR';return json({type:4,data:{content:errorMessages[code]||'Não foi possível abrir o formulário.',flags:64,allowed_mentions:{parse:[]}}});}
  const action=eventAction(input);
  const receipt=await db.from('discord_interaction_events').insert({interaction_id:input.id,guild_id:input.guild_id,discord_user_id:userId,action});
  if(receipt.error)return json({error:receipt.error.code==='23505'?'INTERACTION_ALREADY_RECEIVED':'DATABASE_ERROR'},receipt.error.code==='23505'?409:500);
  // Acknowledge privately before querying orders; never expose purchases in a public channel.
  EdgeRuntime.waitUntil((async()=>{
    let message=privateMessage('Não foi possível consultar agora. Tente novamente.');let code='INTERNAL_ERROR';
    try{
      message=input.type===5&&String(input.data?.custom_id).startsWith('nexium:stock-request-submit:')?await submitProductRequest(db,input,userId):input.type===5&&String(input.data?.custom_id).startsWith('nexium:restock:')?await saveRestock(db,input,userId):input.type===5?await submitTicketModal(db,input,userId):await route(db,input,userId);code='ACTION_OK';
    }catch(error){code=error instanceof BotError?error.code:'INTERNAL_ERROR';message=privateMessage(errorMessages[code]||'Não foi possível concluir esta ação agora. Consulte o suporte.');}
    // Interaction token is kept only in this request's memory, never in audit records.
    let delivered=false;
    try{const result=await deliverResponse(`https://discord.com/api/v10/webhooks/${applicationId}/${encodeURIComponent(input.token)}/messages/@original`,message);delivered=result.ok;}catch{}
    await db.from('discord_interaction_events').update({status:delivered&&code==='ACTION_OK'?'succeeded':'failed',response_code:delivered?code:'RESPONSE_DELIVERY_FAILED',finished_at:new Date().toISOString()}).eq('interaction_id',input.id);
  })());
  return json({type:5,data:{flags:64}});
});
