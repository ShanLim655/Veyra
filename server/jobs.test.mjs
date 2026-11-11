import test from 'node:test';
import assert from 'node:assert/strict';
import { claimNextJob, parseNotificationJob, processJob, renewJobLease, retryDelaySeconds, supportsSkipLockedVersion } from './jobs.mjs';

test('notification jobs accept only supported message tables and identifiers', () => {
  assert.deepEqual(parseNotificationJob('notification.message.created', JSON.stringify({
    table: 'messages',
    id: 'message-1',
  })), { table: 'messages', id: 'message-1' });
  assert.throws(() => parseNotificationJob('unknown', { table: 'messages', id: 'message-1' }), /Unsupported/);
  assert.throws(() => parseNotificationJob('notification.message.created', { table: 'profiles', id: 'user-1' }), /Invalid/);
  assert.throws(() => parseNotificationJob('notification.message.created', { table: 'messages', id: '' }), /Invalid/);
});

test('background job retry delay grows exponentially and is capped', () => {
  assert.equal(retryDelaySeconds(1), 1);
  assert.equal(retryDelaySeconds(2), 2);
  assert.equal(retryDelaySeconds(3), 4);
  assert.equal(retryDelaySeconds(8), 128);
  assert.equal(retryDelaySeconds(9), 256);
  assert.equal(retryDelaySeconds(10), 300);
  assert.equal(retryDelaySeconds(20), 300);
});

test('job claiming increments attempts and releases the database lock', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    execute: async (sql) => {
      if (sql.includes('SELECT id, job_type')) return [[{
        id: 'job-1',
        job_type: 'notification.message.created',
        payload: { table: 'messages', id: 'message-1' },
        attempts: 2,
      }]];
      if (sql.includes('UPDATE background_jobs')) {
        events.push('claim');
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected SQL');
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const database = { getConnection: async () => connection };
  const job = await claimNextJob(database);
  assert.equal(job.id, 'job-1');
  assert.equal(job.attempts, 3);
  assert.deepEqual(events, ['begin', 'claim', 'commit', 'release']);
});

test('job claiming commits cleanly when no work is available', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    execute: async () => [[]],
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const job = await claimNextJob({ getConnection: async () => connection });
  assert.equal(job, null);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
});

test('successful notification jobs are marked completed', async () => {
  const statements = [];
  const database = {
    execute: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT * FROM')) return [[{ id: 'message-1', sender_id: 'user-1' }]];
      return [{ affectedRows: 1 }];
    },
  };
  let delivered = 0;
  await processJob({
    id: 'job-1',
    job_type: 'notification.message.created',
    payload: { table: 'messages', id: 'message-1' },
    attempts: 1,
  }, database, async (table, row) => {
    assert.equal(table, 'messages');
    assert.equal(row.id, 'message-1');
    delivered++;
  });
  assert.equal(delivered, 1);
  assert.match(statements[1].sql, /status = 'completed'/);
});

test('failed notification jobs are rescheduled with backoff', async () => {
  const statements = [];
  const database = {
    execute: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT * FROM')) return [[{ id: 'message-1', sender_id: 'user-1' }]];
      return [{ affectedRows: 1 }];
    },
  };
  await processJob({
    id: 'job-1',
    job_type: 'notification.message.created',
    payload: { table: 'messages', id: 'message-1' },
    attempts: 3,
  }, database, async () => {
    throw new Error('temporary delivery failure');
  });
  assert.match(statements[1].sql, /status = \?/);
  assert.deepEqual(statements[1].params.slice(0, 2), ['pending', 4]);
});

test('jobs become terminally failed after the maximum attempt count', async () => {
  const statements = [];
  const database = {
    execute: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.startsWith('SELECT * FROM')) return [[{ id: 'message-1', sender_id: 'user-1' }]];
      return [{ affectedRows: 1 }];
    },
  };
  await processJob({
    id: 'job-1',
    job_type: 'notification.message.created',
    payload: { table: 'messages', id: 'message-1' },
    attempts: 8,
  }, database, async () => {
    throw new Error('permanent delivery failure');
  });
  assert.deepEqual(statements[1].params.slice(0, 2), ['failed', 128]);
});

test('job claiming enables skip-locked only on supported database versions', () => {
  assert.equal(supportsSkipLockedVersion('10.6.0-MariaDB'), true);
  assert.equal(supportsSkipLockedVersion('10.11.6-MariaDB'), true);
  assert.equal(supportsSkipLockedVersion('10.5.25-MariaDB'), false);
  assert.equal(supportsSkipLockedVersion('8.0.36'), true);
  assert.equal(supportsSkipLockedVersion('5.7.44'), false);
  assert.equal(supportsSkipLockedVersion('unknown'), false);
});

test('notification job leases can be extended while a worker is processing', async () => {
  let statement;
  let parameters;
  const renewed = await renewJobLease('job-1', {
    execute: async (sql, args) => {
      statement = sql;
      parameters = args;
      return [{ affectedRows: 1 }];
    },
  });
  assert.equal(renewed, true);
  assert.match(statement, /locked_until = DATE_ADD/);
  assert.match(statement, /status = 'processing'/);
  assert.deepEqual(parameters, ['job-1']);
});
