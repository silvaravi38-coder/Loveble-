import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryMessageFor} from '../supabase/functions/discord-interactions/recovery-messages.ts';

test('missing Discord resources tell the administrator how to refresh server configuration',()=>{
  assert.match(recoveryMessageFor('DISCORD_RESOURCE_NOT_FOUND'),/configurar/);
  assert.match(recoveryMessageFor('DISCORD_RESOURCE_NOT_FOUND'),/canais e cargos atuais/);
});

test('permission preview mismatches explain the safe recovery path',()=>{
  const message=recoveryMessageFor('CONTROL_VERIFICATION_FAILED');
  assert.match(message,/Nenhuma alteração foi aplicada/);
  assert.match(message,/novo preview/);
});

test('unknown errors keep the existing generic fallback',()=>{
  assert.equal(recoveryMessageFor('UNKNOWN_CODE'),undefined);
});
