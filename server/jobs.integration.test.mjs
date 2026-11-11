import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from './db.mjs';
import { queryData } from './data.mjs';
import { claimNextJob, processJob, pruneCompletedJobs } from './jobs.mjs';

const enabled = process.env.MARIADB_INTEGRATION_TESTS === 'true';

after(async () => {
  await pool.end();
});

test('MariaDB outbox triggers, claims, recovers leases, retries, completes, and prunes jobs', { skip: !enabled }, async () => {
  const userId = randomUUID();
  const username = `ci${userId.replaceAll('-', '').slice(0, 28)}`;
  const rolledBackMessageId = randomUUID();
  const messageId = randomUUID();
  const parallelMessageIds = [randomUUID(), randomUUID()];
  const parallelClaimIds = [];
  const retryJobId = randomUUID();
  const failedJobId = randomUUID();
  const oldCompletedJobId = randomUUID();
  const recentCompletedJobId = randomUUID();
  let claimedJobId = null;

  try {
    await pool.execute('DELETE FROM background_jobs');
    await pool.execute('UPDATE background_job_settings SET enabled = TRUE WHERE id = 1');
    await pool.execute('INSERT INTO profiles (id, username) VALUES (?, ?)', [userId, username]);

    const rollbackConnection = await pool.getConnection();
    try {
      await rollbackConnection.beginTransaction();
      await rollbackConnection.execute(
        'INSERT INTO global_messages (id, sender_id, content) VALUES (?, ?, ?)',
        [rolledBackMessageId, userId, 'rolled back'],
      );
      await rollbackConnection.rollback();
    } finally {
      rollbackConnection.release();
    }

    const [rolledBackJobs] = await pool.execute(
      "SELECT id FROM background_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.id')) = ?",
      [rolledBackMessageId],
    );
    assert.equal(rolledBackJobs.length, 0);

    await pool.execute(
      'INSERT INTO global_messages (id, sender_id, content) VALUES (?, ?, ?)',
      [messageId, userId, 'committed message'],
    );
    const [queuedJobs] = await pool.execute(
      "SELECT id, job_type, payload FROM background_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.id')) = ?",
      [messageId],
    );
    assert.equal(queuedJobs.length, 1);
    assert.equal(queuedJobs[0].job_type, 'notification.message.created');

    const firstClaim = await claimNextJob(pool);
    claimedJobId = firstClaim.id;
    assert.equal(firstClaim.id, queuedJobs[0].id);
    assert.equal(firstClaim.attempts, 1);

    await pool.execute(
      'UPDATE background_jobs SET locked_until = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?',
      [firstClaim.id],
    );
    const recoveredClaim = await claimNextJob(pool);
    assert.equal(recoveredClaim.id, firstClaim.id);
    assert.equal(recoveredClaim.attempts, 2);

    await processJob(recoveredClaim, pool, async (table, row) => {
      assert.equal(table, 'global_messages');
      assert.equal(row.id, messageId);
    });
    const [completedRows] = await pool.execute('SELECT status, completed_at FROM background_jobs WHERE id = ?', [firstClaim.id]);
    assert.equal(completedRows[0].status, 'completed');
    assert.ok(completedRows[0].completed_at);

    for (const parallelMessageId of parallelMessageIds) {
      await pool.execute(
        'INSERT INTO global_messages (id, sender_id, content) VALUES (?, ?, ?)',
        [parallelMessageId, userId, 'parallel message'],
      );
    }
    const parallelClaims = await Promise.all([claimNextJob(pool), claimNextJob(pool)]);
    assert.equal(parallelClaims.length, 2);
    assert.ok(parallelClaims.every(Boolean));
    assert.notEqual(parallelClaims[0].id, parallelClaims[1].id);
    parallelClaimIds.push(...parallelClaims.map((job) => job.id));
    const [parallelJobs] = await pool.execute(
      "SELECT id FROM background_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.id')) IN (?, ?)",
      parallelMessageIds,
    );
    assert.deepEqual(
      parallelClaims.map((job) => job.id).sort(),
      parallelJobs.map((job) => job.id).sort(),
    );
    await Promise.all(parallelClaims.map((job) => processJob(job, pool, async () => {})));

    await pool.execute(
      'INSERT INTO background_jobs (id, job_type, payload, status, attempts) VALUES (?, ?, ?, ?, ?)',
      [retryJobId, 'notification.message.created', JSON.stringify({ table: 'global_messages', id: messageId }), 'processing', 3],
    );
    await processJob({
      id: retryJobId,
      job_type: 'notification.message.created',
      payload: { table: 'global_messages', id: messageId },
      attempts: 3,
    }, pool, async () => {
      throw new Error('temporary failure');
    });
    const [retryRows] = await pool.execute('SELECT status, last_error FROM background_jobs WHERE id = ?', [retryJobId]);
    assert.equal(retryRows[0].status, 'pending');
    assert.equal(retryRows[0].last_error, 'temporary failure');

    await pool.execute(
      'INSERT INTO background_jobs (id, job_type, payload, status, attempts) VALUES (?, ?, ?, ?, ?)',
      [failedJobId, 'notification.message.created', JSON.stringify({ table: 'global_messages', id: messageId }), 'processing', 8],
    );
    await processJob({
      id: failedJobId,
      job_type: 'notification.message.created',
      payload: { table: 'global_messages', id: messageId },
      attempts: 8,
    }, pool, async () => {
      throw new Error('terminal failure');
    });
    const [failedRows] = await pool.execute('SELECT status, last_error FROM background_jobs WHERE id = ?', [failedJobId]);
    assert.equal(failedRows[0].status, 'failed');
    assert.equal(failedRows[0].last_error, 'terminal failure');

    await pool.execute(
      "INSERT INTO background_jobs (id, job_type, payload, status, completed_at) VALUES (?, ?, ?, 'completed', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 31 DAY)), (?, ?, ?, 'completed', UTC_TIMESTAMP(3))",
      [
        oldCompletedJobId,
        'notification.message.created',
        JSON.stringify({ table: 'global_messages', id: messageId }),
        recentCompletedJobId,
        'notification.message.created',
        JSON.stringify({ table: 'global_messages', id: messageId }),
      ],
    );
    const removed = await pruneCompletedJobs(pool);
    assert.ok(removed >= 1);
    const [retentionRows] = await pool.execute(
      'SELECT id FROM background_jobs WHERE id IN (?, ?)',
      [oldCompletedJobId, recentCompletedJobId],
    );
    assert.equal(retentionRows.length, 1);
    assert.equal(retentionRows[0].id, recentCompletedJobId);
  } finally {
    await pool.execute('UPDATE background_job_settings SET enabled = FALSE WHERE id = 1');
    const cleanupJobIds = [
      claimedJobId,
      ...parallelClaimIds,
      retryJobId,
      failedJobId,
      oldCompletedJobId,
      recentCompletedJobId,
    ].filter(Boolean);
    if (cleanupJobIds.length) {
      await pool.execute(
        `DELETE FROM background_jobs WHERE id IN (${cleanupJobIds.map(() => '?').join(', ')})`,
        cleanupJobIds,
      );
    }
    await pool.execute(
      'DELETE FROM global_messages WHERE id IN (?, ?, ?, ?)',
      [rolledBackMessageId, messageId, ...parallelMessageIds],
    );
    await pool.execute('DELETE FROM profiles WHERE id = ?', [userId]);
  }
});


test('direct messages are rejected when either participant has blocked the other', { skip: !enabled }, async () => {
  const senderId = randomUUID();
  const peerId = randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const blockId = randomUUID();
  const senderName = `dm${senderId.replaceAll('-', '').slice(0, 29)}`;
  const peerName = `dm${peerId.replaceAll('-', '').slice(0, 29)}`;

  try {
    await pool.execute('INSERT INTO profiles (id, username) VALUES (?, ?), (?, ?)', [senderId, senderName, peerId, peerName]);
    await pool.execute(
      'INSERT INTO conversations (id, is_group, name, created_by) VALUES (?, FALSE, NULL, ?)',
      [conversationId, senderId],
    );
    await pool.execute(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member'), (?, ?, ?, 'member')",
      [randomUUID(), conversationId, senderId, randomUUID(), conversationId, peerId],
    );
    await pool.execute(
      'INSERT INTO blocked_users (id, blocker_id, blocked_id) VALUES (?, ?, ?)',
      [blockId, peerId, senderId],
    );

    await assert.rejects(
      queryData(senderId, {
        table: 'messages',
        operation: 'insert',
        values: { id: messageId, conversation_id: conversationId, sender_id: senderId, content: 'blocked message' },
      }),
      /Not allowed to insert this row/,
    );

    await pool.execute('DELETE FROM blocked_users WHERE id = ?', [blockId]);
    const result = await queryData(senderId, {
      table: 'messages',
      operation: 'insert',
      values: { id: messageId, conversation_id: conversationId, sender_id: senderId, content: 'allowed message' },
    });
    assert.equal(result.count, 1);
    assert.equal(result.data[0].id, messageId);
  } finally {
    await pool.execute('DELETE FROM messages WHERE id = ?', [messageId]);
    await pool.execute('DELETE FROM conversations WHERE id = ?', [conversationId]);
    await pool.execute('DELETE FROM profiles WHERE id IN (?, ?)', [senderId, peerId]);
  }
});


test('concurrent single-choice poll votes leave exactly one selected option', { skip: !enabled }, async () => {
  const userId = randomUUID();
  const pollId = randomUUID();
  const optionIds = [randomUUID(), randomUUID()];
  const userName = `poll${userId.replaceAll('-', '').slice(0, 28)}`;

  try {
    await pool.execute('INSERT INTO profiles (id, username) VALUES (?, ?)', [userId, userName]);
    await pool.execute(
      `INSERT INTO polls (id, channel, conversation_id, created_by, question, multiple_choice, ends_at)
       VALUES (?, 'global', NULL, ?, 'Choose one', FALSE, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY))`,
      [pollId, userId],
    );
    await pool.execute(
      'INSERT INTO poll_options (id, poll_id, text, position) VALUES (?, ?, ?, 1), (?, ?, ?, 2)',
      [optionIds[0], pollId, 'First', optionIds[1], pollId, 'Second'],
    );

    const votes = await Promise.all(optionIds.map((optionId) => queryData(userId, {
      table: 'poll_votes',
      operation: 'insert',
      values: {
        id: randomUUID(),
        poll_id: pollId,
        option_id: optionId,
        user_id: userId,
      },
    })));
    assert.equal(votes.length, 2);

    const [storedVotes] = await pool.execute('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, userId]);
    assert.equal(storedVotes.length, 1);
    assert.ok(optionIds.includes(storedVotes[0].option_id));
  } finally {
    await pool.execute('DELETE FROM polls WHERE id = ?', [pollId]);
    await pool.execute('DELETE FROM profiles WHERE id = ?', [userId]);
  }
});
