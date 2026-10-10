import test from 'node:test';
import assert from 'node:assert/strict';
import {productChannelName,salesChannelPlan} from '../supabase/functions/discord-interactions/sales-channel-names.ts';

test('sales channel names use recognizable product emojis and readable names',()=>{
  assert.equal(productChannelName('YouTube Premium'),'📼・youtube-premium');
  assert.equal(productChannelName('Netflix'),'🎬・netflix');
  assert.equal(productChannelName('Spotify Premium'),'🎵・spotify-premium');
  assert.equal(productChannelName('Discord Nitro'),'💎・discord-nitro');
  assert.equal(productChannelName('Produto especial'),'📦・produto-especial');
});

test('sales channel names remove control and mention characters and respect Discord length',()=>{
  const name=productChannelName('@everyone: ' + 'ç'.repeat(120));
  assert.equal(name.includes('@'),false);
  assert.equal(name.includes(':'),false);
  assert.ok(Array.from(name).length<=100);
  assert.match(name,/^📦・everyone-/);
});

test('sales channel sync creates missing channels and renames only owned product channels',()=>{
  assert.deepEqual(salesChannelPlan('YouTube'),{action:'create',name:'📼・youtube'});
  assert.deepEqual(salesChannelPlan('YouTube',{id:'channel-1',name:'youtube-1234'}),{action:'rename',id:'channel-1',name:'📼・youtube'});
  assert.deepEqual(salesChannelPlan('YouTube',{id:'channel-1',name:'📼・youtube'}),{action:'keep',id:'channel-1',name:'📼・youtube'});
});
