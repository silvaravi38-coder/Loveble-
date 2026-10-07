import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {BotError,checked,discord} from '../discord-interactions/api.ts';
import {publishPanel} from '../discord-interactions/catalog.ts';
const key=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
export const streamingAliases:Record<string,string[]>={netflix:['netflix','n3tefl1x'],spotifypremium:['spotify','spotifypremium'],youtubepremium:['youtube','youtubepremium','y0utub3'],crunchyroll:['crunchyroll'],disney:['disney','disneyplus'],globoplay:['globoplay'],hbomax:['hbomax','max'],paramount:['paramount','paramountplus'],primevideo:['primevideo','amazonprime']};
export function streamingTargets(products:any[],channels:any[]){
 return products.flatMap(p=>{const aliases=streamingAliases[key(p.name)];if(!aliases)return [];const matches=channels.filter(c=>c.type===0&&aliases.includes(key(c.name)));if(matches.length>1)throw new BotError('AMBIGUOUS_STREAMING_CHANNEL');return [{product:p,channel:matches[0],name:aliases[0]}];});
}
export async function syncStreaming(db:SupabaseClient,guild:string,actor:string){
 const channels=await discord(`/guilds/${guild}/channels`) as any[];
 const categories=channels.filter(c=>c.type===4&&key(c.name)==='assinaturas');
 if(categories.length!==1)throw new BotError('STREAMING_CATEGORY_REQUIRED');
 const products=checked(await db.from('products').select('id,name').eq('active',true).order('name')) as any[];
 const targets=streamingTargets(products,channels),results=[];
 for(const target of targets){
  let channel=target.channel;
  if(!channel)channel=await discord(`/guilds/${guild}/channels`,'POST',{name:`📺・${target.name}`,type:0,parent_id:categories[0].id});
  // Reuse the durable panel row and message ID on every subsequent synchronization.
  const slug=`streaming-${target.product.id}`;
  let panel=checked(await db.from('discord_sales_panels').select('*').eq('guild_id',guild).eq('slug',slug).maybeSingle());
  if(panel&&panel.channel_id!==channel.id)throw new BotError('STREAMING_CHANNEL_CHANGED_REVIEW');
  if(!panel)panel=checked(await db.from('discord_sales_panels').insert({name:target.product.name,slug,guild_id:guild,channel_id:channel.id,product_ids:[target.product.id],panel_kind:'sales',active:true,created_by:actor,sync_status:'pending'}).select('*').single());
  await publishPanel(db,guild,channel.id,actor,panel.id);
  const saved=checked(await db.from('discord_sales_panels').select('message_id').eq('id',panel.id).single());
  const message=await discord(`/channels/${channel.id}/messages/${saved.message_id}`);
  if(!message.embeds?.[0]?.image||!message.components?.length)throw new BotError('STREAMING_PANEL_VERIFY_FAILED');
  results.push({product:target.product.name,channel_id:channel.id,panel_id:panel.id,message_id:saved.message_id,created_channel:!target.channel});
 }
 const indexes=channels.filter(c=>c.type===0&&key(c.name)==='streamings');
 if(indexes.length>1)throw new BotError('AMBIGUOUS_STREAMING_CHANNEL');
 let indexMessage;
 if(indexes.length&&targets.length){
  const channel=indexes[0],slug='streaming-index';
  let panel=checked(await db.from('discord_sales_panels').select('*').eq('guild_id',guild).eq('slug',slug).maybeSingle());
  const data={name:'📺 Streamings Nexium',product_ids:targets.map(t=>t.product.id)};
  if(!panel)panel=checked(await db.from('discord_sales_panels').insert({...data,slug,guild_id:guild,channel_id:channel.id,panel_kind:'sales',active:true,created_by:actor,sync_status:'pending'}).select('*').single());
  else {if(panel.channel_id!==channel.id)throw new BotError('STREAMING_CHANNEL_CHANGED_REVIEW');checked(await db.from('discord_sales_panels').update(data).eq('id',panel.id));}
  await publishPanel(db,guild,channel.id,actor,panel.id);
  indexMessage=checked(await db.from('discord_sales_panels').select('message_id').eq('id',panel.id).single());
 }
 return {panels:results,index:indexMessage};
}
