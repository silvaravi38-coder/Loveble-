import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
export class BotError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
export const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const snowflake=(value:unknown):value is string=>typeof value==='string'&&/^[0-9]{17,20}$/.test(value);
export const safeText=(value:unknown,max=2000)=>String(value??'').replace(/[@`*_~|<>\\]/g,'').slice(0,max);
export async function discord(path:string,method='GET',body?:unknown) {
 const token=Deno.env.get('DISCORD_BOT_TOKEN');if(!token)throw new BotError('DISCORD_TOKEN_MISSING');
 let r:Response;try{r=await fetch(`https://discord.com/api/v10${path}`,{method,headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});}catch{throw new BotError(method==='GET'?'DISCORD_NETWORK':'MUTATION_UNCERTAIN');}
 if(!r.ok)throw new BotError(r.status===403?'DISCORD_PERMISSION_DENIED':r.status===429?'DISCORD_RATE_LIMIT':r.status>=500&&method!=='GET'?'MUTATION_UNCERTAIN':'DISCORD_API_ERROR');
 return r.status===204?null:r.json();
}
export const checked=<T extends {data:any;error:any}>(r:T)=>{if(r.error)throw new BotError('DATABASE_ERROR');return r.data;};
export async function actorFor(db:SupabaseClient,discordId:string) {
 const link=checked(await db.from('discord_account_links').select('profile_id').eq('discord_user_id',discordId).maybeSingle());
 if(!link)throw new BotError('LINK_REQUIRED');
 return checked(await db.from('profiles').select('id,role,full_name').eq('id',link.profile_id).single()) as {id:string;role:string;full_name:string};
}
export async function audit(db:SupabaseClient,guild:string,actor:string,action:string,entity?:string,details:unknown={}) {
 checked(await db.from('discord_audit_events').insert({guild_id:guild,actor_id:actor,action,entity_id:entity,details}));
}
export const row=(components:unknown[])=>({type:1,components});
export const button=(label:string,id:string,style=1)=>({type:2,style,label,custom_id:id});
export const linkButton=(label:string,url:string)=>({type:2,style:5,label,url});
export async function productFor(db:SupabaseClient,term:string) {
 const products=checked(await db.from('products').select('id,name,slug,description,price,image_url,automatic_delivery,delivery_time,requirements').eq('active',true).order('name')) as any[];
 const exact=products.filter(p=>p.id===term || p.slug.toLowerCase()===term.toLowerCase() || p.name.trim().toLowerCase()===term.trim().toLowerCase());
 const candidates=exact.length?exact:products.filter(p=>p.name.toLowerCase().includes(term.toLowerCase()));
 if(candidates.length!==1)throw new BotError(candidates.length?'AMBIGUOUS_PRODUCT':'PRODUCT_UNAVAILABLE');return candidates[0];
}

export function fortalezaMonthStart(now=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit'}).formatToParts(now);const year=parts.find(p=>p.type==='year')!.value,month=parts.find(p=>p.type==='month')!.value;return new Date(`${year}-${month}-01T00:00:00-03:00`);}
