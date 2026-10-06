import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationUrl,callbackUrl,exchangeIdentity,stateHash,validState} from '../supabase/functions/discord-oauth/oauth.ts';
test('authorization uses fixed redirect, minimum scope and unpredictable state format',async()=>{
 const state='a'.repeat(64),url=new URL(authorizationUrl(state));
 assert.equal(url.origin,'https://discord.com');assert.equal(url.searchParams.get('scope'),'identify');
 assert.equal(url.searchParams.get('redirect_uri'),callbackUrl);assert.equal(url.searchParams.get('state'),state);
 assert.equal(validState('short'),false);assert.throws(()=>authorizationUrl('short'));
 assert.notEqual(await stateHash(state),state);assert.equal((await stateHash(state)).length,64);
});
test('token exchange stays server-side and returns only verified identity',async()=>{
 let calls=0;
 const result=await exchangeIdentity('code','server-secret',async(url,init)=>{
  calls++;
  if(calls===1){assert.equal(url,'https://discord.com/api/v10/oauth2/token');assert.equal(init.body.get('client_secret'),'server-secret');assert.equal(init.body.get('redirect_uri'),callbackUrl);return Response.json({access_token:'private',refresh_token:'also-private',token_type:'Bearer',scope:'identify'});}
  assert.equal(init.headers.Authorization,'Bearer private');return Response.json({id:'1557132199227031552',username:'customer',email:'unused',bot:false});
 });
 assert.deepEqual(result,{id:'1557132199227031552',username:'customer'});
});
test('failed exchanges, missing scope and bot identities never create links',async()=>{
 await assert.rejects(exchangeIdentity('code','secret',async()=>new Response('',{status:401})),/DISCORD_CODE_EXCHANGE_FAILED/);
 await assert.rejects(exchangeIdentity('code','secret',async()=>Response.json({access_token:'x',token_type:'Bearer',scope:'guilds'})),/INVALID_DISCORD_TOKEN_RESPONSE/);
 let calls=0;
 await assert.rejects(exchangeIdentity('code','secret',async()=>++calls===1?Response.json({access_token:'x',token_type:'Bearer',scope:'identify'}):Response.json({id:'1557132199227031552',username:'bot',bot:true})),/INVALID_DISCORD_IDENTITY/);
});
