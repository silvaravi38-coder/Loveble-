import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {groqReply} from './support-provider.ts';
import {parseStoreAIReply} from './store-ai.ts';
import {ticketAi} from './ai.ts';
import {route} from './router.ts';
import {checked,discord,BotError} from './api.ts';
import {nexiumCommands} from '../discord-executor/commands.ts';
export function validateDiscordPayload(message:any){
 const errors:string[]=[];
 if(String(message.content||'').length>2000)errors.push('CONTENT_LIMIT');
 if((message.embeds||[]).length>10)errors.push('EMBED_LIMIT');
 let total=0;
 for(const e of message.embeds||[]){total+=(e.title||'').length+(e.description||'').length+(e.footer?.text||'').length+(e.author?.name||'').length;
  if((e.title||'').length>256||(e.description||'').length>4096||(e.fields||[]).length>25)errors.push('EMBED_FIELD_LIMIT');
  for(const f of e.fields||[]){total+=(f.name||'').length+(f.value||'').length;if(!f.name||!f.value||f.name.length>256||f.value.length>1024)errors.push('EMBED_FIELD_LIMIT');}
 }
 if(total>6000)errors.push('EMBED_TOTAL_LIMIT');
 if((message.components||[]).length>5)errors.push('ROW_LIMIT');
 for(const r of message.components||[]){if(r.type!==1||!r.components?.length||r.components.length>5)errors.push('INVALID_ROW');
  for(const c of r.components||[]){if(c.custom_id&&c.custom_id.length>100)errors.push('CUSTOM_ID_LIMIT');if(c.label&&c.label.length>80)errors.push('LABEL_LIMIT');
   if(c.type===3){if(!c.options?.length||c.options.length>25||r.components.length!==1)errors.push('SELECT_LIMIT');for(const o of c.options||[])if(!o.label||!o.value||o.label.length>100||o.value.length>100||(o.description||'').length>100)errors.push('SELECT_OPTION_LIMIT');}
  }
 }
 return [...new Set(errors)];
}
// Called only by the scheduler's linked-administrator, owned-ticket diagnostic.
// This inventory never purchases, changes settings or closes an existing ticket.
export async function auditFunctions(db:SupabaseClient,guild:string,user:string,channel:string,ticket:string){
 const checks:{name:string;ok:boolean;code?:string}[]=[];
 const input={type:2,guild_id:guild,channel_id:channel,member:{user:{id:user}}};
 const run=async(name:string,fn:()=>Promise<any>,payload=true)=>{try{const result=await fn();const errors=payload?validateDiscordPayload(result):[];checks.push({name,ok:!errors.length,...(errors.length?{code:errors.join(',')}:{} )});}catch(e){checks.push({name,ok:false,code:e instanceof BotError?e.code:'AUDIT_FAILED'});}};
 const command=(name:string,sub:string,options:Record<string,any>={})=>route(db,{...input,data:{name,options:[{name:sub,options:Object.entries(options).map(([name,value])=>({name,value}))}]}},user);
 const pages=['home','marketplace','atendimento','definicoes','automacoes','moderacao','rendimento','tools','permissoes','pagamentos','cargos','canais','notificacoes','ia','divulgacao','personalizacao','oauth'];
 await Promise.all(pages.map(p=>run('botconfig:'+p,()=>route(db,{...input,type:3,data:{custom_id:'nexium:botconfig:tab:'+p}},user))));
 await Promise.all(['teste','ajuda','vincular','perfil','pedidos','catalogo'].map(p=>run('nexium:'+p,()=>command('nexium',p))));
 await Promise.all(['checklist','diagnostico','dashboard','paineis','estoque','suportes','mensagens'].map(p=>run('admin:'+p,()=>command('nexium-admin',p))));
 await Promise.all(['today','month','total','7days','30days'].map(p=>run('financeiro:'+p,()=>command('nexium-admin','financeiro',{periodo:p}))));
 await Promise.all(['today','month','total','7days','30days'].map(p=>run('ranking:'+p,()=>command('nexium-admin','ranking-produtos',{periodo:p}))));
 await run('ia:provider',async()=>{const key=Deno.env.get('GROQ_API_KEY');if(!key)throw new BotError('GROQ_KEY_REQUIRED');const reply=await groqReply(key,'Responda apenas JSON válido com text e proposal:null. Não execute nenhuma ação.','Diagnóstico interno: confirme disponibilidade em português, sem alterar nada.',800);const parsed=parseStoreAIReply(reply.text);if(parsed.proposal)throw new BotError('INVALID_AI_PROPOSAL');return {};},false);
 await run('ia:sugestao',()=>ticketAi(db,user,guild,ticket,'suggest'));
 for(const action of ['ticket-staff','ticket-member','ticket-payment','ticket-view'])await run('button:'+action,()=>route(db,{...input,type:3,data:{custom_id:`nexium:${action}:${ticket}`}},user));
 await run('ticket:listar',()=>command('ticket','listar'));
 await run('ticket:ver',()=>command('ticket','ver',{ticket}));
 const products=checked(await db.from('products').select('id').eq('active',true).order('name').limit(100)) as any[];
 for(let i=0;i<products.length;i+=5)await Promise.all(products.slice(i,i+5).map((p:any)=>run('produto:'+p.id,()=>command('nexium','produto',{produto:p.id}))));
 await run('commands:registered',async()=>{const actual=await discord(`/applications/1557132199227031552/guilds/${guild}/commands`);for(const c of nexiumCommands){const found=actual.find((a:any)=>a.name===c.name);if(!found)throw new BotError('COMMAND_MISSING');for(const option of c.options||[])if(!found.options?.some((o:any)=>o.name===option.name))throw new BotError('COMMAND_OPTION_MISSING');}return {};},false);
 const panels=checked(await db.from('discord_sales_panels').select('id,channel_id,message_id').eq('guild_id',guild).eq('active',true).eq('sync_status','synced')) as any[];
 for(const p of panels)await run('panel:'+p.id,async()=>{if(!p.message_id)throw new BotError('PANEL_NOT_PUBLISHED');const message=await discord(`/channels/${p.channel_id}/messages/${p.message_id}`);if(message.author?.id!=='1557132199227031552')throw new BotError('PANEL_NOT_OWNED');return message;});
 await run('ticket:access',async()=>{const c=await discord(`/channels/${channel}`);if(c.guild_id!==guild||!c.permission_overwrites?.some((o:any)=>o.id===user&&(BigInt(o.allow)&1024n)!==0n))throw new BotError('TICKET_OWNER_ACCESS_MISSING');return {};},false);
 return {ok:checks.every(c=>c.ok),total:checks.length,passed:checks.filter(c=>c.ok).length,checks:checks.sort((a,b)=>a.name.localeCompare(b.name))};
}
