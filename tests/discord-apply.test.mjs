import test from 'node:test';
import assert from 'node:assert/strict';
import {requireCreatePlan,createPayload,discordCreate,structureFingerprint} from '../supabase/functions/discord-executor/apply.ts';
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
 for(const strategy of ['reorganize','rebuild']) assert.throws(()=>requireCreatePlan({...plan,strategy},'v1',snapshot,snapshot),{code:'CONFIRMED_REORGANIZATION_NOT_IMPLEMENTED'});
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
