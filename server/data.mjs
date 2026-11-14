import { randomUUID } from 'node:crypto';
import { pool, isPostgres } from './db.mjs';
import { ensureDirectMessage } from './rpc.mjs';
import { notifyNewMessage } from './notifications.mjs';
import { cachedRead, invalidateReadCache } from './redis.mjs';
import { decryptRowsForTable, encryptRowForTable } from './encryption.mjs';

const TABLES = new Set([
  'admin_logs', 'announcement_messages', 'blocked_users', 'conversation_members',
  'conversations', 'friend_requests', 'global_messages', 'message_reactions',
  'messages', 'native_push_tokens', 'notification_digest_state',
  'notification_preferences', 'notification_trigger_events', 'pinned_conversations',
  'poll_options', 'poll_votes', 'polls', 'profiles', 'user_roles',
]);
const columnCache = new Map();

async function columnsFor(table) {
  if (!TABLES.has(table)) throw new Error('Unknown table.');
  if (!columnCache.has(table)) {
    const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
    columnCache.set(table, new Map(rows.map((row) => [row.Field, row.Type])));
  }
  return columnCache.get(table);
}

function identifier(value, columns) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) || !columns.has(value)) {
    throw new Error(`Unsupported column: ${value}`);
  }
  return `\`${value}\``;
}

function normalizeTemporalValue(value, columnType) {
  // PostgreSQL BOOLEAN columns reject integer 0/1 params; coerce them while
  // MariaDB tinyint(1) columns keep accepting raw values.
  if (isPostgres && /^boolean$/i.test(columnType || '') && value !== null && value !== undefined) {
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
  }
  if (value == null || typeof value !== 'string' || !/^(?:date|datetime|timestamp)\b/i.test(columnType || '')) return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date or time value.');
  const iso = parsed.toISOString();
  if (/^date\b/i.test(columnType) && !/^datetime\b/i.test(columnType)) return iso.slice(0, 10);
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

function normalizeRowTemporalValues(row, columns) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    normalizeTemporalValue(value, columns.get(key)),
  ]));
}

async function isAdmin(userId) {
  const [rows] = await pool.execute(
    "SELECT role FROM user_roles WHERE user_id = ? AND role IN ('admin','super_admin') LIMIT 1",
    [userId],
  );
  return rows.length > 0;
}

async function isSuperAdmin(userId) {
  const [rows] = await pool.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin' LIMIT 1", [userId]);
  return rows.length > 0;
}

function membershipExists(userId, conversationColumn = 'conversation_id') {
  return `EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = t.${conversationColumn} AND cm.user_id = ?)`;
}

async function policy(table, userId, operation) {
  const admin = await isAdmin(userId);
  const owner = {
    profiles: ['id'], user_roles: ['user_id'], friend_requests: ['sender_id', 'receiver_id'],
    blocked_users: ['blocker_id'], pinned_conversations: ['user_id'],
    notification_preferences: ['user_id'], notification_digest_state: ['user_id'],
    native_push_tokens: ['user_id'],
  };

  if (table === 'notification_trigger_events') return { sql: '1 = 0', args: [] };
  if (table === 'admin_logs') return admin
    ? { sql: operation === 'insert' ? '1 = 1' : '1 = 1', args: [] }
    : { sql: '1 = 0', args: [] };
  if (table === 'profiles') return operation === 'select'
    ? { sql: '1 = 1', args: [] }
    : { sql: 'id = ?', args: [userId] };
  if (table === 'user_roles') return await isSuperAdmin(userId)
    ? { sql: '1 = 1', args: [] }
    : { sql: 'user_id = ?', args: [userId] };
  if (table === 'announcement_messages') return operation === 'select' || admin
    ? { sql: '1 = 1', args: [] }
    : { sql: '1 = 0', args: [] };
  if (table === 'global_messages' && operation === 'select') return { sql: '1 = 1', args: [] };
  if (table === 'global_messages') return admin
    ? { sql: '1 = 1', args: [] }
    : { sql: 'sender_id = ?', args: [userId] };
  if (table === 'conversations') {
    if (operation === 'insert') return { sql: 'created_by = ?', args: [userId] };
    if (admin) return { sql: '1 = 1', args: [] };
    if (operation === 'select') return { sql: membershipExists(userId), args: [userId] };
    return { sql: `EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = t.id AND cm.user_id = ? AND cm.role IN ('owner','admin'))`, args: [userId] };
  }
  if (table === 'conversation_members') {
    if (operation === 'insert') return admin
      ? { sql: '1 = 1', args: [] }
      : { sql: `(user_id = ? AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = t.conversation_id AND c.created_by = ?)) OR EXISTS (SELECT 1 FROM conversation_members mine WHERE mine.conversation_id = t.conversation_id AND mine.user_id = ? AND mine.role IN ('owner','admin'))`, args: [userId, userId, userId] };
    if (admin) return { sql: '1 = 1', args: [] };
    if (operation === 'select') return { sql: `(${membershipExists(userId)} OR user_id = ?)`, args: [userId, userId] };
    return { sql: `EXISTS (SELECT 1 FROM conversation_members mine WHERE mine.conversation_id = t.conversation_id AND mine.user_id = ? AND mine.role IN ('owner','admin'))`, args: [userId] };
  }
  if (table === 'friend_requests') {
    if (admin) return { sql: '1 = 1', args: [] };
    if (operation === 'select' || operation === 'delete') return { sql: '(sender_id = ? OR receiver_id = ?)', args: [userId, userId] };
    return { sql: operation === 'insert' ? 'sender_id = ?' : 'receiver_id = ?', args: [userId] };
  }
  if (table === 'messages') return admin
    ? { sql: '1 = 1', args: [] }
    : operation === 'select'
      ? { sql: membershipExists(userId), args: [userId] }
      : { sql: `sender_id = ? AND ${membershipExists(userId)}`, args: [userId, userId] };
  if (table === 'message_reactions') {
    if (admin) return { sql: '1 = 1', args: [] };
    return operation === 'select'
      ? { sql: `EXISTS (SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id WHERE m.id = t.message_id AND cm.user_id = ?)`, args: [userId] }
      : { sql: 'user_id = ?', args: [userId] };
  }
  if (table === 'polls') {
    if (admin) return { sql: '1 = 1', args: [] };
    return operation === 'select'
      ? { sql: `(conversation_id IS NULL OR ${membershipExists(userId)})`, args: [userId] }
      : { sql: 'created_by = ?', args: [userId] };
  }
  if (table === 'poll_options' || table === 'poll_votes') {
    if (admin) return { sql: '1 = 1', args: [] };
    if (table === 'poll_votes' && operation !== 'select') return { sql: 'user_id = ?', args: [userId] };
    const extra = table === 'poll_options' && operation !== 'select' ? ' AND p.created_by = ?' : '';
    return { sql: `EXISTS (SELECT 1 FROM polls p WHERE p.id = t.poll_id AND (p.conversation_id IS NULL OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = p.conversation_id AND cm.user_id = ?))${extra})`, args: extra ? [userId, userId] : [userId] };
  }
  if (table === 'friend_requests') return { sql: '(sender_id = ? OR receiver_id = ?)', args: [userId, userId] };
  if (owner[table]) {
    const cols = owner[table];
    return { sql: admin && table === 'user_roles' ? '1 = 1' : `(${cols.map((col) => `${col} = ?`).join(' OR ')})`, args: admin && table === 'user_roles' ? [] : cols.map(() => userId) };
  }
  return { sql: '1 = 0', args: [] };
}

function filterSql(filters, columns) {
  const parts = [];
  const args = [];
  for (const filter of filters || []) {
    const col = identifier(filter.column, columns);
    switch (filter.op) {
      case 'eq': parts.push(`${col} = ?`); args.push(normalizeTemporalValue(filter.value, columns.get(filter.column))); break;
      case 'neq': parts.push(`${col} <> ?`); args.push(normalizeTemporalValue(filter.value, columns.get(filter.column))); break;
      case 'gt': parts.push(`${col} > ?`); args.push(normalizeTemporalValue(filter.value, columns.get(filter.column))); break;
      case 'gte': parts.push(`${col} >= ?`); args.push(normalizeTemporalValue(filter.value, columns.get(filter.column))); break;
      case 'lt': parts.push(`${col} < ?`); args.push(normalizeTemporalValue(filter.value, columns.get(filter.column))); break;
      case 'lte': parts.push(`${col} <= ?`); args.push(normalizeTemporalValue(filter.value, columns.get(filter.column))); break;
      case 'in': {
        if (!Array.isArray(filter.value) || !filter.value.length) parts.push('1 = 0');
        else {
          parts.push(`${col} IN (${filter.value.map(() => '?').join(',')})`);
          args.push(...filter.value.map((value) => normalizeTemporalValue(value, columns.get(filter.column))));
        }
        break;
      }
      case 'is':
        if (filter.value === null) {
          parts.push(`${col} IS NULL`);
        } else if (isPostgres) {
          // `IS ?` is not valid PostgreSQL; IS NOT DISTINCT FROM covers all types.
          parts.push(`${col} IS NOT DISTINCT FROM ?`);
          args.push(normalizeTemporalValue(filter.value, columns.get(filter.column)));
        } else {
          parts.push(`${col} IS ?`);
          args.push(normalizeTemporalValue(filter.value, columns.get(filter.column)));
        }
        break;
      case 'ilike': parts.push(`LOWER(${col}) LIKE LOWER(?)`); args.push(String(filter.value).replaceAll('*', '%')); break;
      default: throw new Error(`Unsupported filter: ${filter.op}`);
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', args };
}

function parseOr(raw, columns) {
  if (!raw) return { sql: '', args: [] };
  const clauses = String(raw).split(',');
  const args = [];
  const sql = clauses.map((clause) => {
    const match = clause.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|neq|ilike)\.(.*)$/);
    if (!match) throw new Error('Unsupported OR filter.');
    const col = identifier(match[1], columns);
    const op = match[2];
    const value = match[3];
    if (op === 'ilike') { args.push(value.replaceAll('*', '%')); return `LOWER(${col}) LIKE LOWER(?)`; }
    args.push(normalizeTemporalValue(value, columns.get(match[1])));
    return `${col} ${op === 'eq' ? '=' : '<>'} ?`;
  });
  return { sql: `(${sql.join(' OR ')})`, args };
}

function selection(select, columns) {
  const value = select || '*';
  if (value.trim() === '*') return '*';
  return value.split(',').map((part) => identifier(part.trim(), columns)).join(', ');
}

async function queryDataUncached(userId, payload) {
  const { table, operation = 'select' } = payload || {};
  const columns = await columnsFor(table);
  if (!['select', 'insert', 'update', 'delete', 'upsert'].includes(operation)) throw new Error('Unsupported operation.');
  const requested = selection(payload.columns, columns);
  const filters = filterSql(payload.filters, columns);
  const or = parseOr(payload.or, columns);
  const where = [filters.sql, ...(or.sql ? [or.sql] : [])];
  const filterArgs = [...filters.args, ...or.args];
  const access = await policy(table, userId, operation);
  const whereSql = [...where, `(${access.sql})`].join(' AND ');
  const whereArgs = [...filterArgs, ...access.args];

  if (operation === 'select') {
    const countRequested = payload.count === 'exact';
    let count = null;
    if (countRequested) {
      const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM \`${table}\` t WHERE ${whereSql}`, whereArgs);
      count = Number(countRows[0]?.total || 0);
    }
    if (payload.head) return { data: null, count };
    const order = (payload.order || []).map(({ column, ascending }) => `${identifier(column, columns)} ${ascending === false ? 'DESC' : 'ASC'}`).join(', ');
    const limit = Math.min(Math.max(Number(payload.limit ?? 100), 0), 500);
    const offset = Math.max(Number(payload.offset || 0), 0);
    const [rows] = await pool.execute(
      `SELECT ${requested} FROM \`${table}\` t WHERE ${whereSql}${order ? ` ORDER BY ${order}` : ''} LIMIT ${limit} OFFSET ${offset}`,
      whereArgs,
    );
    return { data: payload.single ? rows[0] ?? null : rows, count };
  }

  if (operation === 'insert' || operation === 'upsert') {
    const inputRows = (Array.isArray(payload.values) ? payload.values : [payload.values]).filter(Boolean);
    if (!inputRows.length) return { data: [], count: 0 };
    const inserted = [];
    for (const input of inputRows) {
      const row = { ...input };
      if (columns.has('id') && !row.id) row.id = randomUUID();
      if (!await canInsert(table, row, userId, access)) throw new Error('Not allowed to insert this row.');
      if (table === 'poll_votes') {
        const [polls] = await pool.execute('SELECT multiple_choice FROM polls WHERE id = ? AND closed_at IS NULL AND ends_at > CURRENT_TIMESTAMP(3)', [row.poll_id]);
        if (!polls.length) throw new Error('This poll is closed.');
        if (!polls[0].multiple_choice) await pool.execute('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_id <> ?', [row.poll_id, row.user_id, row.option_id]);
      }
      const normalizedRow = normalizeRowTemporalValues(row, columns);
      const storedRow = encryptRowForTable(table, normalizedRow);
      const keys = Object.keys(storedRow);
      for (const key of keys) identifier(key, columns);
      if (!keys.length) throw new Error('Insert data is empty.');
      const updateKeys = operation === 'upsert' ? keys.filter((key) => key !== 'id' && key !== 'user_id') : [];
      const [result] = await pool.execute(
        `INSERT INTO \`${table}\` (${keys.map((key) => `\`${key}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})${operation === 'upsert' && updateKeys.length ? ` ON DUPLICATE KEY UPDATE ${updateKeys.map((key) => `\`${key}\` = VALUES(\`${key}\`)`).join(', ')}` : ''}`,
        keys.map((key) => storedRow[key]),
      );
      inserted.push(row.id ?? row.user_id ?? result.insertId);
    }
    const rows = operation === 'upsert' && table === 'friend_requests'
      ? await fetchUpsertedFriendRequests(inputRows, requested)
      : await fetchByIds(table, inserted, requested, columns);
    if (['messages', 'global_messages', 'announcement_messages'].includes(table)) {
      for (const row of inputRows) void notifyNewMessage(table, row).catch((error) => console.error('Notification delivery failed:', error));
    }
    return { data: payload.single ? rows[0] ?? null : rows, count: rows.length };
  }

  if (operation === 'update') {
    const patch = encryptRowForTable(table, normalizeRowTemporalValues(payload.values || {}, columns));
    const keys = Object.keys(patch);
    for (const key of keys) identifier(key, columns);
    if (!keys.length) return { data: [], count: 0 };
    const protectedColumns = new Set(['id']);
    const protectedByTable = {
      profiles: ['id'], user_roles: ['user_id'], conversations: ['created_by', 'is_group'],
      conversation_members: ['conversation_id', 'user_id', 'role'], friend_requests: ['sender_id', 'receiver_id'],
      messages: ['conversation_id', 'sender_id'], global_messages: ['sender_id'],
      announcement_messages: ['sender_id'], message_reactions: ['message_id', 'user_id'],
      blocked_users: ['blocker_id', 'blocked_id'], pinned_conversations: ['user_id', 'conversation_id'],
      polls: ['created_by', 'conversation_id'], poll_options: ['poll_id'],
      poll_votes: ['poll_id', 'option_id', 'user_id'], notification_preferences: ['user_id'],
      notification_digest_state: ['user_id', 'channel_key'], native_push_tokens: ['user_id'],
    };
    for (const column of protectedByTable[table] || []) protectedColumns.add(column);
    if (keys.some((key) => protectedColumns.has(key))) throw new Error('This field cannot be changed.');
    const friendRows = table === 'friend_requests' && patch.status === 'accepted'
      ? (await pool.execute(`SELECT sender_id, receiver_id FROM \`${table}\` t WHERE ${whereSql}`, whereArgs))[0]
      : [];
    const [result] = await pool.execute(`UPDATE \`${table}\` t SET ${keys.map((key) => `\`${key}\` = ?`).join(', ')} WHERE ${whereSql}`, [...keys.map((key) => patch[key]), ...whereArgs]);
    for (const friendship of friendRows) await ensureDirectMessage(friendship.sender_id, friendship.receiver_id);
    return { data: payload.returning ? await fetchSelection(table, requested, whereSql, whereArgs) : null, count: result.affectedRows };
  }

  if (operation === 'delete') {
    const realtimeColumns = ['id', 'user_id', 'conversation_id', 'message_id', 'poll_id', 'option_id', 'sender_id', 'receiver_id', 'blocker_id', 'blocked_id', 'group_id']
      .filter((column) => columns.has(column));
    const [rows] = await pool.execute(`SELECT ${realtimeColumns.map((column) => `t.\`${column}\``).join(', ')} FROM \`${table}\` t WHERE ${whereSql}`, whereArgs);
    if (!rows.length) return { data: payload.returning ? [] : null, count: 0 };
    const ids = rows.map((row) => row.id);
    const before = payload.returning ? await fetchByIds(table, ids, requested, columns) : null;
    await pool.execute(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    return { data: before, count: ids.length, realtimeRows: rows };
  }
}

export async function queryData(userId, payload) {
  const table = payload?.table;
  const operation = payload?.operation || 'select';
  // Decryption happens after the Redis read cache so cached payloads only ever
  // contain ciphertext, never plaintext message content.
  const withDecryptedData = (result) => {
    if (result && result.data != null) result.data = decryptRowsForTable(table, result.data);
    return result;
  };
  if (operation === 'select') {
    return cachedRead(userId, table, payload, () => queryDataUncached(userId, payload)).then(withDecryptedData);
  }
  const result = await queryDataUncached(userId, payload);
  if (result?.count > 0) await invalidateReadCache(table);
  return withDecryptedData(result);
}

async function canInsert(table, row, userId, access) {
  const admin = await isAdmin(userId);
  if (table === 'admin_logs') return admin && row.admin_id === userId;
  if (table === 'profiles') return row.id === userId;
  if (table === 'user_roles') return await isSuperAdmin(userId) && ['user', 'admin', 'super_admin'].includes(row.role);
  if (table === 'notification_trigger_events') return false;
  if (table === 'notification_preferences' || table === 'notification_digest_state' || table === 'native_push_tokens' || table === 'pinned_conversations') return row.user_id === userId;
  if (table === 'blocked_users') return row.blocker_id === userId && row.blocked_id !== userId;
  if (table === 'friend_requests') {
    if (row.sender_id !== userId || row.receiver_id === userId || row.status !== 'pending') return false;
    const [recipient] = await pool.execute('SELECT allow_friend_requests FROM profiles WHERE id = ? LIMIT 1', [row.receiver_id]);
    if (!recipient[0]?.allow_friend_requests) return false;
    const [blocked] = await pool.execute('SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [userId, row.receiver_id, row.receiver_id, userId]);
    return blocked.length === 0;
  }
  if (table === 'messages') {
    if (row.sender_id !== userId) return false;
    const [members] = await pool.execute('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1', [row.conversation_id, userId]);
    return members.length > 0;
  }
  if (table === 'global_messages') return row.sender_id === userId;
  if (table === 'announcement_messages') return admin && row.sender_id === userId;
  if (table === 'message_reactions') {
    if (row.user_id !== userId) return false;
    const [message] = await pool.execute('SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id WHERE m.id = ? AND cm.user_id = ? LIMIT 1', [row.message_id, userId]);
    return message.length > 0;
  }
  if (table === 'polls') {
    if (row.created_by !== userId || !['dm', 'global', 'announcement'].includes(row.channel)) return false;
    if (row.channel === 'dm') {
      const [members] = await pool.execute('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1', [row.conversation_id, userId]);
      return members.length > 0;
    }
    return row.channel !== 'announcement' || admin;
  }
  if (table === 'poll_options') {
    const [poll] = await pool.execute('SELECT created_by FROM polls WHERE id = ? LIMIT 1', [row.poll_id]);
    return poll[0]?.created_by === userId;
  }
  if (table === 'poll_votes') {
    if (row.user_id !== userId) return false;
    const [poll] = await pool.execute('SELECT p.id FROM polls p JOIN poll_options o ON o.poll_id = p.id WHERE p.id = ? AND o.id = ? AND p.closed_at IS NULL AND p.ends_at > CURRENT_TIMESTAMP(3)', [row.poll_id, row.option_id]);
    return poll.length > 0;
  }
  if (table === 'conversation_members') {
    if (row.role && row.role !== 'member') return false;
    if (admin) return true;
    if (row.user_id === userId) {
      const [created] = await pool.execute('SELECT 1 FROM conversations WHERE id = ? AND created_by = ? LIMIT 1', [row.conversation_id, userId]);
      if (created.length) return true;
    }
    const [member] = await pool.execute("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND role IN ('owner','admin') LIMIT 1", [row.conversation_id, userId]);
    return member.length > 0;
  }
  if (table === 'conversations') return row.created_by === userId;
  return access.sql !== '1 = 0' && admin;
}

async function fetchSelection(table, requested, whereSql, args) {
  const [rows] = await pool.execute(`SELECT ${requested} FROM \`${table}\` t WHERE ${whereSql}`, args);
  return rows;
}

async function fetchByIds(table, ids, requested, columns) {
  if (!ids.length) return [];
  const key = columns.has('id') ? 'id' : columns.has('user_id') ? 'user_id' : null;
  if (!key) return [];
  const idColumn = identifier(key, columns);
  const [rows] = await pool.execute(`SELECT ${requested} FROM \`${table}\` WHERE ${idColumn} IN (${ids.map(() => '?').join(',')})`, ids);
  return rows;
}

async function fetchUpsertedFriendRequests(rows, requested) {
  const clauses = rows.map(() => '(sender_id = ? AND receiver_id = ?)').join(' OR ');
  const args = rows.flatMap((row) => [row.sender_id, row.receiver_id]);
  const [result] = await pool.execute(`SELECT ${requested} FROM friend_requests WHERE ${clauses}`, args);
  return result;
}
