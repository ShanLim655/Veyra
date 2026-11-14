// One-shot MariaDB -> PostgreSQL data migration.
//
// Reads every table from the MariaDB database (MARIADB_* env) and copies it
// into the PostgreSQL database (POSTGRES_* env), applying database/
// schema.postgres.sql first so the target structure exists.
//
// Usage:
//   npm run db:migrate:postgres                # apply schema + copy data
//   npm run db:migrate:postgres -- --dry-run   # report row counts only
//   npm run db:migrate:postgres -- --fresh     # TRUNCATE target tables first
//   npm run db:migrate:postgres -- --no-schema # skip applying the pg schema
//
// Inserts use ON CONFLICT DO NOTHING, so re-running is safe: rows already
// present in PostgreSQL are skipped rather than duplicated.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'] });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.postgres.sql');
const BATCH_SIZE = 250;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FRESH = args.has('--fresh');
const NO_SCHEMA = args.has('--no-schema');

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// Source: MariaDB. `dateStrings` keeps DATETIME(3) values as raw
// 'YYYY-MM-DD HH:MM:SS.mmm' strings so no timezone interpretation happens on
// either side — PostgreSQL TIMESTAMP(3) stores them verbatim.
// ---------------------------------------------------------------------------
const source = await mysql.createConnection({
  host: requireEnv('MARIADB_HOST'),
  port: Number(process.env.MARIADB_PORT || 3306),
  user: requireEnv('MARIADB_USER'),
  password: requireEnv('MARIADB_PASSWORD'),
  database: requireEnv('MARIADB_DATABASE'),
  dateStrings: true,
  charset: 'utf8mb4',
});

// ---------------------------------------------------------------------------
// Target: PostgreSQL — plain TCP, no TLS (matches the app's pg pool config).
// ---------------------------------------------------------------------------
const target = new pg.Client({
  host: requireEnv('POSTGRES_HOST'),
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: requireEnv('POSTGRES_USER'),
  password: requireEnv('POSTGRES_PASSWORD'),
  database: requireEnv('POSTGRES_DATABASE'),
  connectionTimeoutMillis: 15000,
});

await target.connect();
await target.query("SET TIME ZONE 'UTC'");

// Table copy order = CREATE TABLE order in schema.postgres.sql, which is
// already FK-safe (parents before children).
const schemaSql = await readFile(SCHEMA_PATH, 'utf8');
const TABLES = [...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
if (!TABLES.length) throw new Error(`No tables found in ${SCHEMA_PATH}`);

// Column types per table, used to convert MariaDB values for PostgreSQL.
// tinyint(1) -> boolean, json -> jsonb (string passthrough), datetime strings
// pass through untouched, everything else is sent as-is.
async function columnTypes(table) {
  const [cols] = await source.query(`SHOW COLUMNS FROM \`${table}\``);
  const types = new Map();
  for (const col of cols) types.set(col.Field, String(col.Type).toLowerCase());
  return types;
}

function convertValue(value, type) {
  if (value === null || value === undefined) return null;
  if (type.startsWith('tinyint')) return value === 1 || value === '1' || value === true ? true : value === 0 || value === '0' || value === false ? false : Boolean(value);
  if (type === 'json') {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }
  return value;
}

async function applySchema() {
  // pg simple-query protocol handles the multi-statement schema file.
  await target.query(schemaSql);
  console.log(`Applied ${SCHEMA_PATH}`);
}

async function tableExistsPg(table) {
  const { rows } = await target.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1',
    [table],
  );
  return rows.length > 0;
}

async function rowCountPg(table) {
  const { rows } = await target.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  return rows[0].n;
}

async function truncateAll() {
  // Children before parents so FK constraints don't block the truncate.
  for (const table of [...TABLES].reverse()) {
    await target.query(`TRUNCATE TABLE "${table}" CASCADE`);
  }
  console.log('Truncated all target tables (--fresh).');
}

async function copyTable(table) {
  const types = await columnTypes(table);
  const columns = [...types.keys()];
  const colList = columns.map((c) => `"${c}"`).join(', ');

  const [sourceCountRows] = await source.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  const sourceCount = Number(sourceCountRows[0].n);
  if (!sourceCount) {
    console.log(`  ${table}: 0 rows (skipped)`);
    return { table, source: 0, inserted: 0 };
  }

  const exists = await tableExistsPg(table);
  if (DRY_RUN) {
    const targetCount = exists ? await rowCountPg(table) : 0;
    console.log(`  ${table}: ${sourceCount} source rows, ${exists ? targetCount : 'target missing'} in postgres`);
    return { table, source: sourceCount, inserted: 0 };
  }

  if (!exists) {
    throw new Error(`Target table "${table}" does not exist — did the schema apply?`);
  }

  let inserted = 0;
  let offset = 0;

  for (;;) {
    const [rows] = await source.query(
      `SELECT * FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
    );
    if (!rows.length) break;

    const values = [];
    const params = [];
    const tuples = rows.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(convertValue(row[col], types.get(col)));
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const { rowCount } = await target.query(
      `INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
    inserted += rowCount ?? 0;
    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`  ${table}: ${sourceCount} source rows -> ${inserted} inserted`);
  return { table, source: sourceCount, inserted };
}

try {
  console.log(`Source: ${process.env.MARIADB_HOST}:${process.env.MARIADB_PORT || 3306}/${process.env.MARIADB_DATABASE}`);
  console.log(`Target: ${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DATABASE}`);
  if (DRY_RUN) console.log('Mode: DRY RUN (no writes)');
  if (FRESH) console.log('Mode: FRESH (target tables truncated first)');

  if (!NO_SCHEMA && !DRY_RUN) await applySchema();
  if (FRESH && !DRY_RUN) await truncateAll();

  const results = [];
  for (const table of TABLES) {
    results.push(await copyTable(table));
  }

  // Verification pass: source vs target row counts. In dry-run mode this is
  // informational only (nothing was written), so mismatches don't fail.
  console.log('\nVerification:');
  let mismatches = 0;
  for (const { table, source: src } of results) {
    const dst = await rowCountPg(table).catch(() => 0);
    const ok = DRY_RUN ? dst >= 0 : dst >= src;
    if (!ok) mismatches++;
    console.log(`  ${ok ? 'OK ' : 'FAIL'} ${table}: source=${src} target=${dst}`);
  }
  if (mismatches && !DRY_RUN) {
    console.error(`\n${mismatches} table(s) have fewer rows in PostgreSQL than MariaDB.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll tables verified.');
  }
} finally {
  await source.end().catch(() => {});
  await target.end().catch(() => {});
}
