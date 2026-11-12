// One-off migration: encrypt existing plaintext message content in MariaDB.
//
// Usage:
//   npm run db:encrypt:messages          # encrypt all plaintext rows
//   node server/encrypt-messages.mjs --dry-run   # count rows only, no writes
//
// Requires MESSAGE_ENCRYPTION_KEY (and optionally MESSAGE_ENCRYPTION_KEY_-
// PREVIOUS for verification only) in .env.local / the environment. The script
// is idempotent: values already carrying the "veyra:v1:" prefix are skipped,
// so it is safe to re-run. Each row is updated with an optimistic
// `AND field = <old value>` guard so a message edited while the migration runs
// is left untouched and picked up on the next run.
import { pool } from './db.mjs';
import {
  ENCRYPTED_VALUE_PREFIX,
  assertEncryptionConfig,
  encryptField,
  encryptionEnabled,
} from './encryption.mjs';

const TARGETS = [
  { table: 'messages', field: 'content' },
  { table: 'global_messages', field: 'content' },
  { table: 'announcement_messages', field: 'content' },
  { table: 'polls', field: 'question' },
];

const BATCH_SIZE = Math.min(Math.max(Number(process.env.ENCRYPT_BATCH_SIZE) || 500, 1), 5000);
const dryRun = process.argv.includes('--dry-run');

function pendingWhere(field) {
  return `\`${field}\` IS NOT NULL AND \`${field}\` <> '' AND \`${field}\` NOT LIKE ?`;
}

async function countPending(table, field) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${pendingWhere(field)}`,
    [`${ENCRYPTED_VALUE_PREFIX}%`],
  );
  return Number(rows[0]?.total || 0);
}

async function migrateTable(table, field) {
  const total = await countPending(table, field);
  if (dryRun) {
    console.log(`${table}.${field}: ${total} plaintext row(s) would be encrypted.`);
    return { scanned: 0, encrypted: 0, skipped: 0, remaining: total };
  }
  console.log(`${table}.${field}: ${total} plaintext row(s) to encrypt.`);

  let scanned = 0;
  let encrypted = 0;
  let skipped = 0;
  for (;;) {
    const [rows] = await pool.query(
      `SELECT id, \`${field}\` AS value FROM \`${table}\` WHERE ${pendingWhere(field)} LIMIT ?`,
      [`${ENCRYPTED_VALUE_PREFIX}%`, BATCH_SIZE],
    );
    if (!rows.length) break;
    scanned += rows.length;
    for (const row of rows) {
      const encryptedValue = encryptField(row.value);
      const [result] = await pool.query(
        `UPDATE \`${table}\` SET \`${field}\` = ? WHERE id = ? AND \`${field}\` = ?`,
        [encryptedValue, row.id, row.value],
      );
      if (result.affectedRows > 0) encrypted += 1;
      else skipped += 1;
    }
    console.log(`  ${table}.${field}: ${encrypted}/${total} encrypted (${scanned} scanned)`);
  }
  const remaining = await countPending(table, field);
  return { scanned, encrypted, skipped, remaining };
}

try {
  assertEncryptionConfig();
  if (!encryptionEnabled()) {
    console.error('MESSAGE_ENCRYPTION_KEY is not set. Set it before running this migration.');
    process.exitCode = 1;
  } else {
    console.log(dryRun ? 'Dry run — no rows will be modified.' : 'Encrypting plaintext message content…');
    const summary = {};
    for (const { table, field } of TARGETS) {
      summary[`${table}.${field}`] = await migrateTable(table, field);
    }
    console.log('Done.', JSON.stringify(summary, null, 2));
    const leftover = Object.values(summary).reduce((sum, entry) => sum + entry.remaining, 0);
    if (leftover > 0) {
      console.warn(`${leftover} row(s) still pending — re-run the script to finish (concurrently edited rows are retried).`);
    }
  }
} catch (error) {
  console.error('Encryption migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
