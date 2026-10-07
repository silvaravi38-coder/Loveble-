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
import {discord,fortalezaMonthStart} from '../supabase/functions/discord-interactions/api.ts';
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

test('help lists the published commands and support month respects Fortaleza at UTC boundary',async()=>{const help=await route({}, {type:2,data:{name:'nexium',options:[{name:'ajuda'}]}},'user');assert.match(help.content,/agendar/);assert.match(help.content,/cancelar/);assert.match(help.content,/resumo/);assert(help.content.length<=2000);assert.equal(fortalezaMonthStart(new Date('2026-11-01T01:00:00Z')).toISOString(),'2026-10-01T03:00:00.000Z');});


test('ticket panel selects original Nexium subjects and unpublish removes all controls',async()=>{
 const {ticketPanel,ticketControls}=await import('../supabase/functions/discord-interactions/ticket-ui.ts');
 const panel={id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',name:'Atendimento Nexium'};
 const payload=ticketPanel(panel);assert.equal(payload.components[0].components[0].type,3);assert.deepEqual(payload.components[0].components[0].options.map(s=>s.label),['Suporte','Dúvida','Receber Produto','Vaga Staff']);assert.match(payload.embeds[0].description,/08:00 às 11:00 e 20:30 às 22:00/);assert.match(payload.embeds[0].description,/10:00 às 21:00/);assert.deepEqual(payload.allowed_mentions.parse,[]);assert.equal(ticketPanel(panel,true).components.length,0);
 const buttons=ticketControls(panel.id).flatMap(r=>r.components);assert.equal(buttons.length,4);for(const b of buttons)assert(b.custom_id.length<=100);assert(buttons.some(b=>b.custom_id.includes('ticket-save-delete')));
});
test('ticket opening skips modal and stale panels cannot create a ticket',async()=>{
 const {ticketModal,submitTicketModal,modalValues}=await import('../supabase/functions/discord-interactions/ticket-ui.ts');
 const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';let rpcCalls=0;
 const db={from(table){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:table==='discord_account_links'?{profile_id:'profile'}:{id,message_id:'1557132199227031552'},error:null}),single:async()=>({data:{id:'profile',role:'customer'},error:null})}},rpc(){rpcCalls++;throw Error('must not create')}};
 const input={type:3,guild_id:'guild',channel_id:'channel',message:{id:'1557132199227031552'},data:{custom_id:`nexium:ticket-open:${id}`,values:['payment']}};
 assert.equal(await ticketModal(db,input,'user'),null);assert.equal(rpcCalls,0);
 await assert.rejects(()=>route(db,{...input,message:{id:'other'}},'user'),e=>e.code==='PANEL_PRODUCT_MISMATCH');
 const submit={...input,type:5,data:{custom_id:`nexium:ticket-new:${id}:payment:other`,components:[{type:18,component:{custom_id:'reason',value:'Ajuda no pagamento'}}]}};
 await assert.rejects(()=>submitTicketModal(db,submit,'user'),e=>e.code==='PANEL_PRODUCT_MISMATCH');assert.equal(rpcCalls,0);
 assert.deepEqual(modalValues({data:{components:[{type:18,component:{custom_id:'outcome',values:['resolved']}}]}}),{outcome:'resolved'});
});
test('customer cannot open staff finalization form and form audit never stores reason',async()=>{
 const {ticketModal}=await import('../supabase/functions/discord-interactions/ticket-ui.ts');const db=actorDb('customer');db.rpc=async()=>({data:{ticket:{status:'open',user_id:'profile'},discord:{channel_id:'channel'}},error:null});
 await assert.rejects(()=>ticketModal(db,{type:3,guild_id:'guild',channel_id:'channel',data:{custom_id:'nexium:ticket-close:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}},'user'),e=>e.code==='CLAIM_REQUIRED');
 assert.equal(eventAction({type:5,data:{custom_id:'nexium:ticket-finish:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',components:[{value:'PRIVATE'}]}}),'nexium:ticket-finish');
});

test('ticket card shows real client/staff metadata and closed controls cannot claim again',async()=>{
 const {ticketCard}=await import('../supabase/functions/discord-interactions/ticket-card.ts');
 const card=ticketCard('ticket-id',{id:'ticket-id',status:'open',subject:'Ajuda no acesso',created_at:'2026-10-06T23:21:00Z',priority:'normal',order_id:null},{id:'client',username:'cliente',avatar:null},{full_name:'Atendente'},'role');
 assert.match(card.embeds[0].fields.find(f=>f.name==='ℹ️ | Informações').value,/Assumido:.*Atendente/);assert.match(card.embeds[0].description,/<@client>/);assert.deepEqual(card.allowed_mentions.parse,[]);assert(card.components.length<=5);
 const closed=ticketCard('ticket-id',{status:'resolved',subject:'Ajuda',created_at:'2026-10-06T23:21:00Z',priority:'normal'},{id:'client'},null);assert(!closed.components.flatMap(r=>r.components).some(b=>b.custom_id.includes('ticket-claim')));
});
test('deletion requires closed bot-created ticket and permission drift changes preview fingerprint',async()=>{
 const {requireDeletableTicket,channelFingerprint}=await import('../supabase/functions/discord-interactions/ticket-actions.ts');
 const view={ticket:{id:'id',status:'resolved'},discord:{closed_at:'date',channel_id:'channel',channel_state:'ready'}};
 const channel={id:'channel',guild_id:'guild',type:0,topic:'Nexium ticket id',permission_overwrites:[{id:'a',allow:'0',deny:'1024'}]};
 assert.doesNotThrow(()=>requireDeletableTicket(view,channel,'guild'));
 assert.throws(()=>requireDeletableTicket({...view,discord:{...view.discord,closed_at:null}},channel,'guild'),e=>e.code==='TICKET_CLOSE_BEFORE_DELETE');
 assert.throws(()=>requireDeletableTicket(view,{...channel,topic:'Another bot ticket'},'guild'),e=>e.code==='PROTECTED_TICKET_CHANNEL');
 assert.throws(()=>requireDeletableTicket(view,{...channel,guild_id:'other'},'guild'),e=>e.code==='PROTECTED_TICKET_CHANNEL');
 assert.notEqual(channelFingerprint(channel),channelFingerprint({...channel,permission_overwrites:[]}));
});
test('staff cannot create a PIX for themselves from another customer ticket',async()=>{
 const {ticketActionButton}=await import('../supabase/functions/discord-interactions/ticket-actions.ts');const db=actorDb('admin');db.rpc=async()=>({data:{ticket:{user_id:'customer',order_id:'order'},discord:{channel_id:'channel'}},error:null});
 await assert.rejects(()=>ticketActionButton(db,{guild_id:'guild',channel_id:'channel'},'staff','ticket-payment','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),e=>e.code==='TICKET_PAYMENT_OWNER_REQUIRED');
 const denied=actorDb('customer');denied.rpc=db.rpc;await assert.rejects(()=>ticketActionButton(denied,{guild_id:'guild',channel_id:'channel'},'customer','ticket-staff','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),e=>e.code==='FORBIDDEN');
});

test('repeated ticket opening returns the existing channel without a Discord mutation',async()=>{
 const {openTicket}=await import('../supabase/functions/discord-interactions/tickets.ts');
 const db=actorDb('customer');let rpcCalls=0;db.rpc=async()=>{rpcCalls++;return {data:{reused:true,channel_id:'123',ticket_id:'ticket'},error:null};};
 const message=await openTicket(db,{guild_id:'guild',id:'interaction'},'user','Pagamento PIX');
 assert.equal(rpcCalls,1);assert.match(message.content,/<#123>/);assert.equal(message.components[0].components[0].url,'https://discord.com/channels/guild/123');
});

test('deleted panel messages recover only after a confirmed 404; unpublishing does not recreate them',async()=>{
 const {publishPanelMessage}=await import('../supabase/functions/discord-interactions/catalog.ts');
 const {BotError}=await import('../supabase/functions/discord-interactions/api.ts');
 const panel={id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',channel_id:'channel',message_id:'deleted'};const calls=[];
 const request=async(path,method='GET',payload)=>{calls.push(method);if(method==='GET')throw new BotError('DISCORD_RESOURCE_NOT_FOUND');assert.equal(payload.enforce_nonce,true);return {id:'replacement'};};
 assert.equal((await publishPanelMessage(panel,{},false,request)).id,'replacement');assert.deepEqual(calls,['GET','POST']);calls.length=0;
 assert.equal(await publishPanelMessage(panel,{},true,request),null);assert.deepEqual(calls,['GET']);
 await assert.rejects(()=>publishPanelMessage(panel,{},false,async()=>{throw new BotError('DISCORD_NETWORK')}),e=>e.code==='DISCORD_NETWORK');
});
test('ticket menu uses available local server emojis and never foreign or restricted IDs',async()=>{
 const {ticketPanel}=await import('../supabase/functions/discord-interactions/ticket-ui.ts');
 const emojis=['suporte','info','package1','55609admingreenCopia','alliancearrows4'].map((name,i)=>({name,id:String(i+1),available:true,roles:[],animated:name==='alliancearrows4'}));
 const panel=ticketPanel({id:'panel'},false,emojis);const options=panel.components[0].components[0].options;
 assert.deepEqual(options.map(o=>o.emoji.id),['1','2','3','4']);assert.match(panel.embeds[0].description,/<a:alliancearrows4:5>/);assert(!JSON.stringify(panel).includes('1434217902927646913'));
 const restricted=ticketPanel({id:'panel'},false,[{name:'suporte',id:'blocked',roles:['role'],available:true}]);assert(!JSON.stringify(restricted).includes('blocked'));
});
test('ticket panel selector protects staff tools and member controls belong to ticket owner',async()=>{
 const {ticketActionButton}=await import('../supabase/functions/discord-interactions/ticket-actions.ts');
 const db=actorDb('customer');db.rpc=async()=>({data:{ticket:{user_id:'profile',status:'open'},discord:{channel_id:'channel'}},error:null});
 const input={guild_id:'guild',channel_id:'channel',data:{values:['staff']}};
 await assert.rejects(()=>ticketActionButton(db,input,'user','ticket-panels','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),e=>e.code==='FORBIDDEN');
 const panel=await ticketActionButton(db,{...input,data:{values:['member']}},'user','ticket-panels','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');assert.match(panel.content,/Painel Membro/);assert.equal(panel.components.length,2);
 db.rpc=async()=>({data:{ticket:{user_id:'other',status:'open'},discord:{channel_id:'channel'}},error:null});
 await assert.rejects(()=>ticketActionButton(db,{...input,data:{values:['member']}},'user','ticket-panels','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),e=>e.code==='FORBIDDEN');
});
