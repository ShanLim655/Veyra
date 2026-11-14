import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dialect, pool } from './db.mjs';

const schemaFile = dialect === 'postgres' ? 'schema.postgres.sql' : 'schema.sql';
const schemaPath = new URL(`../database/${schemaFile}`, import.meta.url);
const schema = await readFile(fileURLToPath(schemaPath), 'utf8');

try {
  if (dialect === 'postgres') {
    // node-postgres executes multi-statement scripts in one simple query,
    // which also keeps dollar-quoted function bodies intact.
    await pool.query(schema);
    console.log('Applied PostgreSQL schema (database/schema.postgres.sql).');
  } else {
    const statements = schema
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.replace(/^\s*(?:--[^\r\n]*\r?\n\s*)*/g, '').trim())
      .filter(Boolean);
    for (const statement of statements) await pool.query(statement);
    console.log(`Applied ${statements.length} MariaDB schema statements.`);
  }
} finally {
  await pool.end();
}
