import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,discord,productFor,audit,snowflake} from './api.ts';
import {applicationId,privateMessage} from './security.ts';
// Reject administrative capabilities and staff roles even if the bot could grant them.
const sensitive=[3,4,5,13,16,17,19,28,29,30,40,49].reduce((n,b)=>n|(1n<<BigInt(b)),0n);
export function validateDeliveryRole(role:any,roles:any[],member:any,guild:string,staffIds:string[]=[]){
 const highest=Math.max(0,...roles.filter(r=>member.roles.includes(r.id)).map(r=>r.position));
 if(!role||!snowflake(role.id)||role.id===guild||role.managed||role.position>=highest||(BigInt(role.permissions||'0')&sensitive)!==0n||staffIds.includes(role.id))throw new BotError('PROTECTED_DELIVERY_ROLE');
 return role.id;
}
async function checkRole(db:SupabaseClient,guild:string,id:string){
 const [roles,member]=await Promise.all([discord(`/guilds/${guild}/roles`),discord(`/guilds/${guild}/members/${applicationId}`)]);
 const settings=checked(await db.from('discord_bot_settings').select('role_support_id,role_manager_id,role_supplier_id').eq('guild_id',guild).maybeSingle());
 return validateDeliveryRole(roles.find((r:any)=>r.id===id),roles,member,guild,Object.values(settings||{}).filter(Boolean) as string[]);
}
export function validatedAttachment(input:any,id:string){
 const a=input.data?.resolved?.attachments?.[id];
 if(!a||a.id!==id||!Number.isInteger(a.size)||a.size<1||a.size>10485760)throw new BotError('INVALID_DELIVERY_FILE');
 let url:URL;try{url=new URL(a.url);}catch{throw new BotError('INVALID_DELIVERY_FILE');}
 if(url.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)||!url.pathname.startsWith('/attachments/')||url.username||url.password)throw new BotError('INVALID_DELIVERY_FILE');
 const name=String(a.filename||'arquivo').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120);
 return {...a,name,url:url.href};
}
async function attachmentBytes(a:any){
 const r=await fetch(a.url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok||!r.body)throw new BotError('INVALID_DELIVERY_FILE');
 const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10485760||size>a.size)throw new BotError('INVALID_DELIVERY_FILE');chunks.push(value);}}finally{await reader.cancel();}
 if(size!==a.size)throw new BotError('INVALID_DELIVERY_FILE');const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
export async function configureProductDelivery(db:SupabaseClient,input:any,user:string,o:any){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const p=await productFor(db,o.produto);if(!['manual','key','role','file'].includes(o.tipo))throw new BotError('INVALID_PRODUCT');
 let template:any={};
 if(o.tipo==='role'||o.tipo==='file'){
  template={guild_id:input.guild_id,product_id:p.id,kind:o.tipo,configured_by:actor.id,role_id:null,attachment_path:null,attachment_name:null,updated_at:new Date().toISOString()};
  if(o.tipo==='role'){if(!snowflake(o.cargo))throw new BotError('PROTECTED_DELIVERY_ROLE');template.role_id=await checkRole(db,input.guild_id,o.cargo);}
  else {const a=validatedAttachment(input,o.arquivo),bytes=await attachmentBytes(a);template.attachment_path=`${actor.id}/discord-products/${p.id}/${crypto.randomUUID()}-${a.name}`;template.attachment_name=a.name;const upload=await db.storage.from('support-files').upload(template.attachment_path,bytes,{contentType:'application/octet-stream',upsert:false});checked(upload);}
 }
 checked(await db.rpc('discord_configure_product_delivery',{p_user:user,p_guild:input.guild_id,p_product:p.id,p_kind:o.tipo,p_template:template}));
 await audit(db,input.guild_id,actor.id,'product_delivery_configured',p.id,{kind:o.tipo});
 return privateMessage(`Entrega de ${p.name} configurada: ${o.tipo==='role'?'cargo automático':o.tipo==='file'?'arquivo privado automático':o.tipo==='key'?'keys do estoque':'manual'}. Use /nexium-admin sincronizar para atualizar o painel. Pedidos existentes mantêm a entrega escolhida na compra.`);
}
export async function fulfilProductDeliveries(db:SupabaseClient,order:string){
 const deliveries=checked(await db.from('discord_order_fulfilments').select('*').eq('order_id',order).eq('status','pending')) as any[];
 for(const d of deliveries){
  if(d.kind==='role'){await checkRole(db,d.guild_id,d.role_id);await discord(`/guilds/${d.guild_id}/members/${d.discord_user_id}/roles/${d.role_id}`,'PUT');}
  checked(await db.rpc('discord_complete_product_delivery',{p_item:d.order_item_id}));
 }
}
export async function reusableDelivery(db:SupabaseClient,guild:string|undefined,product:string){
 if(!guild)return null;return checked(await db.from('discord_product_fulfilments').select('kind').eq('guild_id',guild).eq('product_id',product).maybeSingle());
}
