import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDiscordSignature,interactionAction,orderMessage,privateMessage} from '../supabase/functions/discord-interactions/security.ts';
const hex=data=>Buffer.from(data).toString('hex');
test('Discord signature verifies raw timestamp+body and rejects tampering, replay age and wrong key',async()=>{
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const key=hex(await crypto.subtle.exportKey('raw',pair.publicKey));
 const timestamp=String(Math.floor(Date.now()/1000)),body='{"type":1}';
 const signature=hex(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(timestamp+body)));
 assert.equal(await verifyDiscordSignature(key,signature,timestamp,body),true);
 assert.equal(await verifyDiscordSignature(key,signature,timestamp,body+' '),false);
 assert.equal(await verifyDiscordSignature(key,signature,timestamp,body,Date.now()+600000),false);
 assert.equal(await verifyDiscordSignature('0'.repeat(64),signature,timestamp,body),false);
 assert.equal(await verifyDiscordSignature(key,'bad',timestamp,body),false);
});
test('only named Nexium commands and allowlisted button action are accepted',()=>{
 assert.equal(interactionAction({type:2,data:{name:'nexium',options:[{name:'teste'}]}}),'test');
 assert.equal(interactionAction({type:2,data:{name:'nexium',options:[{name:'pedidos'}]}}),'orders');
 assert.equal(interactionAction({type:3,data:{custom_id:'nexium:my-orders:v1'}}),'orders');
 assert.equal(interactionAction({type:3,data:{custom_id:'nexium:orders:other-user'}}),'unsupported');
 assert.equal(interactionAction({type:2,data:{name:'admin'}}),'unsupported');
});
test('order responses do not include credentials, delivery text or amounts and suppress all mentions',()=>{
 const response=orderMessage([{id:'12345678-other',status:'delivered',created_at:'2026-10-06T21:00:00Z',delivery_text:'SECRET',total:20},{id:'98765432-other',status:'unknown',created_at:'2026-10-06T21:00:00Z'}]);
 assert.match(response.content,/#12345678 — Entregue/);assert.match(response.content,/Status indisponível/);
 assert.equal(JSON.stringify(response).includes('SECRET'),false);assert.deepEqual(response.allowed_mentions.parse,[]);
 assert.match(orderMessage([]).content,/Nenhum pedido/);assert.deepEqual(privateMessage('@everyone').allowed_mentions.parse,[]);
});
