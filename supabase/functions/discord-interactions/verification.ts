import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,audit,BotError,checked,discord,snowflake,row,button,safeText} from './api.ts';
import {applicationId,privateMessage} from './security.ts';

const channelKey='server-verification-channel';
const roleKey='server-verification-role';
const panelKey='server-verification-panel';

async function mapping(db:SupabaseClient,guild:string,key:string){
 return checked(await db.from('discord_resource_mappings').select('guild_id,discord_id,resource_type,logical_key,name,parent_id').eq('guild_id',guild).eq('logical_key',key).maybeSingle()) as any;
}
async function bind(db:SupabaseClient,guild:string,id:string,type:string,key:string,name:string,parent?:string){
 checked(await db.rpc('discord_bind_resource',{p_resource:{guild_id:guild,discord_id:id,resource_type:type,logical_key:key,name,parent_id:parent||null,managed_by_nexium:key===panelKey}}));
}
async function validateRole(guild:string,id:string){
 if(!snowflake(id))throw new BotError('PROTECTED_VERIFICATION_ROLE');
 const [roles,member]=await Promise.all([discord('/guilds/'+guild+'/roles'),discord('/guilds/'+guild+'/members/'+applicationId)]);
 const role=roles.find((r:any)=>r.id===id);
 const highest=Math.max(0,...roles.filter((r:any)=>member.roles.includes(r.id)).map((r:any)=>r.position));
 const unsafe=(1n<<1n)|(1n<<2n)|(1n<<3n)|(1n<<4n)|(1n<<5n)|(1n<<28n);
 if(!role||role.id===guild||role.managed||role.position>=highest||(BigInt(role.permissions||'0')&unsafe)!==0n)throw new BotError('PROTECTED_VERIFICATION_ROLE');
 return role;
}
export async function verificationSummary(db:SupabaseClient,guild:string){
 const [channel,role]=await Promise.all([mapping(db,guild,channelKey),mapping(db,guild,roleKey)]);
 return {channel:channel?.discord_id||null,role:role?.discord_id||null};
}
export async function setVerificationResource(db:SupabaseClient,input:any,user:string,key:string,id:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(key==='verification_channel_id'){
  const channel=await discord('/channels/'+id);
  if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
  await bind(db,input.guild_id,id,'channel',channelKey,safeText(channel.name,100));
 }else if(key==='verification_role_id'){
  const role=await validateRole(input.guild_id,id);
  await bind(db,input.guild_id,id,'role',roleKey,safeText(role.name,100));
 }else throw new BotError('UNSUPPORTED_ACTION');
 await audit(db,input.guild_id,actor.id,'server_verification_configured',id,{resource:key});
}
export async function publishVerificationPanel(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const [channelBinding,roleBinding,panelBinding]=await Promise.all([mapping(db,input.guild_id,channelKey),mapping(db,input.guild_id,roleKey),mapping(db,input.guild_id,panelKey)]);
 if(!channelBinding||!roleBinding)throw new BotError('VERIFICATION_CONFIG_REQUIRED');
 const channel=await discord('/channels/'+channelBinding.discord_id);
 if(channel.guild_id!==input.guild_id||![0,5].includes(channel.type))throw new BotError('WRONG_PANEL_CHANNEL');
 await validateRole(input.guild_id,roleBinding.discord_id);
 const payload={content:null,allowed_mentions:{parse:[]},embeds:[{author:{name:'NEXIUM STORE • ACESSO AO SERVIDOR'},title:'🛡️ Verificação de membro',description:'Leia as regras do servidor e toque no botão abaixo para confirmar que leu as regras e liberar seu acesso.\n\nA equipe nunca pedirá sua senha ou códigos de login.',color:0x5865f2,footer:{text:'Nexium Store • Verificação segura'}}],components:[row([button('✅ Verificar e liberar acesso','nexium:verify:start',1)])]};
 let message:any;
 if(panelBinding){
  try{
   const existing=await discord('/channels/'+channel.id+'/messages/'+panelBinding.discord_id);
   if(existing.author?.id!==applicationId)throw new BotError('PROTECTED_MESSAGE');
   message=await discord('/channels/'+channel.id+'/messages/'+panelBinding.discord_id,'PATCH',payload);
  }catch(error){
   if(!(error instanceof BotError)||error.code!=='DISCORD_RESOURCE_NOT_FOUND')throw error;
  }
 }
 if(!message)message=await discord('/channels/'+channel.id+'/messages','POST',{...payload,nonce:input.id,enforce_nonce:true});
 await bind(db,input.guild_id,message.id,'message',panelKey,'Verificação de membros',channel.id);
 await audit(db,input.guild_id,actor.id,'server_verification_panel_published',message.id,{channel_id:channel.id,role_id:roleBinding.discord_id});
 return privateMessage('Painel de verificação publicado ou atualizado em <#'+channel.id+'>. O cargo será concedido após a confirmação do membro.');
}
export async function verificationAction(db:SupabaseClient,input:any,action:string,panelId?:string){
 const channelBinding=await mapping(db,input.guild_id,channelKey);
 const roleBinding=await mapping(db,input.guild_id,roleKey);
 const panelBinding=await mapping(db,input.guild_id,panelKey);
 if(!channelBinding||!roleBinding||!panelBinding||channelBinding.discord_id!==input.channel_id)throw new BotError('VERIFICATION_PANEL_NOT_FOUND');
 if(action==='start'){
  if(input.message?.id!==panelBinding.discord_id)throw new BotError('VERIFICATION_PANEL_NOT_FOUND');
  return {...privateMessage(''),embeds:[{title:'🛡️ Confirme sua entrada',description:'Ao confirmar, você confirma que leu e aceita as regras do servidor. O bot concederá o cargo de membro verificado.',color:0x5865f2}],components:[row([button('Li e aceito as regras','nexium:verify:confirm:'+panelBinding.discord_id,3)])]};
 }
 if(action==='confirm'){
  if(panelId!==panelBinding.discord_id)throw new BotError('VERIFICATION_PANEL_NOT_FOUND');
  const id=String(input.member?.user?.id||input.user?.id||'');
  if(!snowflake(id)||id===applicationId)throw new BotError('VERIFICATION_MEMBER_INVALID');
  const role=await validateRole(input.guild_id,roleBinding.discord_id);
  const member=await discord('/guilds/'+input.guild_id+'/members/'+id);
  if(!member.roles.includes(role.id))await discord('/guilds/'+input.guild_id+'/members/'+id+'/roles/'+role.id,'PUT');
  return privateMessage('✅ Verificação concluída! Seu acesso ao servidor foi liberado.');
 }
 throw new BotError('UNSUPPORTED_ACTION');
}
