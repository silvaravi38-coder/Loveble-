import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWithRetry } from '../supabase/functions/discord-interactions/delivery-retry.js';

const noPause = async () => {};

test('retries transient Discord errors and returns the successful response', async () => {
  let calls = 0;
  const result = await sendWithRetry('https://discord.test', {}, async () => {
    calls++;
    return new Response(null, { status: calls === 1 ? 503 : 204 });
  }, { pause: noPause });
  assert.equal(result.status, 204);
  assert.equal(calls, 2);
});

test('does not retry permanent errors', async () => {
  let calls = 0;
  const result = await sendWithRetry('https://discord.test', {}, async () => {
    calls++;
    return new Response(null, { status: 401 });
  }, { pause: noPause });
  assert.equal(result.status, 401);
  assert.equal(calls, 1);
});

test('honors long rate limits without retrying early', async () => {
  let calls = 0;
  const result = await sendWithRetry('https://discord.test', {}, async () => {
    calls++;
    return new Response(null, { status: 429, headers: { 'retry-after': '5' } });
  }, { pause: noPause });
  assert.equal(result.status, 429);
  assert.equal(calls, 1);
});

test('retries a transient network failure', async () => {
  let calls = 0;
  const result = await sendWithRetry('https://discord.test', {}, async () => {
    calls++;
    if (calls === 1) throw new TypeError('network error');
    return new Response(null, { status: 204 });
  }, { pause: noPause });
  assert.equal(result.status, 204);
  assert.equal(calls, 2);
});
