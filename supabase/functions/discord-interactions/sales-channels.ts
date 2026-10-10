import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord,audit,safeText} from './api.ts';
import {privateMessage} from './security.ts';
import {publishPanel} from './catalog.ts';

const categoryName='🛍️・nexium-vendas';
export const productChannelTopic=(productId:string)=>`Nexium Store product ${productId}`;
export function productChannelName(name:string){
 const value=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const icon=/youtube|\bytb\b/.test(value)?'📼':/netflix/.test(value)?'🍿':/hbo|\bmax\b/.test(value)?'🎬':/disney/.test(value)?'🏰':/prime video/.test(value)?'📦':/spotify/.test(value)?'🎵':/crunchyroll/.test(value)?'🍥':/globoplay/.test(value)?'📺':/paramount/.test(value)?'🎞️':/duolingo/.test(value)?'🦉':/xbox|game pass/.test(value)?'🎮':/capcut/.test(value)?'✂️':/discord|nitro|impulso/.test(value)?'💎':'📺';
 const label=name.trim().replace(/[@#:`*_~|<>\\]/g,'').replace(/\s+/g,' ').slice(0,92)||'Produto';
 return `${icon}・${label}`.slice(0,100);
}

/** Creates one public, read-only sales channel per active site product and syncs its live Discord purchase card. */
export async function createSalesChannels(db:SupabaseClient,guild:string,actorId:string,request:typeof discord=discord,publish:typeof publishPanel=publishPanel){
 const products=checked(await db.from('products').select('id,name,active').eq('active',true).order('name').limit(51)) as any[];
 if(!products.length)return privateMessage('Não há produtos ativos no site para publicar.');
 if(products.length>50)throw new BotError('SALES_CHANNEL_PRODUCT_LIMIT');

 const channels=await request(`/guilds/${guild}/channels`) as any[];
 let category=channels.find(c=>c.type===4&&c.name===categoryName);
 if(!category){
  category=await request(`/guilds/${guild}/channels`,'POST',{name:categoryName,type:4,permission_overwrites:[{id:guild,type:0,allow:'1024',deny:'2048'}]});
  if(category?.guild_id!==guild||category?.type!==4)throw new BotError('SALES_CHANNEL_CREATE_FAILED');
  channels.push(category);
 }
 const categoryChildren=channels.filter(c=>c.parent_id===category.id),inCategory=categoryChildren.filter(c=>c.type===0);
 const productTopics=new Set(products.map(p=>productChannelTopic(p.id)));
 const current=inCategory.filter(c=>productTopics.has(c.topic));
 const needed=products.filter(p=>!current.some(c=>c.topic===productChannelTopic(p.id))).length;
 if(categoryChildren.length+needed>50)throw new BotError('SALES_CHANNEL_CATEGORY_FULL');

 const published:string[]=[];
 for(const product of products){
  const topic=productChannelTopic(product.id);
  let channel=current.find(c=>c.topic===topic);
  if(!channel){
   channel=await request(`/guilds/${guild}/channels`,'POST',{name:productChannelName(product.name),type:0,parent_id:category.id,topic,permission_overwrites:[{id:guild,type:0,allow:'1024',deny:'2048'}]});
   if(channel?.guild_id!==guild||channel?.type!==0||channel?.parent_id!==category.id||channel?.topic!==topic)throw new BotError('SALES_CHANNEL_CREATE_FAILED');
   current.push(channel);
  }
  const desiredName=productChannelName(product.name);
  if(channel.name!==desiredName){
   const renamed=await request(`/channels/${channel.id}`,'PATCH',{name:desiredName});
   if(renamed?.guild_id!==guild||renamed?.id!==channel.id||renamed?.topic!==topic||renamed?.name!==desiredName)throw new BotError('SALES_CHANNEL_CREATE_FAILED');
   channel.name=renamed.name;
  }
  let panel=checked(await db.from('discord_sales_panels').select('*').eq('guild_id',guild).eq('channel_id',channel.id).eq('panel_kind','sales').eq('active',true).limit(1).maybeSingle());
  if(panel){
   panel=checked(await db.from('discord_sales_panels').update({name:product.name,product_ids:[product.id],sync_status:'pending'}).eq('id',panel.id).select('*').single());
  }else{
   panel=checked(await db.from('discord_sales_panels').insert({name:product.name,slug:`discord-product-${crypto.randomUUID()}`,guild_id:guild,channel_id:channel.id,product_ids:[product.id],panel_kind:'sales',active:true,created_by:actorId,sync_status:'pending'}).select('*').single());
  }
  await publish(db,guild,channel.id,actorId,panel.id);
  published.push(`${safeText(product.name,80)} → #${channel.name}`);
 }
 await audit(db,guild,actorId,'sales_channels_synced',category.id,{products:published.length,category:category.id});
 return privateMessage(`**Canais de venda atualizados**\nCategoria: #${category.name}\nProdutos publicados: **${published.length}**\n\n${published.slice(0,16).join('\n')}${published.length>16?`\n… e mais ${published.length-16} produto(s).`:''}\n\nOs cards usam preço, imagem, opções e disponibilidade atuais do site. Execute novamente depois de cadastrar novos produtos.`);
}
