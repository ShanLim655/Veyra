import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import pg from 'pg';

dotenv.config({ path: ['.env.local', '.env'] });

// Database dialect selection. MariaDB stays the default; setting
// USE_MARIADB=false switches the whole API to PostgreSQL (plain TCP, no TLS —
// see docs/postgres.md). Every query in server/ is written against a small
// mysql2-compatible surface, so both drivers are normalized to the same
// `pool.query` / `pool.execute` / `pool.getConnection` contract and SQL is
// translated to PostgreSQL syntax at this single boundary.
export const dialect = String(process.env.USE_MARIADB ?? 'true').trim().toLowerCase() === 'false'
  ? 'postgres'
  : 'mariadb';
export const isPostgres = dialect === 'postgres';

const configuredPoolSize = Number(
  isPostgres
    ? process.env.POSTGRES_POOL_SIZE || process.env.MARIADB_POOL_SIZE || 1
    : process.env.MARIADB_POOL_SIZE || process.env.POSTGRES_POOL_SIZE || 1,
);
// Vercel creates multiple warm function instances. Keep each instance's
// connection footprint deliberately small for Layerbase's 20-client Free cap.
const connectionLimit = Number.isFinite(configuredPoolSize)
  ? Math.min(Math.max(Math.floor(configuredPoolSize), 1), 2)
  : 1;

// ---------------------------------------------------------------------------
// PostgreSQL support
// ---------------------------------------------------------------------------

// node-postgres returns int8/bigint, timestamps, and dates as JS types that
// do not match what mysql2 produces for the same columns. Normalize them so
// API responses stay identical across dialects:
//   int8        -> number        (mysql2 returns numbers for COUNT(*) etc.)
//   timestamp   -> 'YYYY-MM-DD HH:MM:SS.mmm' string (mysql2 DATETIME behavior)
//   timestamptz -> raw string
//   date        -> 'YYYY-MM-DD' string
if (isPostgres) {
  pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
  pg.types.setTypeParser(1114, (value) => value);
  pg.types.setTypeParser(1184, (value) => value);
  pg.types.setTypeParser(1082, (value) => value);
}

// Columns declared BOOLEAN in database/schema.postgres.sql. The API compares
// them against 0/1 literals in a few places; these are rewritten to FALSE/TRUE.
const BOOLEAN_COLUMNS = [
  'allow_friend_requests', 'announcement_custom_enabled', 'dm_custom_enabled',
  'enabled', 'global_custom_enabled', 'is_group', 'is_pinned',
  'multiple_choice', 'username_set',
];

// Conflict targets for `ON DUPLICATE KEY UPDATE` -> `ON CONFLICT ... DO UPDATE`.
// Keyed by table name; covers every unique constraint in schema.postgres.sql.
const UPSERT_CONFLICT = {
  admin_logs: 'id',
  announcement_messages: 'id',
  auth_email_tokens: 'token_hash',
  auth_identities: 'provider, provider_user_id',
  auth_native_codes: 'code_hash',
  auth_sessions: 'token_hash',
  auth_users: 'email',
  blocked_users: 'blocker_id, blocked_id',
  conversation_members: 'conversation_id, user_id',
  conversations: 'id',
  friend_requests: 'sender_id, receiver_id',
  global_messages: 'id',
  message_reactions: 'message_id, user_id, emoji',
  messages: 'id',
  native_push_tokens: 'id',
  notification_digest_state: 'user_id, channel_key',
  notification_preferences: 'user_id',
  notification_trigger_events: 'token',
  pinned_conversations: 'user_id, conversation_id',
  poll_options: 'id',
  poll_votes: 'poll_id, option_id, user_id',
  polls: 'id',
  profiles: 'id',
  user_roles: 'user_id, role',
};

const INTERVAL_UNITS = {
  SECOND: 'secs',
  MINUTE: 'mins',
  HOUR: 'hours',
  DAY: 'days',
  WEEK: 'weeks',
  MONTH: 'months',
  YEAR: 'years',
};

function intervalFn(unit, expr) {
  const arg = INTERVAL_UNITS[String(unit).toUpperCase()] || 'secs';
  return `make_interval(${arg} => ${expr})`;
}

// Rewrites the small set of MySQL-only syntax used across server/ into
// PostgreSQL. Runs before `?` -> `$n` binding; `?` placeholders are preserved.
// Exported for unit tests.
export function translateSql(sql) {
  let out = sql;

  // INSERT IGNORE -> INSERT ... ON CONFLICT DO NOTHING (appended at the end).
  const isInsertIgnore = /\bINSERT\s+IGNORE\s+INTO\b/i.test(out);
  out = out.replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');

  // ON DUPLICATE KEY UPDATE col = VALUES(col), ... -> ON CONFLICT ... DO UPDATE.
  out = out.replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*)$/i, (_match, tail) => {
    const table = /\bINSERT\s+INTO\s+[`"]?(\w+)[`"]?/i.exec(out)?.[1];
    const conflict = table ? UPSERT_CONFLICT[table] : null;
    if (!conflict) throw new Error(`No PostgreSQL upsert conflict target for table "${table || 'unknown'}".`);
    const assignments = tail.split(',').map((part) => {
      const valuesRef = part.match(/^\s*[`"]?(\w+)[`"]?\s*=\s*VALUES\(\s*[`"]?(\w+)[`"]?\s*\)\s*$/i);
      if (valuesRef) return `"${valuesRef[1]}" = EXCLUDED."${valuesRef[2]}"`;
      const bare = part.match(/^\s*[`"]?(\w+)[`"]?\s*=\s*(.+?)\s*$/);
      if (bare) return `"${bare[1]}" = ${bare[2]}`;
      throw new Error(`Unsupported upsert assignment: ${part.trim()}`);
    });
    return `ON CONFLICT (${conflict}) DO UPDATE SET ${assignments.join(', ')}`;
  });

  // DATE_ADD(expr, INTERVAL x UNIT) / DATE_SUB(expr, INTERVAL x UNIT)
  for (const [fn, sign] of [['DATE_ADD', '+'], ['DATE_SUB', '-']]) {
    const pattern = new RegExp(`\\b${fn}\\(\\s*([^,]+?)\\s*,\\s*INTERVAL\\s+(.+?)\\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)s?\\s*\\)`, 'gi');
    out = out.replace(pattern, (_m, expr, amount, unit) => `(${expr.trim()} ${sign} ${intervalFn(unit, amount.trim())})`);
  }

  // Standalone INTERVAL x UNIT (e.g. `NOW() - INTERVAL 1 DAY`).
  out = out.replace(/\bINTERVAL\s+([?$][\w.]*|\d+(?:\.\d+)?|[a-zA-Z_]\w*)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)s?\b/gi,
    (_m, amount, unit) => intervalFn(unit, amount));

  // Temporal functions -> NOW() (session timezone is pinned to UTC).
  out = out.replace(/\bUTC_TIMESTAMP\s*\(\s*\d*\s*\)/gi, 'NOW()');
  out = out.replace(/\bCURRENT_TIMESTAMP\s*\(\s*\d*\s*\)/gi, 'NOW()');
  out = out.replace(/\bCURRENT_DATE\s*\(\s*\)/gi, 'CURRENT_DATE');
  out = out.replace(/\bDATE\s*\(([^()]*)\)/g, '($1)::date');

  // MySQL JSON helpers -> PostgreSQL jsonb equivalents (same arg shape).
  out = out.replace(/\bJSON_ARRAYAGG\s*\(/gi, 'JSONB_AGG(');
  out = out.replace(/\bJSON_OBJECT\s*\(/gi, 'JSONB_BUILD_OBJECT(');

  // Boolean column comparisons written as = 0 / = 1.
  for (const column of BOOLEAN_COLUMNS) {
    out = out.replace(new RegExp(`\\b${column}\\s*=\\s*0\\b`, 'g'), `${column} = FALSE`);
    out = out.replace(new RegExp(`\\b${column}\\s*=\\s*1\\b`, 'g'), `${column} = TRUE`);
  }

  // MySQL identifier quoting -> ANSI double quotes.
  out = out.replace(/`([^`]+)`/g, '"$1"');

  if (isInsertIgnore) out += ' ON CONFLICT DO NOTHING';
  return out;
}

// Replaces `?` placeholders with $1..$n, skipping string literals and comments.
// Exported for unit tests.
export function bindParams(sql) {
  let index = 0;
  let out = '';
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) { out += sql[++i]; } else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '?') { out += `$${++index}`; continue; }
    out += ch;
  }
  return out;
}

const SHOW_COLUMNS = /^\s*SHOW\s+COLUMNS\s+FROM\s+[`"]?(\w+)[`"]?\s*$/i;

async function showColumnsPg(client, table) {
  const { rows } = await client.query(
    `SELECT column_name AS "Field", data_type AS "Type"
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

function shapeResult(result) {
  // pg returns an array of results for multi-statement simple queries.
  const res = Array.isArray(result) ? result[result.length - 1] : result;
  if (!res || typeof res !== 'object') return [[], undefined];
  const command = String(res.command || '').toUpperCase();
  if (command === 'SELECT' || command === 'SHOW') return [res.rows || [], res.fields];
  // mysql2 returns a ResultSetHeader for writes; mimic affectedRows/insertId.
  const affected = res.rowCount ?? (res.rows ? res.rows.length : 0);
  return [{ affectedRows: affected, changedRows: affected, insertId: null }, res.fields];
}

const PG_ERROR_CODES = {
  '23505': 'ER_DUP_ENTRY',
  '23503': 'ER_NO_REFERENCED_ROW_2',
  '23502': 'ER_BAD_NULL_ERROR',
  '23514': 'ER_CHECK_CONSTRAINT_VIOLATED',
  '42P01': 'ER_NO_SUCH_TABLE',
  '42703': 'ER_BAD_FIELD_ERROR',
  '22P02': 'ER_WRONG_VALUE',
  '40P01': 'ER_LOCK_DEADLOCK',
};

function normalizePgError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    error.code = PG_ERROR_CODES[error.code] || `ER_PG_${error.code}`;
  }
  return error;
}

function pgConfig() {
  return {
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    // Plain TCP only — TLS is intentionally not used for PostgreSQL.
    ssl: false,
    max: connectionLimit,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 30000,
    allowExitOnIdle: false,
    // All DATETIME columns are UTC; pin the session timezone so NOW() and
    // timestamp casts behave exactly like mysql2's `timezone: 'Z'`.
    options: '-c timezone=UTC',
  };
}

async function runPg(client, sql, params) {
  const showMatch = SHOW_COLUMNS.exec(sql);
  if (showMatch) return [await showColumnsPg(client, showMatch[1]), undefined];
  const translated = bindParams(translateSql(sql));
  const values = Array.isArray(params) ? params.map((value) => (value === undefined ? null : value)) : params;
  try {
    const result = await client.query(translated, values);
    return shapeResult(result);
  } catch (error) {
    throw normalizePgError(error);
  }
}

function createPgPool() {
  const pgPool = new pg.Pool(pgConfig());
  pgPool.on('error', (error) => console.error('PostgreSQL pool error:', error.message));

  // Pin each physical connection's timezone to UTC. The startup `options`
  // parameter already does this; the awaited SET is a fallback for hosts that
  // ignore it. It must be awaited on first checkout — firing it un-awaited
  // from the pool 'connect' event triggers pg's "client already executing a
  // query" deprecation and can interleave with the caller's first real query.
  const utcInitialized = new WeakSet();
  const acquireClient = async () => {
    const client = await pgPool.connect();
    if (!utcInitialized.has(client)) {
      await client.query("SET TIME ZONE 'UTC'").catch(() => {});
      utcInitialized.add(client);
    }
    return client;
  };

  const query = async (sql, params) => {
    const client = await acquireClient();
    try {
      return await runPg(client, sql, params);
    } finally {
      client.release();
    }
  };
  const execute = query;

  const getConnection = async () => {
    const client = await acquireClient();
    return {
      query: (sql, params) => runPg(client, sql, params),
      execute: (sql, params) => runPg(client, sql, params),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
    };
  };

  return {
    query,
    execute,
    getConnection,
    end: () => pgPool.end(),
  };
}

export const pool = isPostgres
  ? createPgPool()
  : mysql.createPool({
      host: process.env.MARIADB_HOST || '127.0.0.1',
      port: Number(process.env.MARIADB_PORT || 3306),
      user: process.env.MARIADB_USER,
      password: process.env.MARIADB_PASSWORD,
      database: process.env.MARIADB_DATABASE,
      waitForConnections: true,
      connectionLimit,
      maxIdle: 1,
      idleTimeout: 5000,
      connectTimeout: 30000,
      queueLimit: 50,
      ssl: process.env.MARIADB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      charset: 'utf8mb4',
      timezone: 'Z',
      decimalNumbers: true,
    });
