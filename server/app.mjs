import express from 'express';
import path from 'node:path';
import { pool } from './db.mjs';
import { queryData } from './data.mjs';
import { callRpc } from './rpc.mjs';
import { sendTestNotification } from './notifications.mjs';
import { purgeExpiredAttachments } from './maintenance.mjs';
import { authenticateRequest, registerAuthRoutes } from './auth.mjs';
import { changesFromRpc, changeFromDataRequest, mariaDbRealtimeTopic, publishMariaDbChanges } from './realtime.mjs';
import { getSupabaseAdmin } from './supabase-admin.mjs';
import { invalidateReadCache } from './redis.mjs';
import { normalizeChatUploadType } from './uploads.mjs';

const MAX_PROFILE_IMAGE_BYTES = 25 * 1024 * 1024;
const PROFILE_UPLOAD_TYPES = new Set(['image/jpeg', 'image/gif']);
const CHAT_UPLOAD_BUCKETS = new Set(['chat-images', 'chat-videos', 'chat-voice']);
const MAX_CHAT_UPLOAD_BYTES = 25 * 1024 * 1024;

export function createApp({ staticDirectory = null } = {}) {
  const app = express();
  if (process.env.VERCEL === '1') {
    app.set('trust proxy', 1);
  } else if (process.env.TRUST_PROXY_HOPS !== undefined && process.env.TRUST_PROXY_HOPS !== '') {
    const hops = process.env.TRUST_PROXY_HOPS;
    if (hops === 'false') app.set('trust proxy', false);
    else if (/^\d+$/.test(hops)) app.set('trust proxy', Number(hops));
    else throw new Error('TRUST_PROXY_HOPS must be false or a non-negative integer.');
  }
  if (!process.env.MARIADB_USER || !process.env.MARIADB_DATABASE) throw new Error('MARIADB_USER and MARIADB_DATABASE are required.');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    const requestUrl = new URL(req.url || '/', 'http://veyra.local');
    const apiPath = requestUrl.searchParams.get('apiPath') || requestUrl.searchParams.get('__api_path');
    if (apiPath) {
      requestUrl.searchParams.delete('apiPath');
      requestUrl.searchParams.delete('__api_path');
      req.url = `/api/${apiPath.replace(/^\/+/, '')}${requestUrl.search}`;
    }
    next();
  });
  registerAuthRoutes(app);
  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
    catch { res.status(503).json({ ok: false, database: 'unavailable' }); }
  });
  app.use('/api', async (req, res, next) => {
    if (req.path === '/health') return next();
    if (req.path === '/maintenance/purge-expired-attachments' && process.env.PURGE_CRON_SECRET && req.get('x-cron-secret') === process.env.PURGE_CRON_SECRET) {
      req.cronAuthorized = true;
      return next();
    }
    authenticateRequest(req, res, next);
  });
  app.post('/api/data', async (req, res) => {
    try {
      const result = await queryData(req.user.id, req.body);
      const change = changeFromDataRequest(req.body, result);
      if (change) await publishMariaDbChanges([change], req.user.id);
      const response = { ...result };
      delete response.realtimeRows;
      res.json(response);
    }
    catch (error) {
      const status = /not allowed|unknown table|unsupported/i.test(error.message) ? 403 : 400;
      res.status(status).json({ error: error.message || 'Database request failed.' });
    }
  });
  app.post('/api/rpc', async (req, res) => {
    try {
      const name = req.body?.name;
      const args = req.body?.args || {};
      const data = await callRpc(req.user.id, name, args);
      const changes = changesFromRpc(name, args, data);
      if (changes.length) {
        await Promise.all([...new Set(changes.map((change) => change.table))].map(invalidateReadCache));
        await publishMariaDbChanges(changes, req.user.id);
      }
      res.json({ data });
    }
    catch (error) {
      const status = /not allowed|admin access|unsupported|only the|must be|access required/i.test(error.message) ? 403 : 400;
      res.status(status).json({ error: error.message || 'Database action failed.' });
    }
  });
  app.post('/api/notifications/test', async (req, res) => {
    try { res.json(await sendTestNotification(req.user.id)); }
    catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });
  app.get('/api/realtime/topic', (req, res) => {
    try { res.json({ topic: mariaDbRealtimeTopic(req.user.id) }); }
    catch (error) { res.status(503).json({ error: error.message || 'Live updates are not configured.' }); }
  });
  app.post('/api/storage/profile-upload', async (req, res) => {
    const { bucket, contentType, size } = req.body || {};
    if (!['avatars', 'banners'].includes(bucket)) return res.status(400).json({ error: 'Unsupported profile image bucket.' });
    if (!PROFILE_UPLOAD_TYPES.has(contentType)) return res.status(400).json({ error: 'Only JPEG and GIF profile images are supported.' });
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PROFILE_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Maximum file size is 25 MB.' });
    }

    try {
      const path = `${req.user.id}/${bucket === 'avatars' ? 'avatar' : 'banner'}`;
      const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
      if (error || !data?.token) throw error || new Error('Could not create a secure upload link.');
      const { data: publicData } = getSupabaseAdmin().storage.from(bucket).getPublicUrl(path);
      res.json({ path, token: data.token, publicUrl: publicData.publicUrl });
    } catch (error) {
      console.error('Profile image upload link failed:', error);
      res.status(503).json({ error: 'Profile image storage is not configured.' });
    }
  });
  app.post('/api/storage/chat-upload', async (req, res) => {
    const { bucket, path, contentType, size } = req.body || {};
    if (!CHAT_UPLOAD_BUCKETS.has(bucket) || typeof path !== 'string' || path.length > 512
      || path.split('/')[0] !== req.user.id || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      return res.status(400).json({ error: 'Invalid chat upload path.' });
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_CHAT_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'Maximum file size is 25 MB.' });
    }
    const storageContentType = normalizeChatUploadType(bucket, contentType);
    if (!storageContentType) return res.status(415).json({ error: 'SVG uploads are not supported.' });
    try {
      const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data?.token) throw error || new Error('Could not create upload link.');
      const { data: publicData } = getSupabaseAdmin().storage.from(bucket).getPublicUrl(path);
      res.json({ path, token: data.token, publicUrl: publicData.publicUrl, contentType: storageContentType });
    } catch (error) {
      console.error('Chat media upload link failed:', error);
      res.status(503).json({ error: 'Chat media storage is not configured.' });
    }
  });
  app.post('/api/storage/chat-read', async (req, res) => {
    const { bucket, path } = req.body || {};
    const parts = typeof path === 'string' ? path.split('/') : [];
    if (!CHAT_UPLOAD_BUCKETS.has(bucket) || parts.length < 3 || parts.length > 8
      || parts.some((part) => !part || part === '.' || part === '..') || path.length > 512) {
      return res.status(400).json({ error: 'Invalid media path.' });
    }
    const scope = parts[1];
    try {
      if (scope !== 'global' && scope !== 'announcements') {
        const [members] = await pool.execute(
          'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1',
          [scope, req.user.id],
        );
        if (!members.length) return res.status(403).json({ error: 'You cannot access this conversation media.' });
      }
      const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return res.status(404).json({ error: 'Media is missing or unavailable.' });
      res.set('Cache-Control', 'private, max-age=300').json({ url: data.signedUrl, expiresIn: 3600 });
    } catch (error) {
      console.error('Chat media read signing failed:', error);
      res.status(503).json({ error: 'Chat media storage is unavailable.' });
    }
  });
  app.post('/api/maintenance/purge-expired-attachments', async (req, res) => {
    if (!req.cronAuthorized) {
      const [rows] = await pool.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin' LIMIT 1", [req.user.id]);
      if (!rows.length) return res.status(403).json({ error: 'Super admin access required.' });
    }
    try { res.json(await purgeExpiredAttachments()); }
    catch (error) { res.status(500).json({ error: error.message || 'Attachment cleanup failed.' }); }
  });
  if (staticDirectory) {
    app.use(express.static(staticDirectory));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(staticDirectory, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    console.error('API request failed:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'The server could not complete the request.' });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  return app;
}
