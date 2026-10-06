export const applicationId='1557132199227031552';
export const endpointUrl='https://flcqndjlzuhmxxahjudj.supabase.co/functions/v1/discord-interactions';
const unhex=(value:string)=>Uint8Array.from(value.match(/../g)!,x=>parseInt(x,16));
export async function verifyDiscordSignature(publicKey:string,signature:string,timestamp:string,body:string,now=Date.now()) {
  if(!/^[a-f0-9]{64}$/i.test(publicKey) || !/^[a-f0-9]{128}$/i.test(signature) || !/^\d{10,11}$/.test(timestamp))return false;
  if(Math.abs(now-Number(timestamp)*1000)>300000)return false;
  try{
    const key=await crypto.subtle.importKey('raw',unhex(publicKey),{name:'Ed25519'},false,['verify']);
    return await crypto.subtle.verify('Ed25519',key,unhex(signature),new TextEncoder().encode(timestamp+body));
  }catch{return false;}
}
export function interactionAction(input:{type:number;data?:{name?:string;custom_id?:string;options?:{name:string}[]}}) {
  if(input.type===3 && input.data?.custom_id==='nexium:my-orders:v1')return 'orders';
  if(input.type===2 && input.data?.name==='nexium') {
    if(input.data.options?.[0]?.name==='teste')return 'test';
    if(input.data.options?.[0]?.name==='pedidos')return 'orders';
  }
  return 'unsupported';
}
export const privateMessage=(content:string)=>({content,allowed_mentions:{parse:[]},components:[] as unknown[]});
export function orderMessage(orders:{id:string;status:string;created_at:string}[]) {
  const labels:Record<string,string>={pending:'Aguardando pagamento',paid:'Pago',processing:'Em processamento',delivered:'Entregue',cancelled:'Cancelado',refunded:'Reembolsado'};
  return privateMessage(orders.length?'Seus pedidos mais recentes:\n'+orders.slice(0,5).map(o=>`• #${o.id.slice(0,8).toUpperCase()} — ${labels[o.status]||'Status indisponível'} (${new Date(o.created_at).toLocaleDateString('pt-BR',{timeZone:'America/Fortaleza'})})`).join('\n'):'Nenhum pedido foi encontrado na sua conta Nexium.');
}
