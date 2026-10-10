const productEmojis: Array<{emoji:string; terms:string[]}> = [
  {emoji:'📼',terms:['youtube']},
  {emoji:'🎬',terms:['netflix']},
  {emoji:'📺',terms:['prime video','amazon prime']},
  {emoji:'🍿',terms:['hbo','max','disney']},
  {emoji:'🎵',terms:['spotify','deezer','apple music']},
  {emoji:'💎',terms:['discord nitro','nitro']},
  {emoji:'🦉',terms:['duolingo']},
  {emoji:'✂️',terms:['capcut']},
];

function productEmoji(name:string):string {
  const normalized=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  return productEmojis.find(({terms})=>terms.some(term=>term==='max'?/(^| )max($| )/.test(normalized):normalized.includes(term)))?.emoji||'📦';
}

/** Discord sales channels use a readable emoji label, for example "📼・YouTube". */
export function productChannelName(name:string,_productId?:string):string {
  const title=String(name||'Produto')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g,' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu,'')
    .replace(/[@#:/\\]/g,' ')
    .replace(/\s+/g,' ')
    .trim()||'Produto';
  const prefix=`${productEmoji(title)}・`;
  const maxTitleLength=100-Array.from(prefix).length;
  return `${prefix}${Array.from(title).slice(0,maxTitleLength).join('').trim()}`;
}

export function salesChannelPlan(productName:string,current?:{id:string;name:string}):
  {action:'create';name:string}|{action:'rename';id:string;name:string}|{action:'keep';id:string;name:string} {
  const name=productChannelName(productName);
  if(!current)return {action:'create',name};
  if(current.name!==name)return {action:'rename',id:current.id,name};
  return {action:'keep',id:current.id,name};
}
