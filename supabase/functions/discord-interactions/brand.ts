export const nexiumBrand={
 accent:0x3498db,
 muted:0x747f8d,
 success:0x2ecc71,
 banner:'https://flcqndjlzuhmxxahjudj.supabase.co/storage/v1/object/public/product-images/discord/nexium-atendimento.png',
 footer:'Nexium Store • Seu universo digital em um só lugar',
};

const sectionDivider={name:'━━━━━━━━━━━━━━━━━━━━',value:'\u200b',inline:false};
export function styleNexiumMessagePayload(message:any){
 if(!message||typeof message!=='object'||!Array.isArray(message.embeds)||!message.embeds.length)return message;
 const embeds=message.embeds.map((source:any)=>{
  const embed={...source};
  if(Array.isArray(embed.fields)&&embed.fields.length){
   const fields:any[]=[];
   const isDivider=(field:any)=>field?.name===sectionDivider.name;
   if(embed.description&&!isDivider(embed.fields[0]))fields.push(sectionDivider);
   embed.fields.forEach((field:any,index:number)=>{
    if(index>0&&!embed.fields[index-1]?.inline&&!field.inline&&!isDivider(embed.fields[index-1])&&!isDivider(field))fields.push(sectionDivider);
    fields.push(field);
   });
   embed.fields=fields.length<=25?fields:embed.fields;
  }
  return {
   ...embed,
   author:{name:'NEXIUM STORE',...(embed.author||{})},
   color:embed.color??0x5865f2,
   footer:{text:'NEXIUM STORE • Seu universo digital em um só lugar',...(embed.footer||{})},
   timestamp:embed.timestamp||new Date().toISOString(),
  };
 });
 return {...message,embeds};
}
