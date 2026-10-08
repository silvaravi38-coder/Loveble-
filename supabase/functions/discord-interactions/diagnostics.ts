import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {checked,discord} from './api.ts';
import {paymentConfigStatus} from './payment-config.ts';
import {privateMessage} from './security.ts';
export async function storeDiagnostics(db:SupabaseClient,guild:string){
 const settings=checked(await db.from('discord_bot_settings').select('pix_enabled,role_customer_id,role_support_id,category_support_id,channel_logs_id').eq('guild_id',guild).maybeSingle());
 const panels=checked(await db.from('discord_sales_panels').select('name,channel_id,sync_status,message_id').eq('guild_id',guild).eq('active',true)) as any[];
 const [channels,roles]=await Promise.all([discord(`/guilds/${guild}/channels`),discord(`/guilds/${guild}/roles`)]);
 const checks:string[]=[];
 for(const [field,label] of [['role_customer_id','Cargo Cliente'],['role_support_id','Cargo Suporte']]){const id=settings?.[field],role=roles.find((r:any)=>r.id===id);checks.push(`${label}: ${!id?'não configurado':role&&!role.managed&&role.id!==guild?'encontrado':'inválido ou protegido'}`);}
 for(const [field,label,type] of [['category_support_id','Categoria de tickets',4],['channel_logs_id','Canal de logs',0]]){const id=settings?.[field],channel=channels.find((c:any)=>c.id===id);checks.push(`${label}: ${!id?'não configurado':channel&&(channel.type===type||(field==='channel_logs_id'&&channel.type===5))?'encontrado':'ausente ou tipo incorreto'}`);}
 const missing=panels.filter(p=>!channels.some((c:any)=>c.id===p.channel_id)),pending=panels.filter(p=>p.sync_status!=='synced'||!p.message_id);
 checks.push(`Painéis ativos: ${panels.length} • canais ausentes: ${missing.length} • sem sincronização confirmada: ${pending.length}`);
 checks.push(`Pix Discord: ${settings?.pix_enabled?'ligado':'desligado'}`);
 const payment=await paymentConfigStatus(db,guild);
 checks.push(`Credenciais Pix: ${payment.configured?'configuradas':'pendentes'}`);
 checks.push(`Chave de IA: ${Deno.env.get('GROQ_API_KEY')?'Groq configurada':Deno.env.get('AI_GATEWAY_API_KEY')?'Gateway configurada':'pendente'}`);
 return {...privateMessage(''),embeds:[{title:'Checkers da Nexium',description:checks.join('\n')+'\n\nDiagnóstico da configuração da loja. Não testa credenciais de clientes nem faz cobranças. A presença de uma chave não confirma a disponibilidade do provedor.',color:0xe3e5e8,footer:{text:'Nexium Store • Nenhuma configuração alterada'}}]};
}
