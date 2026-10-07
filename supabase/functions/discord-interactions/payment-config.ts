import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,row,button} from './api.ts';
import {privateMessage} from './security.ts';
export async function paymentConfigStatus(db:SupabaseClient,guild:string){
 const saved=checked(await db.from('discord_payment_credentials').select('id,created_at').eq('guild_id',guild).eq('active',true).maybeSingle());
 const legacy=typeof Deno!=='undefined'&&!!Deno.env.get('TURBOFYPAY_CLIENT_ID')&&!!Deno.env.get('TURBOFYPAY_CLIENT_SECRET');
 return {configured:!!saved||legacy,source:saved?'Discord':legacy?'Configuração existente':'Não configurado'};
}
export async function resolvePaymentCredentials(db:SupabaseClient,guild?:string,order?:string){
 const credentials=checked(await db.rpc('discord_get_payment_credentials',{p_guild:guild||null,p_order:order||null}));
 if(credentials)return credentials as {id:string;secret:string};
 const id=Deno.env.get('TURBOFYPAY_CLIENT_ID'),secret=Deno.env.get('TURBOFYPAY_CLIENT_SECRET');
 if(!id||!secret)throw new BotError('PAYMENT_NOT_CONFIGURED');return {id,secret};
}
export async function paymentConfigModal(db:SupabaseClient,input:any,user:string){
 if(input.type!==3||input.data?.custom_id!=='nexium:payment-config:edit')return null;
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 return {type:9,data:{custom_id:'nexium:payment-config:save',title:'Configurar Pix • TurbofyPay',components:[{type:1,components:[{type:4,custom_id:'client_id',label:'Client ID da TurbofyPay',style:1,min_length:8,max_length:512,required:true}]},{type:1,components:[{type:4,custom_id:'client_secret',label:'Client Secret (não aparece no canal)',style:1,min_length:8,max_length:512,required:true}]}]}};
}
export function parsePaymentConfig(input:any){
 const fields=input.data?.components?.flatMap((r:any)=>r.components||[])||[];
 const read=(name:string)=>{const value=fields.find((c:any)=>c.custom_id===name)?.value;if(typeof value!=='string'||value.length<8||value.length>512||/\s/.test(value))throw new BotError('INVALID_PAYMENT_CREDENTIALS');return value;};
 return {id:read('client_id'),secret:read('client_secret')};
}
export async function savePaymentConfig(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const creds=parsePaymentConfig(input);
 checked(await db.rpc('discord_save_payment_credentials',{p_user:user,p_guild:input.guild_id,p_interaction:input.id,p_client_id:creds.id,p_secret:creds.secret}));
 return {...privateMessage('Credenciais do Pix salvas com proteção no cofre. A autenticação será conferida pelo provedor ao gerar uma cobrança. Pedidos anteriores continuam usando a configuração da compra. Nenhuma cobrança foi criada agora.'),components:[row([button('Voltar aos pagamentos','nexium:botconfig:tab:pagamentos',2)])]};
}
