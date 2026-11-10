import { createHmac } from 'node:crypto';
import { pool } from './db.mjs';
import { acknowledgeRealtimeBatch, enqueueRealtimeBatch, pendingRealtimeBatches } from './redis.mjs';

const PUBLIC_TOPIC = 'veyra-public-mariadb';
const SAFE_KEYS = new Set([
  'id', 'user_id', 'conversation_id', 'message_id', 'poll_id', 'option_id',
  'sender_id', 'receiver_id', 'blocker_id', 'blocked_id', 'group_id',
]);
const publicTables = new Set(['global_messages', 'announcement_messages']);
const messageTables = new Set(['messages', 'global_messages', 'announcement_messages']);
const MESSAGE_EVENT_COLUMNS = new Set([
  'id', 'conversation_id', 'sender_id', 'content', 'image_url', 'reply_to_id',
  'created_at', 'read_at', 'delivered_at', 'edited_at', 'is_pinned', 'pinned_at', 'pinned_by', 'expires_at',
]);
const warnedMissingConfig = { value: false };

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function mariaDbRealtimeTopic(userId) {
  const key = serviceKey();
  if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY on the API server to enable live updates.');
  const digest = createHmac('sha256', key).update(`veyra-user:${userId}`).digest('base64url').slice(0, 32);
  return `veyra-user-${digest}`;
}

function collectKeys(...sources) {
  const keys = {};
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value.column === 'string' && SAFE_KEYS.has(value.column)
      && ['eq', 'is'].includes(String(value.op).toLowerCase())
      && (typeof value.value === 'string' || typeof value.value === 'number')) {
      keys[value.column] = value.value;
    }
    for (const [key, item] of Object.entries(value)) {
      if (SAFE_KEYS.has(key) && (typeof item === 'string' || typeof item === 'number')) {
        keys[key] = item;
      }
    }
  };
  sources.forEach(visit);
  return keys;
}

function cleanColumns(values) {
  const rows = Array.isArray(values) ? values : [values];
  return [...new Set(rows.flatMap((row) => row && typeof row === 'object' ? Object.keys(row) : []))]
    .filter((column) => /^[a-z_][a-z0-9_]*$/i.test(column))
    .slice(0, 40);
}

async function conversationMembers(conversationId, cache) {
  if (!conversationId) return [];
  if (!cache.has(conversationId)) {
    cache.set(conversationId, pool.execute(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [conversationId],
    ).then(([rows]) => rows.map((row) => row.user_id)));
  }
  return cache.get(conversationId);
}

async function recipientsFor(change, actorId, membershipCache) {
  const keys = collectKeys(change.values, change.filters, change.data, change.realtimeRows);
  if (publicTables.has(change.table)) return { keys, users: [], isPublic: true };

  const users = new Set(actorId ? [actorId] : []);
  let conversationId = keys.conversation_id;

  if (change.table === 'messages' && !conversationId && keys.id) {
    const [rows] = await pool.execute('SELECT conversation_id FROM messages WHERE id = ? LIMIT 1', [keys.id]);
    conversationId = rows[0]?.conversation_id;
  } else if (change.table === 'message_reactions') {
    const messageId = keys.message_id;
    if (messageId) {
      const [rows] = await pool.execute('SELECT conversation_id FROM messages WHERE id = ? LIMIT 1', [messageId]);
      conversationId = rows[0]?.conversation_id;
    }
  } else if (['polls', 'poll_votes', 'poll_options'].includes(change.table)) {
    const pollId = keys.poll_id || (change.table === 'polls' ? keys.id : null);
    if (pollId) {
      const [rows] = await pool.execute('SELECT conversation_id FROM polls WHERE id = ? LIMIT 1', [pollId]);
      conversationId = rows[0]?.conversation_id;
    }
    if (conversationId == null) return { keys, users: [], isPublic: true };
  } else if (change.table === 'conversations') {
    conversationId = conversationId || keys.id;
  } else if (change.table === 'friend_requests') {
    if ((!keys.sender_id || !keys.receiver_id) && keys.id) {
      const [rows] = await pool.execute('SELECT sender_id, receiver_id FROM friend_requests WHERE id = ? LIMIT 1', [keys.id]);
      if (rows[0]) Object.assign(keys, rows[0]);
    }
    if (keys.sender_id) users.add(keys.sender_id);
    if (keys.receiver_id) users.add(keys.receiver_id);
  } else if (change.table === 'blocked_users') {
    if (keys.blocker_id) users.add(keys.blocker_id);
    if (keys.blocked_id) users.add(keys.blocked_id);
  } else if (change.table === 'profiles' && keys.id) {
    const [rows] = await pool.execute(
      "SELECT sender_id, receiver_id FROM friend_requests WHERE status = 'accepted' AND (sender_id = ? OR receiver_id = ?)",
      [keys.id, keys.id],
    );
    for (const row of rows) users.add(row.sender_id === keys.id ? row.receiver_id : row.sender_id);
  }

  if (conversationId) {
    keys.conversation_id = conversationId;
    for (const memberId of await conversationMembers(conversationId, membershipCache)) users.add(memberId);
  }
  if (change.table === 'conversation_members' && keys.user_id) users.add(keys.user_id);

  return { keys, users: [...users].slice(0, 200), isPublic: false };
}

export async function publishMariaDbChanges(changes, actorId) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = serviceKey();
  if (!url || !key) {
    if (!warnedMissingConfig.value) {
      console.warn('MariaDB live updates require server-side Supabase service credentials.');
      warnedMissingConfig.value = true;
    }
    return;
  }

  const membershipCache = new Map();
  const messages = [];
  try {
    for (const change of changes) {
      const scope = await recipientsFor(change, actorId, membershipCache);
      const payload = {
        schema: 'public',
        table: change.table,
        eventType: change.eventType || '*',
        operation: change.operation,
        keys: scope.keys,
        columns: change.columns || cleanColumns(change.values),
        ...(scope.isPublic ? {} : { actor_id: actorId }),
        ...(messageTables.has(change.table) && (change.eventType || '').toUpperCase() === 'INSERT'
          ? { record: Object.fromEntries(Object.entries(Array.isArray(change.data) ? change.data[0] || {} : change.data || {}).filter(([column]) => MESSAGE_EVENT_COLUMNS.has(column))) }
          : {}),
        refresh: true,
      };
      const topics = scope.isPublic ? [PUBLIC_TOPIC] : scope.users.map(mariaDbRealtimeTopic);
      for (const topic of topics) messages.push({ topic, event: 'db-change', payload });
    }
  } catch (error) {
    console.warn('Could not prepare MariaDB live update:', error instanceof Error ? error.message : 'database error');
    return;
  }
  if (!messages.length) return;

  const broadcast = async (batch) => {
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: batch }),
      signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) console.warn(`MariaDB live update broadcast failed (${response.status}).`);
      return response.ok;
    } catch (error) {
      console.warn('MariaDB live update broadcast failed:', error instanceof Error ? error.message : 'network error');
      return false;
    }
  };

  const queuedId = await enqueueRealtimeBatch(messages);
  if (!queuedId) {
    await broadcast(messages);
    return;
  }

  const pending = await pendingRealtimeBatches(50);
  for (const batch of pending) {
    if (!(await broadcast(batch.messages))) break;
    await acknowledgeRealtimeBatch(batch.id);
  }
}

export function changeFromDataRequest(payload, result) {
  const table = payload?.table;
  const operation = payload?.operation;
  if (typeof table !== 'string' || !['insert', 'upsert', 'update', 'delete'].includes(operation)) return null;
  if (!(result?.count > 0)) return null;

  return {
    table,
    operation,
    eventType: operation === 'insert' ? 'INSERT' : operation === 'delete' ? 'DELETE' : operation === 'update' ? 'UPDATE' : 'UPSERT',
    values: payload.values,
    filters: payload.filters,
    data: result.data,
    realtimeRows: result.realtimeRows,
  };
}

const RPC_CHANGES = {
  get_or_create_dm: (_args, result) => result ? [
    { table: 'conversations', eventType: 'INSERT', operation: 'rpc', values: { id: result } },
    { table: 'conversation_members', eventType: 'INSERT', operation: 'rpc', values: { conversation_id: result } },
  ] : [],
  create_group_chat: (_args, result) => result ? [
    { table: 'conversations', eventType: 'INSERT', operation: 'rpc', values: { id: result } },
    { table: 'conversation_members', eventType: 'INSERT', operation: 'rpc', values: { conversation_id: result } },
  ] : [],
  rename_group: (args) => [{ table: 'conversations', eventType: 'UPDATE', operation: 'rpc', values: { id: args._conv }, columns: ['name'] }],
  add_group_members: (args) => [{ table: 'conversation_members', eventType: 'INSERT', operation: 'rpc', values: { conversation_id: args._conv }, columns: ['conversation_id', 'user_id'] }],
  remove_group_member: (args) => [{ table: 'conversation_members', eventType: 'DELETE', operation: 'rpc', values: { conversation_id: args._conv, user_id: args._user_id }, columns: ['conversation_id', 'user_id'] }],
  set_member_role: (args) => [{ table: 'conversation_members', eventType: 'UPDATE', operation: 'rpc', values: { conversation_id: args._conv, user_id: args._user_id }, columns: ['role'] }],
  transfer_group_ownership: (args) => [
    { table: 'conversation_members', eventType: 'UPDATE', operation: 'rpc', values: { conversation_id: args._conv, user_id: args._new_owner }, columns: ['role'] },
    { table: 'conversations', eventType: 'UPDATE', operation: 'rpc', values: { id: args._conv }, columns: ['created_by'] },
  ],
  leave_group: (args) => [
    { table: 'conversation_members', eventType: 'DELETE', operation: 'rpc', values: { conversation_id: args._conv, user_id: args._user_id }, columns: ['conversation_id'] },
    { table: 'conversations', eventType: 'UPDATE', operation: 'rpc', values: { id: args._conv }, columns: ['is_group'] },
  ],
  mark_message_read: (args) => [{ table: 'messages', eventType: 'UPDATE', operation: 'rpc', values: { id: args._message_id }, columns: ['read_at'] }],
  mark_message_delivered: (args) => [{ table: 'messages', eventType: 'UPDATE', operation: 'rpc', values: { id: args._message_id }, columns: ['delivered_at'] }],
  mark_conversation_read: (args, result) => result > 0 ? [{ table: 'messages', eventType: 'UPDATE', operation: 'rpc', values: { conversation_id: args._conversation_id }, columns: ['read_at', 'delivered_at'] }] : [],
  mark_conversation_delivered: (args) => [{ table: 'messages', eventType: 'UPDATE', operation: 'rpc', values: { conversation_id: args._conversation_id }, columns: ['delivered_at'] }],
  finalize_poll: (args) => [{ table: 'polls', eventType: 'UPDATE', operation: 'rpc', values: { id: args._poll_id }, columns: ['closed_at'] }],
};

export function changesFromRpc(name, args, result) {
  const createChanges = RPC_CHANGES[name];
  return createChanges ? createChanges(args || {}, result) : [];
}
