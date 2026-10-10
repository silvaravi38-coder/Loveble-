import {sendWithRetry} from './delivery-retry.js';
export type PrivateFile={name:string;content:Uint8Array|string;type:string};
export async function deliverResponse(url:string,message:any,send:typeof fetch=fetch) {
 const {files,afterDelivery,...payload}=message;
 if(!files?.length)return sendWithRetry(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},send,{timeoutMs:8000});
 const form=new FormData();payload.attachments=files.map((file:PrivateFile,id:number)=>({id,filename:file.name}));
 form.set('payload_json',JSON.stringify(payload));
 files.forEach((file:PrivateFile,id:number)=>form.set(`files[${id}]`,new Blob([typeof file.content==='string'?file.content:new Uint8Array(file.content)],{type:file.type}),file.name));
 return sendWithRetry(url,{method:'PATCH',body:form},send,{timeoutMs:10000});
}
export function qrAttachment(value:string):PrivateFile|null {
 const raw=value.replace(/^data:image\/png;base64,/,'');
 if(raw.length>1400000||!raw||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))return null;
 try{const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
 const signature=[137,80,78,71,13,10,26,10];if(!signature.every((b,i)=>bytes[i]===b))return null;
 return {name:'pix.png',content:bytes,type:'image/png'};}catch{return null;}
}

// Channel cleanup must run only after Discord accepts the confirmation.
export async function deliverAndComplete(url:string,message:any,send:typeof fetch=fetch){
 const response=await deliverResponse(url,message,send);
 if(!response.ok)return {delivered:false,cleanupFailed:false};
 try{await message.afterDelivery?.();return {delivered:true,cleanupFailed:false};}
 catch{return {delivered:true,cleanupFailed:true};}
}
