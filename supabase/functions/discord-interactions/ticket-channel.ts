import {BotError,discord,safeText} from './api.ts';
import {ticketChannelName} from './ticket-lifecycle.ts';
export const ticketBotId='1557132199227031552';
export function isTicketChannel(channel:any,guild:string,ticket:string,expectedId?:string){
 if(channel.guild_id!==guild||(expectedId&&channel.id!==expectedId))return false;
 return channel.type===0?channel.topic===`Nexium ticket ${ticket}`:channel.type===12&&channel.owner_id===ticketBotId&&typeof channel.parent_id==='string'&&String(channel.name).endsWith('-'+ticket.slice(0,8));
}
export function parentThreadOverwrite(parent:any,user:string){
 const current=parent.permission_overwrites?.find((o:any)=>o.id===user&&Number(o.type)===1);
 const access=1024n|65536n|(1n<<38n),allow=BigInt(current?.allow||'0'),deny=BigInt(current?.deny||'0');
 if((allow&access)===access&&(deny&access)===0n)return null;
 return {type:1,allow:String(allow|access),deny:String(deny&~access)};
}
export async function threadMemberAccess(channel:any,user:string,remove=false,request:typeof discord=discord){
 if(channel.type!==12)throw new BotError('PROTECTED_TICKET_CHANNEL');
 if(channel.thread_metadata?.archived)await request(`/channels/${channel.id}`,'PATCH',{archived:false});
 if(!remove){const parent=await request(`/channels/${channel.parent_id}`);if(parent.guild_id!==channel.guild_id||parent.type!==0)throw new BotError('INVALID_TICKET_PARENT');const overwrite=parentThreadOverwrite(parent,user);if(overwrite)await request(`/channels/${parent.id}/permissions/${user}`,'PUT',overwrite);}
 await request(`/channels/${channel.id}/thread-members/${user}`,remove?'DELETE':'PUT');
}
export async function createPrivateTicketThread(parent:any,guild:string,ticket:string,reason:string,owner:any,request:typeof discord=discord){
 if(parent.guild_id!==guild||parent.type!==0)throw new BotError('INVALID_TICKET_PARENT');
 const sector=ticketChannelName(reason,ticket).replace(/-[a-f0-9]{8}$/,'').slice(0,40),name=safeText(owner.username||owner.global_name||'cliente',25).replace(/\s+/g,'-');
 const channel=await request(`/channels/${parent.id}/threads`,'POST',{name:`${sector}-${name}-${ticket.slice(0,8)}`,type:12,invitable:false,auto_archive_duration:1440});
 // Return the new ID before invitation; caller persists it to prevent uncertain creation from duplicating tickets.
 if(!isTicketChannel(channel,guild,ticket,channel.id)||channel.parent_id!==parent.id)throw new BotError('PROTECTED_TICKET_CHANNEL');
 return channel;
}
