import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.REDIS_URL = '';
const { cachedRead, coalesce, consumeRateLimit } = await import('./redis.mjs');

test('identical in-flight operations share one result', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = coalesce('same', async () => { calls++; await gate; return 'done'; });
  const second = coalesce('same', async () => { calls++; return 'wrong'; });
  release();
  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
  assert.equal(calls, 1);
});

test('different keys do not share work', async () => {
  let calls = 0;
  const result = await Promise.all([
    coalesce('user-a:conversation-a:page-1', async () => ++calls),
    coalesce('user-a:conversation-a:page-2', async () => ++calls),
    coalesce('user-b:conversation-a:page-1', async () => ++calls),
  ]);
  assert.equal(new Set(result).size, 3);
});

test('reads fall back to MariaDB when Redis is not configured', async () => {
  let queries = 0;
  const query = () => { queries++; return Promise.resolve({ rows: [1, 2], next: null }); };
  const key = { user: 'same-user', conversation: 'room-a', limit: 50, cursor: null };
  const results = await Promise.all([
    cachedRead('same-user', 'messages', key, query),
    cachedRead('same-user', 'messages', key, query),
  ]);
  assert.deepEqual(results[0], { rows: [1, 2], next: null });
  assert.deepEqual(results[1], results[0]);
  assert.equal(queries, 1);
});

test('authentication rate limits reject requests after the configured limit', async () => {
  const scope = `test-auth-${randomUUID()}`;
  assert.equal(await consumeRateLimit(scope, 'client-a', 2, 60000), true);
  assert.equal(await consumeRateLimit(scope, 'client-a', 2, 60000), true);
  assert.equal(await consumeRateLimit(scope, 'client-a', 2, 60000), false);
});

test('authentication rate limits isolate different clients and scopes', async () => {
  const scope = `test-auth-${randomUUID()}`;
  assert.equal(await consumeRateLimit(scope, 'client-a', 1, 60000), true);
  assert.equal(await consumeRateLimit(scope, 'client-a', 1, 60000), false);
  assert.equal(await consumeRateLimit(scope, 'client-b', 1, 60000), true);
  assert.equal(await consumeRateLimit(`${scope}-other`, 'client-a', 1, 60000), true);
});

test('authentication rate limits reset after their fixed window expires', async () => {
  const scope = `test-auth-expiry-${randomUUID()}`;
  assert.equal(await consumeRateLimit(scope, 'client-a', 1, 5), true);
  assert.equal(await consumeRateLimit(scope, 'client-a', 1, 5), false);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(await consumeRateLimit(scope, 'client-a', 1, 5), true);
});
