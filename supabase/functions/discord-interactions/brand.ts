export const nexiumBrand={
 accent:0x6c5ce7,
 muted:0x747f8d,
 success:0x2ecc71,
 banner:'https://flcqndjlzuhmxxahjudj.supabase.co/storage/v1/object/public/product-images/discord/nexium-atendimento.png',
 footer:'NEXIUM STORE • Seu universo digital em um só lugar',
};

function contentEmbed(content:string){
 const clean=content.trim();
 const lines=clean.split(/\r?\n/);
 const first=lines[0]?.trim()||'';
 const rest=lines.slice(1).join('\n').trim();
 if(first&&rest&&first.length<=100){
  return {title:first,description:rest};
 }
 return {title:'✨ Nexium Store',description:clean};
}

export function styleNexiumMessagePayload(message:any){
 if(!message||typeof message!=='object')return message;
 let payload=message;
 if((!Array.isArray(payload.embeds)||!payload.embeds.length)&&typeof payload.content==='string'&&payload.content.trim()){
  payload={...payload,content:null,embeds:[contentEmbed(payload.content)]};
 }
 if(!Array.isArray(payload.embeds)||!payload.embeds.length)return payload;
 const embeds=payload.embeds.map((source:any)=>{
  const embed={...source};
  return {
   ...embed,
   author:{name:'NEXIUM STORE • SISTEMA',...(embed.author||{})},
   color:embed.color??nexiumBrand.accent,
   footer:{text:nexiumBrand.footer,...(embed.footer||{})},
   timestamp:embed.timestamp||new Date().toISOString(),
  };
 });
 return {...payload,embeds};
}
