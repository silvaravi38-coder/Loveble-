import {discordGet,discordCreateMessage,discordUpdateMessage,ExecutorError} from './discord.ts';

// Recover an accepted message after a failed DB write before attempting another POST.
export async function syncInformationMessage(channelId:string,messageId:string|undefined,payload:any,logicalKey:string,botId:string,token:string,fetcher:typeof fetch=fetch){
  if(messageId){
    const updated=await discordUpdateMessage(channelId,messageId,payload,token,fetcher);
    if(updated)return updated;
  }
  const matches:any[]=[];let before:string|undefined;let complete=false;
  for(let page=0;page<10;page++){
    const batch=await discordGet(`/channels/${channelId}/messages?limit=100${before?`&before=${before}`:''}`,token,async()=>{},fetcher);
    matches.push(...batch.filter((m:any)=>m.author?.id===botId&&m.embeds?.some((e:any)=>e.title===payload.embeds[0].title)));
    if(batch.length<100){complete=true;break;}
    before=batch[batch.length-1].id;
  }
  if(matches.length>1)throw new ExecutorError('PANEL_DUPLICATES_REVIEW',409);
  if(!complete)throw new ExecutorError('PANEL_HISTORY_REVIEW_REQUIRED',409);
  if(matches.length===1)return discordUpdateMessage(channelId,matches[0].id,payload,token,fetcher);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${channelId}:${logicalKey}`));
  const nonce=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
  return discordCreateMessage(channelId,{...payload,nonce,enforce_nonce:true},token,fetcher);
}
