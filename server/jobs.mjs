import { pool } from './db.mjs';
import { notifyNewMessage } from './notifications.mjs';

const ENABLED = /^(1|true|yes)$/i.test(String(process.env.BACKGROUND_JOBS_ENABLED || ''));
const MAX_ATTEMPTS = 8;
const JOB_LEASE_SECONDS = 120;
const JOB_HEARTBEAT_MS = 30000;
const COMPLETED_JOB_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MESSAGE_TABLES = new Set(['messages', 'global_messages', 'announcement_messages']);

export function retryDelaySeconds(attempt) {
  const value = Number(attempt);
  return Math.min(300, 2 ** Math.min(9, Math.max(0, (Number.isFinite(value) ? value : 1) - 1)));
}

export function parseNotificationJob(type, payload) {
  if (type !== 'notification.message.created') throw new Error('Unsupported background job type.');
  const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!value || !MESSAGE_TABLES.has(value.table) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Invalid message notification job payload.');
  }
  return { table: value.table, id: value.id };
}

export function supportsSkipLockedVersion(value) {
  const version = String(value || '');
  const match = version.match(/(\d+)\.(\d+)\.(\d+)-MariaDB/i) || version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (/MariaDB/i.test(version)) return major > 10 || (major === 10 && minor >= 6);
  return major >= 8;
}

let skipLockedSupported;

async function getClaimLockClause(database) {
  if (skipLockedSupported !== undefined) return skipLockedSupported ? 'FOR UPDATE SKIP LOCKED' : 'FOR UPDATE';
  if (typeof database.query !== 'function') return 'FOR UPDATE';
  try {
    const [rows] = await database.query('SELECT VERSION() AS version');
    skipLockedSupported = supportsSkipLockedVersion(rows[0]?.version);
  } catch {
    skipLockedSupported = false;
  }
  return skipLockedSupported ? 'FOR UPDATE SKIP LOCKED' : 'FOR UPDATE';
}

export async function claimNextJob(database = pool) {
  const lockClause = await getClaimLockClause(database);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, job_type, payload, attempts
       FROM background_jobs
       WHERE (status = 'pending' AND available_at <= UTC_TIMESTAMP(3))
          OR (status = 'processing' AND locked_until <= UTC_TIMESTAMP(3))
       ORDER BY created_at ASC, id ASC
       LIMIT 1
       ${lockClause}`,
    );
    if (!rows.length) {
      await connection.commit();
      return null;
    }
    const job = rows[0];
    await connection.execute(
      `UPDATE background_jobs
       SET status = 'processing', attempts = attempts + 1,
           locked_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${JOB_LEASE_SECONDS} SECOND)
       WHERE id = ?`,
      [job.id],
    );
    await connection.commit();
    return { ...job, attempts: Number(job.attempts) + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function renewJobLease(jobId, database = pool) {
  const [result] = await database.execute(
    `UPDATE background_jobs
     SET locked_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${JOB_LEASE_SECONDS} SECOND)
     WHERE id = ? AND status = 'processing'`,
    [jobId],
  );
  return result.affectedRows > 0;
}

function startJobLeaseHeartbeat(jobId, database) {
  let active = true;
  let running = false;
  const timer = setInterval(async () => {
    if (!active || running) return;
    running = true;
    try {
      await renewJobLease(jobId, database);
    } catch (error) {
      console.warn('Background job lease renewal failed:', error.message);
    } finally {
      running = false;
    }
  }, JOB_HEARTBEAT_MS);
  timer.unref?.();
  return () => {
    active = false;
    clearInterval(timer);
  };
}

export async function processJob(job, database = pool, notify = notifyNewMessage) {
  const stopHeartbeat = startJobLeaseHeartbeat(job.id, database);
  try {
    const { table, id } = parseNotificationJob(job.job_type, job.payload);
    const [rows] = await database.execute(`SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [id]);
    if (rows.length) await notify(table, rows[0]);
    await database.execute(
      `UPDATE background_jobs
       SET status = 'completed', locked_until = NULL, completed_at = UTC_TIMESTAMP(3), last_error = NULL
       WHERE id = ?`,
      [job.id],
    );
  } catch (error) {
    const terminal = Number(job.attempts) >= MAX_ATTEMPTS;
    const delay = retryDelaySeconds(job.attempts);
    await database.execute(
      `UPDATE background_jobs
       SET status = ?, locked_until = NULL,
           available_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND),
           last_error = ?
       WHERE id = ?`,
      [terminal ? 'failed' : 'pending', delay, String(error?.message || error).slice(0, 1000), job.id],
    );
    console.warn(terminal ? 'Background job permanently failed:' : 'Background job will retry:', error?.message || error);
  } finally {
    stopHeartbeat();
  }
}

export async function pruneCompletedJobs(database = pool) {
  const [result] = await database.execute(
    "DELETE FROM background_jobs WHERE status = 'completed' AND completed_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)",
    [COMPLETED_JOB_RETENTION_DAYS],
  );
  return result.affectedRows;
}

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

export async function startBackgroundWorker() {
  if (!ENABLED) {
    await pool.execute('UPDATE background_job_settings SET enabled = FALSE WHERE id = 1').catch((error) => {
      console.warn('Could not disable background job publishing:', error.message);
    });
    return async () => {};
  }

  try {
    await pool.execute('SELECT id FROM background_jobs LIMIT 0');
    await pool.execute('UPDATE background_job_settings SET enabled = TRUE WHERE id = 1');
  } catch (error) {
    await pool.execute('UPDATE background_job_settings SET enabled = FALSE WHERE id = 1').catch(() => {});
    throw new Error(`Background jobs are enabled but the MariaDB job schema is unavailable. Run npm run db:migrate first. ${error.message}`);
  }

  const parsedInterval = Number(process.env.BACKGROUND_JOB_POLL_MS || 1000);
  const pollInterval = Number.isFinite(parsedInterval) ? Math.min(30000, Math.max(250, parsedInterval)) : 1000;
  let stopping = false;
  let nextCleanupAt = 0;
  const loop = (async () => {
    while (!stopping) {
      try {
        if (Date.now() >= nextCleanupAt) {
          await pruneCompletedJobs();
          nextCleanupAt = Date.now() + CLEANUP_INTERVAL_MS;
        }
        const job = await claimNextJob();
        if (job) await processJob(job);
        else await sleep(pollInterval);
      } catch (error) {
        console.warn('Background worker poll failed:', error.message);
        await sleep(pollInterval);
      }
    }
  })();

  return async () => {
    stopping = true;
    await pool.execute('UPDATE background_job_settings SET enabled = FALSE WHERE id = 1').catch((error) => {
      console.warn('Could not disable background job publishing during shutdown:', error.message);
    });
    await loop;
  };
}
