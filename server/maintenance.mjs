import { pool } from './db.mjs';
import { getSupabaseAdmin } from './supabase-admin.mjs';

const tables = ['messages', 'global_messages', 'announcement_messages'];
const buckets = new Set(['chat-images', 'chat-videos', 'chat-voice']);
const placeholder = '/expired-attachment.png';

function parseStorageUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/);
    if (!match) return null;
    const bucket = decodeURIComponent(match[1]);
    if (!buckets.has(bucket)) return null;
    return { bucket, path: decodeURIComponent(match[2]).split('?')[0] };
  } catch { return null; }
}

function extractUrl(value) {
  if (value.startsWith('video:')) return value.slice(6);
  if (value.startsWith('audio:')) {
    const audio = value.slice(6);
    const lastColon = audio.lastIndexOf(':');
    return lastColon > 0 ? audio.slice(0, lastColon) : audio;
  }
  if (value.startsWith('music:') || value.startsWith('file:')) {
    try {
      const encoded = value.startsWith('music:') ? value.slice(6) : value.slice(5);
      return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))?.url ?? null;
    } catch { return null; }
  }
  return value.startsWith('expired:') ? null : value;
}

export async function purgeExpiredAttachments() {
  const storage = getSupabaseAdmin();
  const cutoffDate = new Date(Date.now() - 14 * 86400_000);
  const cutoff = cutoffDate.toISOString();
  const [adminRows] = await pool.query("SELECT user_id FROM user_roles WHERE role IN ('admin','super_admin')");
  const admins = new Set(adminRows.map((row) => row.user_id));
  const summary = {};

  for (const table of tables) {
    summary[table] = { scanned: 0, purged: 0, objectsDeleted: 0 };
    let cursor = null;
    while (true) {
      const query = cursor
        ? pool.execute(`SELECT id, sender_id, image_url, created_at FROM \`${table}\` WHERE created_at < ? AND image_url IS NOT NULL AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at, id LIMIT 500`, [cutoffDate, cursor.created_at, cursor.created_at, cursor.id])
        : pool.execute(`SELECT id, sender_id, image_url, created_at FROM \`${table}\` WHERE created_at < ? AND image_url IS NOT NULL ORDER BY created_at, id LIMIT 500`, [cutoffDate]);
      const [rows] = await query;
      if (!rows.length) break;
      summary[table].scanned += rows.length;

      for (const row of rows) {
        cursor = { created_at: row.created_at, id: row.id };
        if (row.sender_id && admins.has(row.sender_id)) continue;
        let items;
        try {
          const parsed = JSON.parse(row.image_url);
          items = Array.isArray(parsed) ? parsed : [row.image_url];
        } catch { items = [row.image_url]; }
        if (!items.some((item) => typeof item === 'string' && !item.startsWith('expired:'))) continue;

        const byBucket = new Map();
        for (const item of items) {
          if (typeof item !== 'string') continue;
          const parsed = parseStorageUrl(extractUrl(item) || '');
          if (!parsed) continue;
          if (!byBucket.has(parsed.bucket)) byBucket.set(parsed.bucket, []);
          byBucket.get(parsed.bucket).push(parsed.path);
        }
        for (const [bucket, paths] of byBucket) {
          const { error } = await storage.storage.from(bucket).remove(paths);
          if (!error) summary[table].objectsDeleted += paths.length;
          else console.warn(`Storage delete failed (${bucket}):`, error.message);
        }
        await pool.execute(`UPDATE \`${table}\` SET image_url = ? WHERE id = ?`, [JSON.stringify([`expired:${placeholder}`]), row.id]);
        summary[table].purged++;
      }
      if (rows.length < 500) break;
    }
  }
  return { ok: true, cutoff, summary };
}

export async function cleanupExpiredAuthArtifacts() {
  const [sessions] = await pool.execute('DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
  const [codes] = await pool.execute('DELETE FROM auth_native_codes WHERE expires_at <= UTC_TIMESTAMP(3)');
  const [consumedCodes] = await pool.execute('DELETE FROM auth_native_codes WHERE consumed_at IS NOT NULL AND consumed_at < UTC_TIMESTAMP(3) - INTERVAL 1 DAY');
  const [emailTokens] = await pool.execute('DELETE FROM auth_email_tokens WHERE expires_at <= UTC_TIMESTAMP(3)');
  return {
    expiredSessions: sessions.affectedRows,
    expiredNativeCodes: codes.affectedRows,
    consumedNativeCodes: consumedCodes.affectedRows,
    expiredEmailTokens: emailTokens.affectedRows,
  };
}
