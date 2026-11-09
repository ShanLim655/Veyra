import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';

const schemaPath = new URL('../database/schema.sql', import.meta.url);
const schema = await readFile(fileURLToPath(schemaPath), 'utf8');
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.replace(/^\s*(?:--[^\r\n]*\r?\n\s*)*/g, '').trim())
  .filter(Boolean);

try {
  for (const statement of statements) await pool.query(statement);
  console.log(`Applied ${statements.length} MariaDB schema statements.`);
} finally {
  await pool.end();
}
