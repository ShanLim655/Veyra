import { pool } from './db.mjs';

const DEFAULT_SERVER = process.env.NTFY_SERVER_URL || 'https://ntfy.chat-amani.xyz';
const ALLOWED_HOSTS = ['ntfy.sh', 'ntfy.chat-amani.xyz'];
const templates = {
  dm: { title: 'New message from {user}', body: '{message}' },
  global: { title: '{user} in Global Chat', body: '{message}' },
  announcement: { title: 'Announcement from {user}', body: '{message}' },
};

function safeServer(value) {
  try {
    const url = new URL((value || DEFAULT_SERVER).replace(/\/+$/, ''));
    return ['https:', 'http:'].includes(url.protocol) && ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

function render(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_match, key) => vars[key] ?? '');
}

async function publish(server, topic, title, message) {
  if (!safeServer(server) || !topic?.trim()) return false;
  try {
    const response = await fetch(server.replace(/\/+$/, ''), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic.trim(), title, message }),
    });
    return response.ok;
  } catch { return false; }
}

export async function sendTestNotification(userId) {
  const [rows] = await pool.execute('SELECT ntfy_server, ntfy_topic FROM notification_preferences WHERE user_id = ? LIMIT 1', [userId]);
  const topic = rows[0]?.ntfy_topic?.trim();
  if (!topic) return { ok: false, error: 'Set a topic first' };
  const ok = await publish(rows[0].ntfy_server, topic, 'Test notification', 'If you can see this, ntfy is set up correctly!');
  return { ok, error: ok ? null : 'The ntfy server is currently unavailable.' };
}

export async function notifyNewMessage(table, row) {
  const channel = table === 'messages' ? 'dm' : table === 'global_messages' ? 'global' : table === 'announcement_messages' ? 'announcement' : null;
  if (!channel || !row?.sender_id) return;
  const [senderRows] = await pool.execute('SELECT username, display_name FROM profiles WHERE id = ? LIMIT 1', [row.sender_id]);
  const sender = senderRows[0]?.display_name || senderRows[0]?.username || 'Someone';
  const [recipients] = channel === 'dm'
    ? await pool.execute('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?', [row.conversation_id, row.sender_id])
    : await pool.execute('SELECT user_id FROM notification_preferences WHERE user_id <> ?', [row.sender_id]);
  const ids = [...new Set(recipients.map((r) => r.user_id))];
  if (!ids.length) return;
  const [prefs] = await pool.execute(`SELECT * FROM notification_preferences WHERE user_id IN (${ids.map(() => '?').join(',')})`, ids);
  const sent = new Set();
  const channelKey = channel === 'dm' ? `dm:${row.conversation_id}` : channel;

  for (const pref of prefs) {
    if (!pref.ntfy_topic) continue;
    const server = pref.ntfy_server || DEFAULT_SERVER;
    const topic = pref.ntfy_topic.trim();
    const dedupeKey = `${server.replace(/\/+$/, '')}|${topic}`;
    if (sent.has(dedupeKey)) continue;
    const mode = pref[`${channel}_mode`] || 'off';
    if (mode === 'off') continue;
    let title;
    let message;
    if (mode === 'digest') {
      const [state] = await pool.execute('SELECT last_notified_at FROM notification_digest_state WHERE user_id = ? AND channel_key = ? LIMIT 1', [pref.user_id, channelKey]);
      const cooldownMs = Number(pref.digest_cooldown_minutes || 10) * 60_000;
      if (state[0] && Date.now() - new Date(state[0].last_notified_at).getTime() < cooldownMs) continue;
      await pool.execute(`INSERT INTO notification_digest_state (user_id, channel_key, last_notified_at) VALUES (?, ?, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE last_notified_at = CURRENT_TIMESTAMP(3)`, [pref.user_id, channelKey]);
      title = channel === 'dm' ? 'New messages' : channel === 'global' ? 'New global chat messages' : 'New announcements';
      message = channel === 'dm' ? 'You have new direct messages.' : channel === 'global' ? "There's new activity in Global Chat." : 'There are new announcements.';
    } else {
      const custom = !!pref[`${channel}_custom_enabled`];
      const titleTemplate = custom ? pref[`${channel}_title_template`] : templates[channel].title;
      const bodyTemplate = custom ? pref[`${channel}_body_template`] : templates[channel].body;
      title = render(titleTemplate, { user: sender, message: row.content || '(no text)' });
      message = render(bodyTemplate, { user: sender, message: row.content || '(no text)' });
    }
    if (await publish(server, topic, title, message)) sent.add(dedupeKey);
  }
}
