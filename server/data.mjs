import { randomUUID } from 'node:crypto';
import { pool } from './db.mjs';
import { ensureDirectMessage } from './rpc.mjs';
import { notifyNewMessage } from './notifications.mjs';
import { cachedRead, invalidateReadCache } from './redis.mjs';

const TABLES = new Set([
  'admin_logs', 'announcement_messages', 'blocked_users', 'conversation_members',
  'conversations', 'friend_requests', 'global_messages', 'message_reactions',
  'messages', 'native_push_tokens', 'notification_digest_state',
  'notification_preferences', 'notification_trigger_events', 'pinned_conversations',
  'poll_options', 'poll_votes', 'polls', 'profiles', 'user_roles',
]);
const columnCache = new Map();
const primaryKeyCache = new Map();

async function primaryKeysFor(table) {
  if (!primaryKeyCache.has(table)) {
    const [rows] = await pool.query(`SHOW KEYS FROM \`${table}\` WHERE Key_name = 'PRIMARY'`);
    rows.sort((left, right) => Number(left.Seq_in_index) - Number(right.Seq_in_index));
    primaryKeyCache.set(table, rows.map((row) => row.Column_name));
  }
  return primaryKeyCache.get(table);
}

export function buildPrimaryKeyDelete(table, primaryKeys, rows, whereSql, whereArgs) {
  if (!primaryKeys.length) throw new Error('The table does not have a primary key.');
  if (!rows.length) throw new Error('Cannot build a delete without selected rows.');
  const rowClauses = rows.map(() => `(${primaryKeys.map((column) => `\`${column}\` = ?`).join(' AND ')})`);
  const keyArgs = rows.flatMap((row) => primaryKeys.map((column) => row[column]));
  const keySql = rowClauses.join(' OR ');
  return {
    sql: `DELETE FROM \`${table}\` WHERE ${whereSql} AND (${keySql})`,
    args: [...whereArgs, ...keyArgs],
    keySql,
    keyArgs,
  };
}

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

export function userRolesAccessPolicy(userId, operation, superAdmin) {
  if (operation === 'select') return superAdmin
    ? { sql: '1 = 1', args: [] }
    : { sql: 'user_id = ?', args: [userId] };
  return superAdmin ? { sql: '1 = 1', args: [] } : { sql: '1 = 0', args: [] };
}

export function conversationMembersAccessPolicy(userId, operation, admin) {
  if (operation === 'select') return admin
    ? { sql: '1 = 1', args: [] }
    : { sql: `(${membershipExists(userId)} OR user_id = ?)`, args: [userId, userId] };
  return admin ? { sql: '1 = 1', args: [] } : { sql: '1 = 0', args: [] };
}

export function adminLogsAccessPolicy(admin, operation) {
  if (admin && ['select', 'insert'].includes(operation)) return { sql: '1 = 1', args: [] };
  return { sql: '1 = 0', args: [] };
}

export function pollVotesAccessPolicy(userId, operation, admin) {
  if (admin) return { sql: '1 = 1', args: [] };
  const scope = 'EXISTS (SELECT 1 FROM polls p WHERE p.id = t.poll_id AND (p.conversation_id IS NULL OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = p.conversation_id AND cm.user_id = ?)))';
  return operation === 'select'
    ? { sql: scope, args: [userId] }
    : { sql: `user_id = ? AND ${scope}`, args: [userId, userId] };
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
  if (table === 'admin_logs') return adminLogsAccessPolicy(admin, operation);
  if (table === 'profiles') return operation === 'select'
    ? { sql: '1 = 1', args: [] }
    : { sql: 'id = ?', args: [userId] };
  if (table === 'user_roles') return userRolesAccessPolicy(userId, operation, await isSuperAdmin(userId));
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
  if (table === 'conversation_members') return conversationMembersAccessPolicy(userId, operation, admin);
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
    const membership = `EXISTS (SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id WHERE m.id = t.message_id AND cm.user_id = ?)`;
    return operation === 'select'
      ? { sql: membership, args: [userId] }
      : { sql: `user_id = ? AND ${membership}`, args: [userId, userId] };
  }
  if (table === 'polls') {
    if (admin) return { sql: '1 = 1', args: [] };
    return operation === 'select'
      ? { sql: `(conversation_id IS NULL OR ${membershipExists(userId)})`, args: [userId] }
      : { sql: 'created_by = ?', args: [userId] };
  }
  if (table === 'poll_options' || table === 'poll_votes') {
    if (admin) return { sql: '1 = 1', args: [] };
    if (table === 'poll_votes') return pollVotesAccessPolicy(userId, operation, admin);
    const extra = operation !== 'select' ? ' AND p.created_by = ?' : '';
    return { sql: `EXISTS (SELECT 1 FROM polls p WHERE p.id = t.poll_id AND (p.conversation_id IS NULL OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = p.conversation_id AND cm.user_id = ?))${extra})`, args: extra ? [userId, userId] : [userId] };
  }
  if (table === 'announcement_messages') return { sql: '1 = 1', args: [] };
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
        parts.push(filter.value === null ? `${col} IS NULL` : `${col} IS ?`);
        if (filter.value !== null) args.push(normalizeTemporalValue(filter.value, columns.get(filter.column)));
        break;
      case 'ilike': parts.push(`LOWER(${col}) LIKE LOWER(?)`); args.push(String(filter.value).replaceAll('*', '%')); break;
      default: throw new Error(`Unsupported filter: ${filter.op}`);
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', args };
}

function splitFilterExpressions(value) {
  const expressions = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++;
    else if (value[index] === ')') {
      depth--;
      if (depth < 0) throw new Error('Invalid OR filter.');
    } else if (value[index] === ',' && depth === 0) {
      expressions.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) throw new Error('Invalid OR filter.');
  expressions.push(value.slice(start).trim());
  if (expressions.some((expression) => !expression)) throw new Error('Invalid OR filter.');
  return expressions;
}

function parseFilterExpression(expression, columns) {
  const group = expression.match(/^(and|or)\((.*)\)$/i);
  if (group) {
    const children = splitFilterExpressions(group[2]).map((child) => parseFilterExpression(child, columns));
    return {
      sql: `(${children.map((child) => child.sql).join(group[1].toLowerCase() === 'and' ? ' AND ' : ' OR ')})`,
      args: children.flatMap((child) => child.args),
    };
  }

  const match = expression.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|neq|gt|gte|lt|lte|ilike|is)\.(.*)$/i);
  if (!match) throw new Error('Unsupported OR filter.');
  const [, column, rawOperator, rawValue] = match;
  const col = identifier(column, columns);
  const operator = rawOperator.toLowerCase();
  const value = rawValue;
  if (operator === 'ilike') return { sql: `LOWER(${col}) LIKE LOWER(?)`, args: [value.replaceAll('*', '%')] };
  if (operator === 'is' && value.toLowerCase() === 'null') return { sql: `${col} IS NULL`, args: [] };
  const sqlOperator = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', is: 'IS' }[operator];
  return {
    sql: `${col} ${sqlOperator} ?`,
    args: [normalizeTemporalValue(value, columns.get(column))],
  };
}

export function parseOr(raw, columns) {
  if (!raw) return { sql: '', args: [] };
  const expressions = splitFilterExpressions(String(raw));
  const parsed = expressions.map((expression) => parseFilterExpression(expression, columns));
  return {
    sql: `(${parsed.map((item) => item.sql).join(' OR ')})`,
    args: parsed.flatMap((item) => item.args),
  };
}

function selection(select, columns) {
  const value = select || '*';
  if (value.trim() === '*') return '*';
  return value.split(',').map((part) => identifier(part.trim(), columns)).join(', ');
}

export async function insertPollVote(database, row, keys, userId) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [polls] = await connection.execute(
      `SELECT p.multiple_choice, p.conversation_id
       FROM polls p
       JOIN poll_options o ON o.poll_id = p.id AND o.id = ?
       WHERE p.id = ? AND p.closed_at IS NULL AND p.ends_at > CURRENT_TIMESTAMP(3)
       FOR UPDATE`,
      [row.option_id, row.poll_id],
    );
    if (!polls.length) throw new Error('This poll is closed or the selected option is invalid.');
    if (polls[0].conversation_id) {
      const [members] = await connection.execute(
        'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? FOR UPDATE',
        [polls[0].conversation_id, userId],
      );
      if (!members.length) throw new Error('You are no longer a member of this poll conversation.');
    }
    if (!Boolean(polls[0].multiple_choice)) {
      await connection.execute(
        'DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?',
        [row.poll_id, userId],
      );
    }
    await connection.execute(
      `INSERT INTO poll_votes (${keys.map((key) => `\`${key}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((key) => row[key]),
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
    if (operation === 'upsert' && !['friend_requests', 'notification_preferences'].includes(table)) {
      throw new Error('Upsert is not supported for this table.');
    }
    const inputRows = (Array.isArray(payload.values) ? payload.values : [payload.values]).filter(Boolean);
    if (!inputRows.length) return { data: [], count: 0 };
    const inserted = [];
    for (const input of inputRows) {
      const row = { ...input };
      if (table === 'friend_requests' && operation === 'upsert') row.id = randomUUID();
      else if (columns.has('id') && !row.id) row.id = randomUUID();
      if (!await canInsert(table, row, userId, access)) throw new Error('Not allowed to insert this row.');
      const normalizedRow = normalizeRowTemporalValues(row, columns);
      const keys = Object.keys(normalizedRow);
      for (const key of keys) identifier(key, columns);
      if (!keys.length) throw new Error('Insert data is empty.');
      if (table === 'poll_votes') {
        await insertPollVote(pool, normalizedRow, keys, userId);
        inserted.push(row.id);
        continue;
      }
      const updateKeys = operation === 'upsert'
        ? keys.filter((key) => key !== 'id' && key !== 'user_id' && (table !== 'friend_requests' || key === 'status'))
        : [];
      const upsertClause = operation !== 'upsert'
        ? ''
        : table === 'friend_requests'
          ? " ON DUPLICATE KEY UPDATE status = IF(status = 'accepted', status, VALUES(status))"
          : updateKeys.length
            ? ` ON DUPLICATE KEY UPDATE ${updateKeys.map((key) => `\`${key}\` = VALUES(\`${key}\`)`).join(', ')}`
            : '';
      const [result] = await pool.execute(
        `INSERT INTO \`${table}\` (${keys.map((key) => `\`${key}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})${upsertClause}`,
        keys.map((key) => normalizedRow[key]),
      );
      inserted.push(row.id ?? row.user_id ?? result.insertId);
      if (operation === 'insert' && !/^(1|true|yes)$/i.test(String(process.env.BACKGROUND_JOBS_ENABLED || '')) && ['messages', 'global_messages', 'announcement_messages'].includes(table)) {
        void notifyNewMessage(table, normalizedRow).catch((error) => console.error('Notification delivery failed:', error));
      }
    }
    const rows = operation === 'upsert' && table === 'friend_requests'
      ? await fetchUpsertedFriendRequests(inputRows, requested)
      : await fetchByIds(table, inserted, requested, columns);
    return { data: payload.single ? rows[0] ?? null : rows, count: rows.length };
  }

  if (operation === 'update') {
    const patch = normalizeRowTemporalValues(payload.values || {}, columns);
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
    const primaryKeys = await primaryKeysFor(table);
    const realtimeColumns = [...new Set([...primaryKeys, 'id', 'user_id', 'conversation_id', 'message_id', 'poll_id', 'option_id', 'sender_id', 'receiver_id', 'blocker_id', 'blocked_id', 'group_id'])]
      .filter((column) => columns.has(column));
    const [rows] = await pool.execute(`SELECT ${realtimeColumns.map((column) => `t.\`${column}\``).join(', ')} FROM \`${table}\` t WHERE ${whereSql}`, whereArgs);
    if (!rows.length) return { data: payload.returning ? [] : null, count: 0 };
    const deletion = buildPrimaryKeyDelete(table, primaryKeys, rows, whereSql, whereArgs);
    const before = payload.returning
      ? await fetchSelection(table, requested, `${whereSql} AND (${deletion.keySql})`, [...whereArgs, ...deletion.keyArgs])
      : null;
    await pool.execute(deletion.sql, deletion.args);
    return { data: before, count: rows.length, realtimeRows: rows };
  }
}

export async function queryData(userId, payload) {
  const table = payload?.table;
  const operation = payload?.operation || 'select';
  if (operation === 'select') {
    return cachedRead(userId, table, payload, () => queryDataUncached(userId, payload));
  }
  const result = await queryDataUncached(userId, payload);
  if (result?.count > 0) await invalidateReadCache(table);
  return result;
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
    const [conversations] = await pool.execute(
      `SELECT c.is_group,
         EXISTS (
           SELECT 1
           FROM conversation_members other
           JOIN blocked_users b
             ON (b.blocker_id = ? AND b.blocked_id = other.user_id)
             OR (b.blocker_id = other.user_id AND b.blocked_id = ?)
           WHERE other.conversation_id = c.id AND other.user_id <> ?
         ) AS blocked
       FROM conversations c
       JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ?
       WHERE c.id = ? LIMIT 1`,
      [userId, userId, userId, userId, row.conversation_id],
    );
    return conversations.length > 0 && (Boolean(conversations[0].is_group) || !Boolean(conversations[0].blocked));
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
    const [poll] = await pool.execute(
      'SELECT created_by, conversation_id FROM polls WHERE id = ? AND closed_at IS NULL AND ends_at > CURRENT_TIMESTAMP(3) LIMIT 1',
      [row.poll_id],
    );
    if (poll[0]?.created_by !== userId) return false;
    if (!poll[0].conversation_id) return true;
    const [members] = await pool.execute(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1',
      [poll[0].conversation_id, userId],
    );
    return members.length > 0;
  }
  if (table === 'poll_votes') {
    if (row.user_id !== userId) return false;
    const [poll] = await pool.execute(
      `SELECT p.id FROM polls p
       JOIN poll_options o ON o.poll_id = p.id AND o.id = ?
       WHERE p.id = ? AND p.closed_at IS NULL AND p.ends_at > CURRENT_TIMESTAMP(3)
         AND (p.conversation_id IS NULL OR EXISTS (
           SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = p.conversation_id AND cm.user_id = ?
         ))`,
      [row.option_id, row.poll_id, userId],
    );
    return poll.length > 0;
  }
  if (table === 'conversation_members') return admin && (!row.role || row.role === 'member');
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
