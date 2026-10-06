import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {webhookProof,providerCharge,fulfilPaid} from '../discord-interactions/payments.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const url=new URL(req.url),orderId=url.searchParams.get('order')||'',proof=url.searchParams.get('proof')||'',secret=Deno.env.get('TURBOFYPAY_CLIENT_SECRET');
 if(!secret)return json({error:'PAYMENT_NOT_CONFIGURED'},503);
 if(!/^[a-f0-9-]{36}$/.test(orderId)||!/^[a-f0-9]{64}$/.test(proof))return json({error:'UNAUTHORIZED'},401);
 const expected=await webhookProof(orderId,secret);let difference=0;for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^proof.charCodeAt(i);
 if(difference!==0)return json({error:'UNAUTHORIZED'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const payment=await db.from('payments').select('provider_payment_id').eq('order_id',orderId).eq('provider','turbofypay').maybeSingle();
 if(payment.error||!payment.data)return json({error:'PAYMENT_NOT_READY'},503);
 try{
  // The callback is only a trigger. Its claimed status is never trusted.
  const charge=await providerCharge(payment.data.provider_payment_id);
  const result=await db.rpc('discord_settle_payment',{p_payment_id:payment.data.provider_payment_id,p_charge:charge});
  if(result.error)return json({error:'SETTLEMENT_FAILED'},500);
  if(result.data.paid)await fulfilPaid(db,orderId);
  return json({ok:true});
 }catch{return json({error:'PAYMENT_RECONCILIATION_FAILED'},502);}
});
