export const nexiumBrand={
 accent:0x6c5ce7,
 muted:0x747f8d,
 success:0x2ecc71,
 banner:'https://flcqndjlzuhmxxahjudj.supabase.co/storage/v1/object/public/product-images/discord/nexium-atendimento.png',
 footer:'NEXIUM STORE • Seu universo digital em um só lugar',
};

const plainText=(value:string)=>value.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();
function iconFor(value:string){
 const text=plainText(value);
 if(/erro|falha|invalid|indispon|esgotad|cancelad|negad/.test(text))return '⚠️';
 if(/pagamento|pagou|pix|compra|compr/.test(text))return '💳';
 if(/pedido|entrega|estoque|produto|catalog/.test(text))return '📦';
 if(/ticket|atendimento|suporte/.test(text))return '🎧';
 if(/cupom|desconto/.test(text))return '🎟️';
 if(/moder|seguranca|verific|bloque/.test(text))return '🛡️';
 if(/sucesso|confirmad|entregue|publicad|criad|ativad/.test(text))return '✅';
 return '✨';
}
function colorFor(value:string){
 const text=plainText(value);
 if(/erro|falha|invalid|indispon|esgotad|cancelad|negad/.test(text))return 0xe74c3c;
 if(/pendente|aguardando|solicitad|atencao|aviso/.test(text))return 0xf1c40f;
 if(/sucesso|confirmad|pago|entregue|publicad|criad|ativad/.test(text))return 0x2ecc71;
 return nexiumBrand.accent;
}
function splitField(name:string,value:string){
 const chunks:string[]=[];
 for(let i=0;i<value.length;i+=1000)chunks.push(value.slice(i,i+1000));
 return chunks.slice(0,10).map((chunk,index)=>({name:(index?name+' • continuação':name).slice(0,256),value:chunk||'\\u200b',inline:false}));
}
function contentEmbed(content:string){
 const clean=content.replace(/\\r/g,'').trim();
 const lines=clean.split('\\n');
 const first=(lines.shift()||'').trim();
 const titleText=first.replace(/^#{1,6}\\s*/,'').replace(/\\*\\*/g,'').trim()||'Nexium Store';
 const hasEmoji=/\\p{Extended_Pictographic}/u.test(titleText);
 const title=(hasEmoji?titleText:`${iconFor(titleText)} ${titleText}`).slice(0,256);
 const body=lines.join('\\n').trim();
 const embed:any={title,color:colorFor(clean)};
 if(!body)return embed;
 const paragraphs=body.split(/\\n\\s*\\n/).map(part=>part.trim()).filter(Boolean);
 const description:string[]=[];
 const fields:any[]=[];
 for(const paragraph of paragraphs){
  const partLines=paragraph.split('\\n').map(line=>line.trim()).filter(Boolean);
  const heading=partLines[0]?.match(/^\\*\\*(.{2,70})\\*\\*:?$/);
  const isBullets=partLines.length>1&&partLines.every(line=>/^(?:[-•›✅❌⚠️📌]\\s*)/.test(line));
  const keyValues=partLines.length>1&&partLines.every(line=>/^[^:]{2,48}:\\s*.+$/.test(line));
  if(heading){
   const value=partLines.slice(1).join('\\n')||partLines[0].replace(/\\*/g,'');
   fields.push(...splitField(`${iconFor(heading[1])} ${heading[1]}`,value));
  }else if(isBullets){
   fields.push(...splitField('📋 Detalhes',paragraph));
  }else if(keyValues){
   for(const line of partLines){
    const split=line.indexOf(':');
    const label=line.slice(0,split).trim(),value=line.slice(split+1).trim();
    fields.push(...splitField(`${iconFor(label)} ${label}`,value));
   }
  }else if(partLines.length>1){
   fields.push(...splitField('📋 Detalhes',paragraph));
  }else if(!description.length){
   description.push(paragraph);
  }else{
   fields.push(...splitField('📌 Mais informações',paragraph));
  }
 }
 if(description.length)embed.description=description.join('\\n').slice(0,4096);
 if(fields.length)embed.fields=fields.slice(0,25);
 return embed;
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
