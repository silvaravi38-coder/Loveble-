import test from 'node:test';import assert from 'node:assert/strict';
import {manualDeliveryCard,manualDeliveryAction} from '../supabase/functions/discord-interactions/manual-delivery.ts';
import {sendNotification} from '../supabase/functions/discord-scheduler/notifications.ts';
const id='12345678-1234-4123-8123-123456789012';
test('manual delivery card uses payment time for deadline, limits untrusted text and suppresses mentions',()=>{
 const card=manualDeliveryCard({order_id:id,customer_id:'123456789012345678',paid_at:'2026-10-09T00:00:00Z',items:[{name:'@everyone `Netflix`',quantity:2}],stage:'deadline'},Date.parse('2026-10-09T11:00:00Z'));
 assert.match(card.embeds[0].title,/atraso/);assert.match(card.embeds[0].description,/× 2/);assert(!card.embeds[0].description.includes('@everyone'));assert.deepEqual(card.allowed_mentions.parse,[]);assert.equal(card.components[0].components[0].custom_id,'nexium:manual-delivery:'+id);
});
test('customer cannot confirm manual delivery and cross-guild order is rejected before RPC',async()=>{
 let rpc=0;const db={from(table){return{select(){return this},eq(){return this},maybeSingle:async()=>({data:table==='discord_account_links'?{profile_id:'actor'}:null,error:null}),single:async()=>({data:{id:'actor',role:'customer'},error:null})}},rpc(){rpc++;}};
 await assert.rejects(()=>manualDeliveryAction(db,{guild_id:'guild'},'user',id,true),e=>e.code==='FORBIDDEN');assert.equal(rpc,0);
});
test('delivery alerts never post customer details to a public channel',async()=>{
 const updates=[];const db={from(){return{update(v){updates.push(v);return this},eq:async()=>({error:null})}}};const calls=[];
 await sendNotification(db,{id,kind:'log',channel_id:'channel',guild_id:'guild',attempts:1,payload:{type:'manual_delivery'}},async(path,method)=>{calls.push(method||'GET');return{guild_id:'guild',type:0,permission_overwrites:[]}});
 assert.deepEqual(calls,['GET']);assert.equal(updates[0].error_code,'PRIVATE_DELIVERY_CHANNEL_REQUIRED');
});
