import { randomUUID } from 'node:crypto';
import { pool } from './db.mjs';

async function adminCheck(userId, connection = pool) {
  const [rows] = await connection.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role IN ('admin','super_admin') LIMIT 1", [userId]);
  return rows.length > 0;
}

async function groupRole(userId, conversationId, connection = pool) {
  const [rows] = await connection.execute('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1', [conversationId, userId]);
  return rows[0]?.role || null;
}

async function userDmList(userId) {
  const [rows] = await pool.execute(
    `SELECT c.id AS conversation_id, other.user_id AS other_user_id,
      p.username AS other_username, p.display_name AS other_display_name,
      p.avatar_url AS other_avatar_url, p.status AS other_status,
      p.custom_status_text AS other_custom_status_text,
      p.custom_status_emoji AS other_custom_status_emoji,
      p.custom_status_expires_at AS other_custom_status_expires_at,
      (SELECT COUNT(*) FROM messages um WHERE um.conversation_id = c.id AND um.sender_id <> ? AND um.read_at IS NULL) AS unread_count,
      COALESCE((SELECT MAX(lm.created_at) FROM messages lm WHERE lm.conversation_id = c.id), c.created_at) AS last_message_at,
      (SELECT fr.id FROM friend_requests fr WHERE fr.status = 'accepted' AND ((fr.sender_id = ? AND fr.receiver_id = other.user_id) OR (fr.sender_id = other.user_id AND fr.receiver_id = ?)) LIMIT 1) AS friend_request_id,
      EXISTS(SELECT 1 FROM pinned_conversations pc WHERE pc.user_id = ? AND pc.conversation_id = c.id) AS is_pinned
     FROM conversations c
     JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ?
     JOIN conversation_members other ON other.conversation_id = c.id AND other.user_id <> ?
     JOIN profiles p ON p.id = other.user_id
     WHERE c.is_group = 0
     ORDER BY is_pinned DESC, last_message_at DESC`,
    [userId, userId, userId, userId, userId, userId],
  );
  return rows;
}

async function userGroupList(userId) {
  const [rows] = await pool.execute(
    `SELECT c.id AS conversation_id, c.name, mine.role AS my_role,
      (SELECT COUNT(*) FROM conversation_members mc WHERE mc.conversation_id = c.id) AS member_count,
      (SELECT COUNT(*) FROM messages um WHERE um.conversation_id = c.id AND um.sender_id <> ? AND um.read_at IS NULL) AS unread_count,
      COALESCE((SELECT MAX(lm.created_at) FROM messages lm WHERE lm.conversation_id = c.id), c.created_at) AS last_message_at,
      EXISTS(SELECT 1 FROM pinned_conversations pc WHERE pc.user_id = ? AND pc.conversation_id = c.id) AS is_pinned,
      (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url))
         FROM conversation_members cm JOIN profiles p ON p.id = cm.user_id WHERE cm.conversation_id = c.id) AS member_previews
     FROM conversations c JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ?
     WHERE c.is_group = 1
     ORDER BY is_pinned DESC, last_message_at DESC`,
    [userId, userId, userId],
  );
  return rows.map((row) => ({ ...row, member_previews: typeof row.member_previews === 'string' ? JSON.parse(row.member_previews) : row.member_previews || [] }));
}

export async function callRpc(userId, name, args = {}) {
  switch (name) {
    case 'get_user_dm_list': return userDmList(userId);
    case 'get_user_group_list': return userGroupList(userId);
    case 'get_user_role_for_admin': {
      if (!await adminCheck(userId)) throw new Error('Admin access required.');
      const [rows] = await pool.execute('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role = \'super_admin\' DESC LIMIT 1', [args._target_user_id]);
      return rows[0]?.role ?? null;
    }
    case 'get_admin_analytics_counts': {
      if (!await adminCheck(userId)) throw new Error('Admin access required.');
      const [rows] = await pool.query(`SELECT
        (SELECT COUNT(*) FROM conversations WHERE is_group = 0) AS totalConversations,
        (SELECT COUNT(*) FROM messages) AS totalMessages,
        (SELECT COUNT(*) FROM friend_requests WHERE status = 'accepted') AS totalFriendships,
        (SELECT COUNT(*) FROM global_messages) AS totalGlobalMessages,
        (SELECT COUNT(*) FROM announcement_messages) AS totalAnnouncements`);
      return rows[0];
    }
    case 'get_admin_daily_stats': {
      if (!await adminCheck(userId)) throw new Error('Admin access required.');
      const days = Math.min(Math.max(Number(args.days_count || 7), 1), 90);
      const [rows] = await pool.query(`SELECT calendar.day,
        COALESCE((SELECT COUNT(*) FROM messages WHERE DATE(created_at) = calendar.day), 0) AS messages,
        COALESCE((SELECT COUNT(*) FROM global_messages WHERE DATE(created_at) = calendar.day), 0) AS global_messages,
        COALESCE((SELECT COUNT(*) FROM profiles WHERE DATE(created_at) = calendar.day), 0) AS new_users
        FROM (SELECT DATE_SUB(CURRENT_DATE(), INTERVAL seq DAY) AS day FROM (
          SELECT 0 AS seq UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29 UNION ALL SELECT 30 UNION ALL SELECT 31 UNION ALL SELECT 32 UNION ALL SELECT 33 UNION ALL SELECT 34 UNION ALL SELECT 35 UNION ALL SELECT 36 UNION ALL SELECT 37 UNION ALL SELECT 38 UNION ALL SELECT 39 UNION ALL SELECT 40 UNION ALL SELECT 41 UNION ALL SELECT 42 UNION ALL SELECT 43 UNION ALL SELECT 44 UNION ALL SELECT 45 UNION ALL SELECT 46 UNION ALL SELECT 47 UNION ALL SELECT 48 UNION ALL SELECT 49 UNION ALL SELECT 50 UNION ALL SELECT 51 UNION ALL SELECT 52 UNION ALL SELECT 53 UNION ALL SELECT 54 UNION ALL SELECT 55 UNION ALL SELECT 56 UNION ALL SELECT 57 UNION ALL SELECT 58 UNION ALL SELECT 59 UNION ALL SELECT 60 UNION ALL SELECT 61 UNION ALL SELECT 62 UNION ALL SELECT 63 UNION ALL SELECT 64 UNION ALL SELECT 65 UNION ALL SELECT 66 UNION ALL SELECT 67 UNION ALL SELECT 68 UNION ALL SELECT 69 UNION ALL SELECT 70 UNION ALL SELECT 71 UNION ALL SELECT 72 UNION ALL SELECT 73 UNION ALL SELECT 74 UNION ALL SELECT 75 UNION ALL SELECT 76 UNION ALL SELECT 77 UNION ALL SELECT 78 UNION ALL SELECT 79 UNION ALL SELECT 80 UNION ALL SELECT 81 UNION ALL SELECT 82 UNION ALL SELECT 83 UNION ALL SELECT 84 UNION ALL SELECT 85 UNION ALL SELECT 86 UNION ALL SELECT 87 UNION ALL SELECT 88 UNION ALL SELECT 89 UNION ALL SELECT 90
        ) seqs WHERE seq < ${days}) calendar ORDER BY calendar.day`);
      return rows;
    }
    case 'get_admin_top_users': {
      if (!await adminCheck(userId)) throw new Error('Admin access required.');
      const limit = Math.min(Math.max(Number(args.limit_count || 10), 1), 100);
      const [rows] = await pool.execute(`SELECT p.id, p.username, p.display_name, p.avatar_url,
        COALESCE(m.message_count, 0) + COALESCE(gm.message_count, 0) AS message_count
        FROM profiles p
        LEFT JOIN (SELECT sender_id, COUNT(*) AS message_count FROM messages GROUP BY sender_id) m ON m.sender_id = p.id
        LEFT JOIN (SELECT sender_id, COUNT(*) AS message_count FROM global_messages GROUP BY sender_id) gm ON gm.sender_id = p.id
        ORDER BY message_count DESC LIMIT ?`, [limit]);
      return rows;
    }
    case 'get_or_create_dm': return getOrCreateDm(userId, args._other_user_id);
    case 'create_group_chat': return createGroupChat(userId, args._name, args._member_ids || []);
    case 'rename_group': return renameGroup(userId, args._conv, args._name);
    case 'add_group_members': return addGroupMembers(userId, args._conv, args._user_ids || []);
    case 'remove_group_member': return removeGroupMember(userId, args._conv, args._user_id);
    case 'set_member_role': return setMemberRole(userId, args._conv, args._user_id, args._role);
    case 'transfer_group_ownership': return transferOwnership(userId, args._conv, args._new_owner);
    case 'leave_group': return leaveGroup(userId, args._conv);
    case 'mark_message_read': return markMessage(userId, args._message_id, 'read_at');
    case 'mark_message_delivered': return markMessage(userId, args._message_id, 'delivered_at');
    case 'mark_conversation_delivered': {
      const [result] = await pool.execute('UPDATE messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id SET m.delivered_at = CURRENT_TIMESTAMP(3) WHERE m.conversation_id = ? AND cm.user_id = ? AND m.sender_id <> ? AND m.delivered_at IS NULL', [args._conversation_id, userId, userId]);
      return result.affectedRows;
    }
    case 'mark_global_mentions_read': {
      await pool.execute('UPDATE profiles SET global_mentions_last_read_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [userId]);
      return null;
    }
    case 'finalize_poll': {
      await pool.execute('UPDATE polls SET closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP(3)) WHERE id = ? AND (created_by = ? OR ends_at <= CURRENT_TIMESTAMP(3) OR ? = 1)', [args._poll_id, userId, await adminCheck(userId) ? 1 : 0]);
      const [rows] = await pool.execute('SELECT closed_at FROM polls WHERE id = ?', [args._poll_id]);
      return rows[0]?.closed_at ?? null;
    }
    case 'get_user_sessions':
    case 'revoke_user_session':
      throw new Error('Session management is handled by Supabase Auth and is not available through MariaDB.');
    default: throw new Error(`Unsupported database action: ${name}`);
  }
}

export async function ensureDirectMessage(userId, otherId) {
  if (!otherId || otherId === userId) throw new Error('Choose another user to start a conversation.');
  const [blocked] = await pool.execute('SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [userId, otherId, otherId, userId]);
  if (blocked.length) throw new Error('This conversation is unavailable.');
  const [friendship] = await pool.execute("SELECT id FROM friend_requests WHERE status = 'accepted' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) LIMIT 1", [userId, otherId, otherId, userId]);
  if (!friendship.length) throw new Error('You can only message accepted friends.');
  const [existing] = await pool.execute(`SELECT cm.conversation_id FROM conversation_members cm JOIN conversation_members other ON other.conversation_id = cm.conversation_id JOIN conversations c ON c.id = cm.conversation_id WHERE cm.user_id = ? AND other.user_id = ? AND c.is_group = 0 LIMIT 1`, [userId, otherId]);
  if (existing.length) return existing[0].conversation_id;
  const id = randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT INTO conversations (id, is_group, created_by) VALUES (?, 0, ?)', [id, userId]);
    await connection.execute('INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', [randomUUID(), id, userId, 'member', randomUUID(), id, otherId, 'member']);
    await connection.commit();
    return id;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

const getOrCreateDm = ensureDirectMessage;

async function createGroupChat(userId, name, memberIds) {
  if (!String(name || '').trim()) throw new Error('Group name is required.');
  const uniqueIds = [...new Set([userId, ...memberIds])];
  if (uniqueIds.length < 2) throw new Error('A group chat needs at least one other member.');
  const connection = await pool.getConnection();
  const id = randomUUID();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute(`SELECT id FROM profiles WHERE id IN (${uniqueIds.map(() => '?').join(',')})`, uniqueIds);
    if (profiles.length !== uniqueIds.length) throw new Error('One or more group members do not exist.');
    for (const memberId of uniqueIds.filter((id) => id !== userId)) {
      const [friendship] = await connection.execute("SELECT 1 FROM friend_requests WHERE status = 'accepted' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) LIMIT 1", [userId, memberId, memberId, userId]);
      if (!friendship.length) throw new Error('You can only add accepted friends to a group.');
      const [blocked] = await connection.execute('SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [userId, memberId, memberId, userId]);
      if (blocked.length) throw new Error('A selected group member is unavailable.');
    }
    await connection.execute('INSERT INTO conversations (id, is_group, name, created_by) VALUES (?, 1, ?, ?)', [id, String(name).trim(), userId]);
    for (const member of uniqueIds) await connection.execute('INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, ?)', [randomUUID(), id, member, member === userId ? 'owner' : 'member']);
    await connection.commit();
    return id;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function requireGroupAdmin(userId, conv, connection = pool) {
  const role = await groupRole(userId, conv, connection);
  if (!['owner', 'admin'].includes(role)) throw new Error('Group admin access required.');
  return role;
}

async function renameGroup(userId, conv, name) {
  await requireGroupAdmin(userId, conv);
  await pool.execute('UPDATE conversations SET name = ? WHERE id = ? AND is_group = 1', [String(name).trim(), conv]);
  return null;
}

async function addGroupMembers(userId, conv, userIds) {
  await requireGroupAdmin(userId, conv);
  for (const member of [...new Set(userIds)]) {
    const [friendship] = await pool.execute("SELECT 1 FROM friend_requests WHERE status = 'accepted' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) LIMIT 1", [userId, member, member, userId]);
    if (!friendship.length) throw new Error('You can only add accepted friends to a group.');
    await pool.execute('INSERT IGNORE INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, \'member\')', [randomUUID(), conv, member]);
  }
  return null;
}

async function removeGroupMember(userId, conv, targetId) {
  const role = await requireGroupAdmin(userId, conv);
  if (targetId === userId && role === 'owner') throw new Error('Transfer ownership before leaving the group.');
  if (await groupRole(targetId, conv) === 'owner') throw new Error('Transfer ownership before removing the owner.');
  await pool.execute('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conv, targetId]);
  return null;
}

async function setMemberRole(userId, conv, targetId, role) {
  const actorRole = await requireGroupAdmin(userId, conv);
  if (actorRole !== 'owner') throw new Error('Only the group owner can change roles.');
  if (!['admin', 'member'].includes(role)) throw new Error('Invalid group role.');
  await pool.execute('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ? AND role <> \'owner\'', [role, conv, targetId]);
  return null;
}

async function transferOwnership(userId, conv, targetId) {
  const actorRole = await requireGroupAdmin(userId, conv);
  if (actorRole !== 'owner') throw new Error('Only the group owner can transfer ownership.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [target] = await connection.execute('SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ? FOR UPDATE', [conv, targetId]);
    if (!target.length) throw new Error('The new owner must be a group member.');
    await connection.execute("UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?", [conv, userId]);
    await connection.execute("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?", [conv, targetId]);
    await connection.commit();
    return null;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function leaveGroup(userId, conv) {
  if (await groupRole(userId, conv) === 'owner') throw new Error('Transfer ownership before leaving the group.');
  await pool.execute('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conv, userId]);
  return null;
}

async function markMessage(userId, messageId, column) {
  const [result] = await pool.execute(`UPDATE messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id SET m.${column} = CURRENT_TIMESTAMP(3) WHERE m.id = ? AND cm.user_id = ? AND m.sender_id <> ?`, [messageId, userId, userId]);
  return result.affectedRows;
}
