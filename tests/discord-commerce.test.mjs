import test from 'node:test';
import assert from 'node:assert/strict';
import {nexiumCommands} from '../supabase/functions/discord-executor/commands.ts';
import {webhookProof,sanitiseCharge,pixResponse,startPurchase} from '../supabase/functions/discord-interactions/payments.ts';
import {deliverResponse,qrAttachment} from '../supabase/functions/discord-interactions/delivery.ts';
import {route,eventAction} from '../supabase/functions/discord-interactions/router.ts';
import {restockUnits,restockModal} from '../supabase/functions/discord-interactions/restock.ts';
import {lockOverwrites,canonicalOverwrites} from '../supabase/functions/discord-interactions/moderation.ts';
import {authorisedOrderContext} from '../supabase/functions/discord-interactions/ai.ts';
import {scheduledDate} from '../supabase/functions/discord-interactions/schedules.ts';
import {sendScheduled} from '../supabase/functions/discord-scheduler/worker.ts';
import {discord} from '../supabase/functions/discord-interactions/api.ts';
test('Discord manifest conforms to command limits and keeps mandatory options before optional',()=>{
 const names=new Set();let count=0;
 for(const c of nexiumCommands){assert(!names.has(c.name));names.add(c.name);assert(c.options.length<=25);for(const s of c.options){count++;assert.match(s.name,/^[a-z0-9-]{1,32}$/);assert(s.description.length<=100);assert(s.options.length<=25);let optional=false;for(const o of s.options){if(o.required)assert.equal(optional,false,`${s.name}:${o.name}`);else optional=true;}}}
 assert.equal(count,48);assert.equal(nexiumCommands.find(c=>c.name==='nexium-admin').default_member_permissions,'32');
});
test('callback proof is tied to order and secret, provider payload strips confidential fields',async()=>{
 const first=await webhookProof('order1','secret1');assert.match(first,/^[a-f0-9]{64}$/);
 assert.notEqual(first,await webhookProof('order2','secret1'));assert.notEqual(first,await webhookProof('order1','secret2'));
 const payload=sanitiseCharge({id:'charge',status:'PAID',amountCents:100,webhook_secret:'PRIVATE',webhook_url:'PRIVATE',payer:{document:'PRIVATE'},pix:{copyPaste:'pix',qrCode:'qr',expiresAt:'date',secret:'PRIVATE'}});
 assert.equal(JSON.stringify(payload).includes('PRIVATE'),false);assert.equal(payload.amountCents,100);
});
test('PIX attachment accepts PNG and keeps private response with mentions suppressed',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXcAAAAASUVORK5CYII=';
 assert.equal(qrAttachment('invalid text'),null);assert.equal(qrAttachment(btoa('<script>')),null);
 const message=pixResponse('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',{pix_copy_paste:'000201pix',qr_code_url:`data:image/png;base64,${png}`,amount:1});
 assert.deepEqual(message.allowed_mentions.parse,[]);assert.equal(message.embeds[0].image.url,'attachment://pix.png');
 let request;await deliverResponse('https://example.invalid',message,async(url,options)=>{request=options;return new Response('{}');});
 assert(request.body instanceof FormData);const data=JSON.parse(request.body.get('payload_json'));assert(!('files' in data));assert.equal(data.attachments[0].filename,'pix.png');assert.equal(request.body.get('files[0]').type,'image/png');
});
function actorDb(role){return {from(table){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{profile_id:'profile'},error:null}),single:async()=>({data:{id:'profile',role,full_name:'User'},error:null})};}};}
test('Discord administrator permission alone never elevates a customer profile',async()=>{
 await assert.rejects(()=>route(actorDb('customer'),{type:2,data:{name:'nexium-admin',options:[{name:'estoque'}]}},'discord-user'),e=>e.code==='FORBIDDEN');
});
test('audit action never persists command parameters, private keys or message contents',()=>{
 assert.equal(eventAction({type:2,data:{name:'ticket',options:[{name:'mensagem',options:[{name:'texto',value:'PRIVATE'}]}]}}),'ticket:mensagem');
 assert.equal(eventAction({type:3,data:{custom_id:'nexium:buy:SECRET'}}),'nexium:buy');
});
test('Discord uncertain mutation is not retried automatically',async()=>{
 const priorFetch=globalThis.fetch,priorDeno=globalThis.Deno;let calls=0;
 globalThis.Deno={env:{get:()=> 'test-token'}};globalThis.fetch=async()=>{calls++;throw new Error('timeout');};
 try{await assert.rejects(()=>discord('/guilds/test/channels','POST',{}),e=>e.code==='MUTATION_UNCERTAIN');assert.equal(calls,1);}finally{globalThis.fetch=priorFetch;globalThis.Deno=priorDeno;}
});

test('restock rejects duplicate/empty/excessive keys and customer cannot open secret form',async()=>{assert.throws(()=>restockUnits(''),e=>e.code==='INVALID_STOCK');assert.throws(()=>restockUnits('key\nkey'),e=>e.code==='INVALID_STOCK');assert.throws(()=>restockUnits(Array.from({length:51},(_,i)=>'key'+i).join('\n')),e=>e.code==='INVALID_STOCK');assert.deepEqual(restockUnits('key1\r\nkey2'),['key1','key2']);await assert.rejects(()=>restockModal(actorDb('customer'),{type:2,data:{name:'nexium-admin',options:[{name:'restock',options:[{name:'produto',value:'Netflix'}]}]}},'discord-user'),e=>e.code==='FORBIDDEN');});

test('channel lock preserves view access/staff sending and canonical restore detects external edits',()=>{const original=[{id:'guild',type:0,allow:'1024',deny:'0'},{id:'member',type:0,allow:'3072',deny:'0'},{id:'staff',type:0,allow:'3072',deny:'0'}];const saved=JSON.stringify(original),planned=lockOverwrites(original,'guild',['staff']);assert.equal(JSON.stringify(original),saved);assert.equal(BigInt(planned[0].allow)&1024n,1024n);assert.equal(BigInt(planned[1].allow)&2048n,0n);assert.equal(BigInt(planned[1].deny)&2048n,2048n);assert.deepEqual(planned[2],original[2]);assert.equal(canonicalOverwrites(planned),canonicalOverwrites([...planned].reverse()));assert.notEqual(canonicalOverwrites(planned),canonicalOverwrites(original));});

test('AI order context enforces ticket customer ownership and strips payment/delivery secrets',()=>{const order={id:'order',user_id:'owner',status:'pending',created_at:'date',delivery_text:'SECRET',customer_email:'SECRET'};assert.equal(authorisedOrderContext(order,[],'attacker'),null);const context=authorisedOrderContext(order,[{product_name:'Produto',quantity:1,secret_content:'SECRET'}],'owner');assert.equal(context.status,'pending');assert.equal(JSON.stringify(context).includes('SECRET'),false);});

test('schedules require a timezone and uncertain message sends are not retried',async()=>{assert.throws(()=>scheduledDate('2026-10-08T12:00'),e=>e.code==='SCHEDULE_DATE_REQUIRED');assert.throws(()=>scheduledDate('2026-01-01T12:00:00-03:00'),e=>e.code==='SCHEDULE_DATE_REQUIRED');let updates=[],calls=0;const db={from(table){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{role:'admin'},error:null}),update(value){updates.push(value);return this;},then(resolve){return Promise.resolve({data:null,error:null}).then(resolve)}}}};await sendScheduled(db,{id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',requested_by:'admin',guild_id:'guild',channel_id:'channel',attempts:1,content:'hello',scheduled_at:'date'},async(path,method)=>{calls++;if(method==='POST'){const {BotError}=await import('../supabase/functions/discord-interactions/api.ts');throw new BotError('MUTATION_UNCERTAIN');}return {guild_id:'guild',type:0}});assert.equal(calls,2);assert.equal(updates[0].status,'uncertain');});

test('empty automatic inventory prevents provider charge even with configured credentials',async()=>{
 const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;let calls=0;
 globalThis.Deno={env:{get:()=> 'test-credential'}};globalThis.fetch=async()=>{calls++;throw Error('provider must not be called')};
 const db={from(){return{select(){return this},eq(){return this},maybeSingle:async()=>({data:{pix_enabled:true,pix_provider:'turbofypay'},error:null})}},rpc:async()=>({data:null,error:{message:'OUT_OF_STOCK'}})};
 try{await assert.rejects(()=>startPurchase(db,{id:'interaction',guild_id:'guild',channel_id:'channel'},'customer','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),e=>e.code==='OUT_OF_STOCK');assert.equal(calls,0);}finally{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;}
});
