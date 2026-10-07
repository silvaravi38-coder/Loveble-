import test from 'node:test';
import assert from 'node:assert/strict';
import { planStructure, templateStructure } from '../supabase/functions/discord-executor/planner.ts';
import { discordGet } from '../supabase/functions/discord-executor/discord.ts';
import { describeBotAccess } from '../supabase/functions/discord-executor/permissions.ts';

const snapshot = { guild: { id: '10000000000000000', name: 'Nexium' }, channels: [
  { id: 'cat', name: 'INFORMAÇÕES', type: 4 }, { id: 'welcome', name: 'boas-vindas', type: 0, parent_id: 'cat' },
], roles: [{ id: '10000000000000000', name: '@everyone' }, { id: 'integration', name: 'Cliente', managed: true }] };
const desired = [{ key: 'info', name: 'Informações', kind: 'category' }, { key: 'welcome', name: 'boas-vindas', kind: 'channel', parentKey: 'info' }, { key: 'customer', name: 'Cliente', kind: 'role' }];
test('reuse existing typed resources without adopting managed roles', () => {
  const plan = planStructure(snapshot, desired, [], 'missing');
  assert.deepEqual(plan.operations.map(x => x.action), ['reuse', 'reuse', 'create']);
  assert.equal(plan.operations[1].discord_id, 'welcome');
  assert.equal(plan.requires_confirmation, false);
});
test('ambiguous names cause conflicts instead of duplicates', () => {
  const s = { ...snapshot, channels: [...snapshot.channels, { id: 'dup', name: 'boas-vindas', type: 0, parent_id: 'cat' }] };
  assert.equal(planStructure(s, desired, [], 'missing').operations[1].action, 'conflict');
  assert.equal(planStructure(s, desired, [], 'missing').executable, false);
});
test('persisted ID wins over name matching', () => {
  const s = { ...snapshot, channels: [...snapshot.channels, { id: 'dup', name: 'boas-vindas', type: 0 }] };
  const p = planStructure(s, desired, [{ logical_key: 'welcome', discord_id: 'welcome', resource_type: 'channel' }], 'missing');
  assert.equal(p.operations[1].discord_id, 'welcome');
});
test('voice channels never match text channels with the same name', () => {
  const s = { ...snapshot, channels: [{ id: 'voice', name: 'boas-vindas', type: 2 }] };
  assert.equal(planStructure(s, desired, [], 'missing').operations[1].action, 'create');
});
test('reuse-only does not propose creation; rebuild cannot execute or delete', () => {
  assert.equal(planStructure(snapshot, desired, [], 'reuse').operations[2].action, 'missing');
  const p = planStructure(snapshot, desired, [], 'rebuild');
  assert.equal(p.executable, false);
  assert.equal(p.requires_confirmation, true);
  assert.equal(p.operations.some(x => x.action === 'delete'), false);
});
test('reorganization proposes moves with confirmation', () => {
  const s = { ...snapshot, channels: snapshot.channels.map(x => x.id === 'welcome' ? { ...x, parent_id: 'other' } : x) };
  const p = planStructure(s, desired, [], 'reorganize');
  assert.equal(p.operations[1].action, 'move');
  assert.equal(p.requires_confirmation, true);
});
test('channel and role switches respected for all templates', () => {
  for (const template of ['minimal', 'store_community', 'support_only', 'digital_store']) {
    const p = templateStructure({ template, create_channels: true, create_roles: true, create_logs: false });
    assert.ok(p.length);
    assert.equal(p.some(x => x.name.startsWith('logs')), false);
    assert.equal(p.filter(x => x.kind === 'role').length, 4);
    const categories = new Set(p.filter(x => x.kind === 'category').map(x => x.key));
    assert.ok(p.filter(x => x.kind === 'channel').every(x => categories.has(x.parentKey)));
  }
  assert.deepEqual(templateStructure({ create_channels: false, create_roles: false }), []);
  assert.throws(() => templateStructure({ template: 'invalid' }), /INVALID_TEMPLATE/);
});
test('Discord reads retry 429 and transient failures; token stays in backend header', async () => {
  const attempts = []; let calls = 0;
  const result = await discordGet('/guilds/123/channels', 'test-token', async n => attempts.push(n), async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bot test-token');
    assert.equal(url.includes('test-token'), false);
    calls++;
    return calls === 1 ? new Response(JSON.stringify({ retry_after: 0.1 }), { status: 429 }) : Response.json([]);
  }, async () => {});
  assert.deepEqual(result, []); assert.deepEqual(attempts, [1, 2]);
});
test('invalid token and insufficient permissions do not retry', async () => {
  for (const [status, code] of [[401, 'DISCORD_TOKEN_INVALID'], [403, 'DISCORD_PERMISSION_DENIED'], [404, 'DISCORD_GUILD_OR_RESOURCE_NOT_FOUND']]) {
    let calls = 0;
    await assert.rejects(discordGet('/guilds/123', 'x', async () => {}, async () => { calls++; return new Response('', { status }); }), { code });
    assert.equal(calls, 1);
  }
});
test('network failures and rate limiting have bounded attempts', async () => {
  let calls = 0;
  await assert.rejects(discordGet('/guilds/123', 'x', async () => {}, async () => { calls++; throw new Error('network'); }, async () => {}), { code: 'DISCORD_NETWORK' });
  assert.equal(calls, 3);
  await assert.rejects(discordGet('/guilds/123', 'x', async () => {}, async () => Response.json({ retry_after: 90 }, { status: 429 }), async () => assert.fail('must not wait')), { code: 'DISCORD_RATE_LIMIT' });
});
test('bot permissions do not bypass protected role hierarchy', () => {
  const roles = [
    { id: 'guild', name: '@everyone', position: 0, permissions: '0' },
    { id: 'bot', name: 'Nexus bot', position: 1, permissions: '268553232', managed: true },
    { id: 'client', name: 'Cliente', position: 2, permissions: '0' },
    { id: 'support', name: 'Suporte', position: 1, permissions: '0' },
  ];
  const p = describeBotAccess('guild', roles, ['bot']);
  assert.equal(p.manage_roles, true); assert.equal(p.manage_channels, true);
  assert.equal(p.customer_role_manageable, false); assert.equal(p.support_role_manageable, false);
  roles[1].position = 3;
  assert.equal(describeBotAccess('guild', roles, ['bot']).customer_role_manageable, true);
  roles[1].permissions = '8'; roles[1].position = 1;
  assert.equal(describeBotAccess('guild', roles, ['bot']).customer_role_manageable, false);
});

test('existing Portuguese and English channels are adopted without duplicating the template',()=>{
 const desired=templateStructure({template:'digital_store',create_channels:true,create_roles:false,create_logs:true});
 const live={guild:{id:'guild',name:'Nexium'},roles:[],channels:[{id:'start',name:'Início',type:4},{id:'staff',name:'Área dos Staffs',type:4},{id:'terms',name:'📚・terms',type:0,parent_id:'start'}]};
 const operations=planStructure(live,desired,[],'missing').operations;
 assert.equal(operations.find(o=>o.key==='category:informacoes').discord_id,'start');
 assert.equal(operations.find(o=>o.key==='category:equipe').discord_id,'staff');
 assert.equal(operations.find(o=>o.key==='channel:termos').action,'reuse');
});
test('minimal template keeps logs inside the staff category',()=>{
 const desired=templateStructure({template:'minimal',create_channels:true,create_logs:true});
 assert.equal(desired.find(o=>o.key==='channel:logs').parentKey,'category:equipe');
});

test('inaccessible staff areas are preserved and get a separate Nexium replacement',()=>{
 const live={guild:{id:'guild',name:'Nexium'},roles:[],bot_id:'bot',bot_role_ids:[],bot_access:{permissions:'1040'},channels:[{id:'staff',name:'Área dos Staffs',type:4,permission_overwrites:[{id:'guild',type:0,allow:'0',deny:'1040'}]}]};
 const desired=[{key:'category:equipe',name:'EQUIPE',kind:'category',aliases:['Área dos Staffs']}];
 const plan=planStructure(live,desired,[{logical_key:'category:equipe',discord_id:'staff',resource_type:'category'}],'reorganize');
 assert.equal(plan.operations[0].action,'create');assert.equal(plan.operations[0].name,'EQUIPE NEXIUM');assert(plan.preserved_ids.includes('staff'));
});
