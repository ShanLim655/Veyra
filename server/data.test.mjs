import test from 'node:test';
import assert from 'node:assert/strict';
import { adminLogsAccessPolicy, buildPrimaryKeyDelete, conversationMembersAccessPolicy, insertPollVote, parseOr, pollVotesAccessPolicy, userRolesAccessPolicy } from './data.mjs';

const columns = new Map([
  ['created_at', 'datetime(3)'],
  ['id', 'char(36)'],
]);

test('nested OR and AND filters build a stable timestamp and ID cursor', () => {
  const timestamp = '2026-11-11T12:00:00.000Z';
  const id = '00000000-0000-0000-0000-000000000001';
  const result = parseOr(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${id})`, columns);

  assert.equal(result.sql, '(`created_at` < ? OR (`created_at` = ? AND `id` < ?))');
  assert.deepEqual(result.args, ['2026-11-11 12:00:00.000', '2026-11-11 12:00:00.000', id]);
});

test('nested filter parser rejects unsupported columns and malformed groups', () => {
  assert.throws(() => parseOr('missing.lt.value', columns), /Unsupported column/);
  assert.throws(() => parseOr('and(created_at.eq.value,id.lt.value', columns), /Invalid OR filter/);
});

test('ordinary users cannot change their own privilege records', () => {
  assert.deepEqual(userRolesAccessPolicy('user-1', 'select', false), { sql: 'user_id = ?', args: ['user-1'] });
  assert.deepEqual(userRolesAccessPolicy('user-1', 'update', false), { sql: '1 = 0', args: [] });
  assert.deepEqual(userRolesAccessPolicy('user-1', 'insert', false), { sql: '1 = 0', args: [] });
  assert.deepEqual(userRolesAccessPolicy('admin-1', 'update', true), { sql: '1 = 1', args: [] });
});

test('group membership writes are restricted to trusted admin operations', () => {
  assert.deepEqual(conversationMembersAccessPolicy('user-1', 'insert', false), { sql: '1 = 0', args: [] });
  assert.deepEqual(conversationMembersAccessPolicy('user-1', 'delete', false), { sql: '1 = 0', args: [] });
  assert.deepEqual(conversationMembersAccessPolicy('admin-1', 'insert', true), { sql: '1 = 1', args: [] });
});

test('admin audit logs allow append and read but reject mutation', () => {
  assert.deepEqual(adminLogsAccessPolicy(true, 'select'), { sql: '1 = 1', args: [] });
  assert.deepEqual(adminLogsAccessPolicy(true, 'insert'), { sql: '1 = 1', args: [] });
  assert.deepEqual(adminLogsAccessPolicy(true, 'update'), { sql: '1 = 0', args: [] });
  assert.deepEqual(adminLogsAccessPolicy(true, 'delete'), { sql: '1 = 0', args: [] });
});

test('poll vote access is scoped to the authenticated user and conversation membership', () => {
  const access = pollVotesAccessPolicy('user-1', 'insert', false);
  assert.match(access.sql, /user_id = \?/);
  assert.match(access.sql, /conversation_members/);
  assert.deepEqual(access.args, ['user-1', 'user-1']);
});

test('delete statements preserve composite primary keys and authorization filters', () => {
  const deletion = buildPrimaryKeyDelete(
    'notification_digest_state',
    ['user_id', 'channel_key'],
    [
      { user_id: 'user-1', channel_key: 'global' },
      { user_id: 'user-2', channel_key: 'dm:conversation-1' },
    ],
    'user_id = ?',
    ['user-1'],
  );

  assert.equal(
    deletion.sql,
    'DELETE FROM `notification_digest_state` WHERE user_id = ? AND ((`user_id` = ? AND `channel_key` = ?) OR (`user_id` = ? AND `channel_key` = ?))',
  );
  assert.deepEqual(deletion.args, ['user-1', 'user-1', 'global', 'user-2', 'dm:conversation-1']);
  assert.throws(() => buildPrimaryKeyDelete('profiles', [], [{ id: 'user-1' }], '1 = 1', []), /primary key/);
});

test('single-choice poll votes replace the previous choice in one locked transaction', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    execute: async (sql) => {
      if (sql.includes('SELECT p.multiple_choice')) {
        events.push('lock-poll');
        return [[{ multiple_choice: 0, conversation_id: 'conversation-1' }]];
      }
      if (sql.includes('SELECT 1 FROM conversation_members')) {
        events.push('lock-membership');
        return [[{ 1: 1 }]];
      }
      if (sql.startsWith('DELETE FROM poll_votes')) {
        events.push('delete-previous');
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO poll_votes')) {
        events.push('insert-new');
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected SQL');
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  await insertPollVote({ getConnection: async () => connection }, {
    id: 'vote-1',
    poll_id: 'poll-1',
    option_id: 'option-2',
    user_id: 'user-1',
  }, ['id', 'poll_id', 'option_id', 'user_id'], 'user-1');
  assert.deepEqual(events, ['begin', 'lock-poll', 'lock-membership', 'delete-previous', 'insert-new', 'commit', 'release']);
});

test('poll vote transaction rolls back if conversation membership is gone', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    execute: async (sql) => {
      if (sql.includes('SELECT p.multiple_choice')) return [[{ multiple_choice: 0, conversation_id: 'conversation-1' }]];
      if (sql.includes('SELECT 1 FROM conversation_members')) return [[]];
      throw new Error('Unexpected SQL');
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  await assert.rejects(
    insertPollVote({ getConnection: async () => connection }, {
      id: 'vote-1',
      poll_id: 'poll-1',
      option_id: 'option-2',
      user_id: 'user-1',
    }, ['id', 'poll_id', 'option_id', 'user_id'], 'user-1'),
    /no longer a member/,
  );
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('multiple-choice poll votes do not remove existing selections', async () => {
  const statements = [];
  const connection = {
    beginTransaction: async () => statements.push('begin'),
    execute: async (sql) => {
      statements.push(sql);
      if (sql.includes('SELECT p.multiple_choice')) return [[{ multiple_choice: 1, conversation_id: null }]];
      if (sql.startsWith('INSERT INTO poll_votes')) return [{ affectedRows: 1 }];
      throw new Error('Unexpected SQL');
    },
    commit: async () => statements.push('commit'),
    rollback: async () => statements.push('rollback'),
    release: () => statements.push('release'),
  };
  await insertPollVote({ getConnection: async () => connection }, {
    id: 'vote-2',
    poll_id: 'poll-1',
    option_id: 'option-2',
    user_id: 'user-1',
  }, ['id', 'poll_id', 'option_id', 'user_id'], 'user-1');
  assert.equal(statements.some((statement) => typeof statement === 'string' && statement.startsWith('DELETE FROM poll_votes')), false);
  assert.ok(statements.includes('commit'));
  assert.equal(statements.at(-1), 'release');
});
