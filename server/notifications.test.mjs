import test from 'node:test';
import assert from 'node:assert/strict';
import { publish, notifyNewMessage } from './notifications.mjs';
import { pool } from './db.mjs';

test('notification publishing retries transient server failures', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 };
  };
  try {
    assert.equal(await publish('https://ntfy.sh', 'veyra-test', 'Title', 'Message'), true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notification publishing does not retry permanent client errors', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 400 };
  };
  try {
    assert.equal(await publish('https://ntfy.sh', 'veyra-test', 'Title', 'Message'), false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notification publishing rejects unsupported servers without a request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200 };
  };
  try {
    assert.equal(await publish('https://example.com', 'veyra-test', 'Title', 'Message'), false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notification publishing rejects insecure HTTP endpoints without a request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200 };
  };
  try {
    assert.equal(await publish('http://ntfy.sh', 'veyra-test', 'Title', 'Message'), false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shared digest topics update cooldown state for every subscribed user', async () => {
  const originalExecute = pool.execute;
  const originalFetch = globalThis.fetch;
  const preferences = ['user-1', 'user-2'].map((user_id) => ({
    user_id,
    ntfy_server: 'https://ntfy.sh',
    ntfy_topic: 'shared-topic',
    dm_mode: 'digest',
    digest_cooldown_minutes: 10,
  }));
  let notificationRequests = 0;
  let digestUpdates = 0;
  pool.execute = async (sql) => {
    if (sql.includes('SELECT username, display_name FROM profiles')) return [[{ username: 'sender' }]];
    if (sql.includes('SELECT user_id FROM conversation_members')) return [[{ user_id: 'user-1' }, { user_id: 'user-2' }]];
    if (sql.includes('SELECT * FROM notification_preferences')) return [preferences];
    if (sql.includes('SELECT last_notified_at FROM notification_digest_state')) return [[]];
    if (sql.includes('INSERT INTO notification_digest_state')) {
      digestUpdates++;
      return [{ affectedRows: 1 }];
    }
    throw new Error('Unexpected notification query');
  };
  globalThis.fetch = async () => {
    notificationRequests++;
    return { ok: true, status: 200 };
  };
  try {
    await notifyNewMessage('messages', {
      sender_id: 'sender',
      conversation_id: 'conversation-1',
      content: 'hello',
    });
    assert.equal(notificationRequests, 1);
    assert.equal(digestUpdates, 2);
  } finally {
    pool.execute = originalExecute;
    globalThis.fetch = originalFetch;
  }
});

test('successful shared-topic delivery cools down digest subscribers after another subscriber retries', async () => {
  const originalExecute = pool.execute;
  const originalFetch = globalThis.fetch;
  const preferences = [
    {
      user_id: 'digest-user',
      ntfy_server: 'https://ntfy.sh',
      ntfy_topic: 'shared-failure-topic',
      dm_mode: 'digest',
      digest_cooldown_minutes: 10,
    },
    {
      user_id: 'instant-user',
      ntfy_server: 'https://ntfy.sh',
      ntfy_topic: 'shared-failure-topic',
      dm_mode: 'every',
    },
  ];
  let requests = 0;
  const digestUsers = [];
  pool.execute = async (sql, params) => {
    if (sql.includes('SELECT username, display_name FROM profiles')) return [[{ username: 'sender' }]];
    if (sql.includes('SELECT user_id FROM conversation_members')) return [[{ user_id: 'digest-user' }, { user_id: 'instant-user' }]];
    if (sql.includes('SELECT * FROM notification_preferences')) return [preferences];
    if (sql.includes('SELECT last_notified_at FROM notification_digest_state')) return [[]];
    if (sql.includes('INSERT INTO notification_digest_state')) {
      digestUsers.push(params[0]);
      return [{ affectedRows: 1 }];
    }
    throw new Error('Unexpected notification query');
  };
  globalThis.fetch = async () => {
    requests++;
    return { ok: requests >= 4, status: requests >= 4 ? 200 : 503 };
  };
  try {
    await assert.rejects(
      notifyNewMessage('messages', {
        sender_id: 'sender',
        conversation_id: 'conversation-2',
        content: 'hello',
      }),
      /notification destination/,
    );
    assert.equal(requests, 4);
    assert.deepEqual(digestUsers, ['digest-user']);
  } finally {
    pool.execute = originalExecute;
    globalThis.fetch = originalFetch;
  }
});

test('notification publishing rejects subdomains and non-standard ports', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200 };
  };
  try {
    assert.equal(await publish('https://sub.ntfy.sh', 'veyra-test', 'Title', 'Message'), false);
    assert.equal(await publish('https://ntfy.sh:8443', 'veyra-test', 'Title', 'Message'), false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notification requests do not follow redirects', async () => {
  const originalFetch = globalThis.fetch;
  let options;
  globalThis.fetch = async (_url, value) => {
    options = value;
    return { ok: true, status: 200 };
  };
  try {
    assert.equal(await publish('https://ntfy.sh', 'veyra-test', 'Title', 'Message'), true);
    assert.equal(options.redirect, 'error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
