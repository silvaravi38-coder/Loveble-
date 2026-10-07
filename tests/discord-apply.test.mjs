import test from 'node:test';
import assert from 'node:assert/strict';
import {requireCreatePlan,createPayload,discordCreate,discordMove,structureFingerprint} from '../supabase/functions/discord-executor/apply.ts';
const snapshot={guild:{id:'guild',name:'Nexium'},channels:[{id:'cat',name:'SUPORTE',type:4,permission_overwrites:[]}],roles:[{id:'client',name:'Cliente',position:1,permissions:'0'}]};
const plan={strategy:'missing',config_updated_at:'v1',operations:[{key:'role:cliente',name:'Cliente',kind:'role',action:'reuse',discord_id:'client'},{key:'category:equipe',name:'EQUIPE',kind:'category',action:'create'},{key:'channel:logs',name:'logs',kind:'channel',action:'create',parentKey:'category:equipe'},{key:'role:gerente',name:'Gerente',kind:'role',action:'create'}]};
test('creates roles before private categories and channels; existing resources reused',()=>{
 const result=requireCreatePlan(plan,'v1',snapshot,snapshot);
 assert.equal(result.ids.get('role:cliente'),'client');
 assert.deepEqual(result.operations.map(o=>o.kind),['role','category','channel']);
});
test('changed config, server, conflicts and destructive strategies cannot apply',()=>{
 assert.throws(()=>requireCreatePlan(plan,'v2',snapshot,snapshot),{code:'CONFIG_CHANGED_REVIEW_PREVIEW'});
 const changed={...snapshot,channels:[...snapshot.channels,{id:'x',name:'external',type:0}]};
 assert.throws(()=>requireCreatePlan(plan,'v1',snapshot,changed),{code:'SERVER_CHANGED_RESCAN_REQUIRED'});
 for(const strategy of ['rebuild']) assert.throws(()=>requireCreatePlan({...plan,strategy},'v1',snapshot,snapshot),{code:'CONFIRMED_REORGANIZATION_NOT_IMPLEMENTED'});
 assert.throws(()=>requireCreatePlan({...plan,operations:[{action:'conflict'}]},'v1',snapshot,snapshot),{code:'PLAN_HAS_CONFLICTS'});
});
test('stable fingerprint detects permission changes but ignores capture metadata',()=>{
 assert.equal(structureFingerprint(snapshot),structureFingerprint({...snapshot,captured_at:'later'}));
 assert.notEqual(structureFingerprint(snapshot),structureFingerprint({...snapshot,roles:[{...snapshot.roles[0],permissions:'8'}]}));
});
test('new staff categories deny everyone and allow only bot and configured staff roles',()=>{
 const ids=new Map([['role:suporte','support'],['role:gerente','manager'],['category:equipe','team']]);
 const p=createPayload(plan.operations[1],ids,'guild','bot');
 assert.equal(p.type,4);
 assert.deepEqual(p.permission_overwrites[0],{id:'guild',type:0,allow:'0',deny:'1024'});
 assert.deepEqual(p.permission_overwrites.map(o=>o.id),['guild','bot','support','manager']);
 assert.equal(createPayload(plan.operations[2],ids,'guild','bot').parent_id,'team');
 assert.equal(createPayload(plan.operations[3],ids,'guild','bot').permissions,'0');
 assert.throws(()=>createPayload(plan.operations[2],new Map(),'guild','bot'),{code:'PARENT_CATEGORY_REQUIRED'});
});
test('uncertain POST outcomes are never retried blindly',async()=>{
 for(const status of [500,502,503]) {
  let calls=0;
  await assert.rejects(discordCreate('guild','role',{name:'Gerente'},'secret','job',async()=>{calls++;return new Response('',{status});}),{code:'MUTATION_RESULT_UNCERTAIN_RESCAN'});
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(discordCreate('guild','role',{name:'Gerente'},'secret','job',async()=>{calls++;throw new Error('timeout');}),{code:'MUTATION_RESULT_UNCERTAIN_RESCAN'});
 assert.equal(calls,1);
});
test('Discord creation is scoped to guild with audit reason and protected token',async()=>{
 const result=await discordCreate('guild','role',{name:'Gerente'},'secret','job',async(url,init)=>{
  assert.equal(url,'https://discord.com/api/v10/guilds/guild/roles');
  assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bot secret');
  assert.equal(decodeURIComponent(init.headers['X-Audit-Log-Reason']),'Nexium job job');
  return Response.json({id:'new',name:'Gerente'});
 });
 assert.equal(result.id,'new');
});

test('reorganization moves public channels without changing IDs, messages or ACLs',async()=>{
 const operation={key:'channel:help',name:'help',kind:'channel',action:'move',discord_id:'help',parentKey:'category:help'};
 const state={...snapshot,channels:[...snapshot.channels,{id:'help',name:'help',type:0,parent_id:'old'}]};
 const plan={strategy:'reorganize',config_updated_at:'v1',operations:[{key:'category:help',kind:'category',name:'SUPORTE',action:'reuse',discord_id:'cat'},operation]};
 const {ids,operations}=requireCreatePlan(plan,'v1',state,state);assert.equal(operations.length,1);
 const moved=await discordMove(operation,ids,'guild','secret','job','bot',async(url,init)=>{
  assert.equal(url,'https://discord.com/api/v10/channels/help');assert.equal(init.method,'PATCH');
  assert.deepEqual(JSON.parse(init.body),{parent_id:'cat'});return Response.json({id:'help',name:'help',parent_id:'cat'});
 });assert.equal(moved.id,'help');
});
test('automatic settings resolve support category and roles; absent IDs are not cleared',async()=>{
 const {automaticSettings}=await import('../supabase/functions/discord-executor/settings.ts');
 assert.deepEqual(automaticSettings(new Map([['category:suporte','cat'],['channel:suporte','support'],['role:suporte','role']])),{category_support_id:'cat',channel_tickets_id:'support',role_support_id:'role'});
});
test('private moves apply the staff-only ACL shown in the plan',async()=>{
 const ids=new Map([['category:equipe','team'],['role:suporte','staff']]);
 const op={key:'channel:logs',kind:'channel',name:'logs',action:'move',discord_id:'logs',parentKey:'category:equipe',permission_mode:'staff_only'};
 await discordMove(op,ids,'guild','secret','job','bot',async(url,init)=>{
  const body=JSON.parse(init.body);assert.equal(body.parent_id,'team');
  assert.deepEqual(body.permission_overwrites.map(o=>o.id),['guild','bot','staff']);assert.equal(body.permission_overwrites[0].deny,'1024');
  return Response.json({id:'logs',name:'logs',parent_id:'team'});
 });
});

test('information panels recover an existing bot message instead of posting duplicates',async()=>{
 const {syncInformationMessage}=await import('../supabase/functions/discord-executor/information.ts');
 const payload={embeds:[{title:'Welcome'}]};const calls=[];
 const message=await syncInformationMessage('channel',undefined,payload,'panel:welcome','bot','secret',async(url,init)=>{
  calls.push(init.method);
  if(init.method==='GET')return Response.json([{id:'existing',author:{id:'bot'},embeds:[{title:'Welcome'}]}]);
  assert(url.endsWith('/messages/existing'));return Response.json({id:'existing'});
 });assert.equal(message.id,'existing');assert.deepEqual(calls,['GET','PATCH']);
});
test('information panel duplicates and incomplete history block a new POST',async()=>{
 const {syncInformationMessage}=await import('../supabase/functions/discord-executor/information.ts');
 const existing={id:'message',author:{id:'bot'},embeds:[{title:'Welcome'}]};
 await assert.rejects(syncInformationMessage('channel',undefined,{embeds:[{title:'Welcome'}]},'panel:welcome','bot','secret',async(url,init)=>{assert.equal(init.method,'GET');return Response.json([existing,existing]);}),{code:'PANEL_DUPLICATES_REVIEW'});
 await assert.rejects(syncInformationMessage('channel',undefined,{embeds:[{title:'Welcome'}]},'panel:welcome','bot','secret',async(url,init)=>{assert.equal(init.method,'GET');return Response.json(Array.from({length:100},(_,i)=>({id:String(i)})));}),{code:'PANEL_HISTORY_REVIEW_REQUIRED'});
});
test('information panel creation has a stable Discord nonce and deleted mappings are recovered',async()=>{
 const {syncInformationMessage}=await import('../supabase/functions/discord-executor/information.ts');const nonces=[];
 for(let attempt=0;attempt<2;attempt++){
  await syncInformationMessage('channel','deleted',{embeds:[{title:'Welcome'}]},'panel:welcome','bot','secret',async(url,init)=>{
   if(init.method==='PATCH')return new Response('',{status:404});
   if(init.method==='GET')return Response.json([]);
   const payload=JSON.parse(init.body);assert.equal(payload.enforce_nonce,true);assert.equal(payload.nonce.length,24);nonces.push(payload.nonce);return Response.json({id:'new'});
  });
 }assert.equal(nonces[0],nonces[1]);
});

test('JSONB key order cannot falsely mark the Discord server as changed',()=>{
 const api={...snapshot,channels:[{...snapshot.channels[0],permission_overwrites:[{id:'guild',type:0,allow:'0',deny:'1024'}]}]};
 const jsonb={...snapshot,channels:[{...snapshot.channels[0],permission_overwrites:[{deny:'1024',allow:'0',type:0,id:'guild'}]}]};
 assert.equal(structureFingerprint(api),structureFingerprint(jsonb));
 assert.notEqual(structureFingerprint(api),structureFingerprint({...jsonb,channels:[{...jsonb.channels[0],permission_overwrites:[{id:'guild',type:0,allow:'1024',deny:'0'}]}]}));
});

test('cosmetic channel ordering does not block a plan that never writes position',()=>{
 assert.equal(structureFingerprint(snapshot),structureFingerprint({...snapshot,channels:snapshot.channels.map(c=>({...c,position:20}))}));
 assert.notEqual(structureFingerprint(snapshot),structureFingerprint({...snapshot,roles:snapshot.roles.map(r=>({...r,position:20}))}));
});
