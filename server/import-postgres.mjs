import pg from 'pg';
import { pool } from './db.mjs';

const { Pool } = pg;
const sourceUrl = process.env.LEGACY_POSTGRES_URL;
if (!sourceUrl) throw new Error('Set LEGACY_POSTGRES_URL to the existing Supabase PostgreSQL connection string.');

const tables = [
  'profiles', 'user_roles', 'conversations', 'conversation_members', 'friend_requests',
  'blocked_users', 'messages', 'global_messages', 'announcement_messages', 'message_reactions',
  'pinned_conversations', 'polls', 'poll_options', 'poll_votes', 'notification_preferences',
  'notification_digest_state', 'notification_trigger_events', 'native_push_tokens', 'admin_logs',
];
const source = new Pool({ connectionString: sourceUrl, ssl: { rejectUnauthorized: false } });
const target = await pool.getConnection();

function serialize(value) {
  if (value instanceof Date || Buffer.isBuffer(value) || value === null || value === undefined) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

try {
  await target.beginTransaction();
  await target.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of tables) {
    const [targetColumns] = await target.query(`SHOW COLUMNS FROM \`${table}\``);
    const allowed = new Set(targetColumns.map((column) => column.Field));
    const { rows } = await source.query(`SELECT * FROM public."${table}"`);
    let imported = 0;
    for (const row of rows) {
      const fields = Object.keys(row).filter((field) => allowed.has(field));
      if (!fields.length) continue;
      await target.execute(
        `INSERT INTO \`${table}\` (${fields.map((field) => `\`${field}\``).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        fields.map((field) => serialize(row[field])),
      );
      imported++;
    }
    console.log(`${table}: imported ${imported} rows`);
  }
  await target.commit();
  console.log('Import complete.');
} catch (error) {
  await target.rollback();
  throw error;
} finally {
  await target.query('SET FOREIGN_KEY_CHECKS = 1');
  target.release();
  await source.end();
  await pool.end();
}
