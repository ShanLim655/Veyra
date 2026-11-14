import express from 'express';
import { pool, isPostgres } from './db.mjs';
import { queryData } from './data.mjs';
import { callRpc } from './rpc.mjs';
import { sendTestNotification, deliverPushNotification } from './notifications.mjs';
import { purgeExpiredAttachments, cleanupExpiredAuthArtifacts } from './maintenance.mjs';
import { authenticateRequest, registerAuthRoutes } from './auth.mjs';
import { changesFromRpc, changeFromDataRequest, mariaDbRealtimeTopic, publishMariaDbChanges } from './realtime.mjs';
import { getSupabaseAdmin } from './supabase-admin.mjs';
import { invalidateReadCache, consumeRateLimit } from './redis.mjs';
import { assertEncryptionConfig, encryptionEnabled } from './encryption.mjs';
import { assertQueuesConfig } from './queues.mjs';

const MAX_PROFILE_IMAGE_BYTES = 25 * 1024 * 1024;
const PROFILE_UPLOAD_TYPES = new Set(['image/jpeg', 'image/gif']);
const CHAT_UPLOAD_BUCKETS = new Set(['chat-images', 'chat-videos', 'chat-voice']);
const MAX_CHAT_UPLOAD_BYTES = 25 * 1024 * 1024;

export function createApp() {
  const app = express();
  const missingDbConfig = isPostgres
    ? !process.env.POSTGRES_USER || !process.env.POSTGRES_DATABASE
    : !process.env.MARIADB_USER || !process.env.MARIADB_DATABASE;
  if (missingDbConfig) {
    throw new Error(isPostgres
      ? 'POSTGRES_USER and POSTGRES_DATABASE are required when USE_MARIADB=false.'
      : 'MARIADB_USER and MARIADB_DATABASE are required.');
  }
  assertEncryptionConfig();
  if (!encryptionEnabled()) {
    console.warn('MESSAGE_ENCRYPTION_KEY is not set; message content will be stored without database encryption.');
  }
  assertQueuesConfig();
  app.disable('x-powered-by');
  // Vercel/other reverse proxies append the real client IP to X-Forwarded-For;
  // trusting one hop makes req.ip (used by auth rate limits) the client IP.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Voice messages need the microphone; nothing else is required.
    res.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    if (process.env.NODE_ENV === 'production' && String(process.env.APP_URL || '').startsWith('https://')) {
      res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    next();
  });
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
  // Public release-metadata proxy. Clients (Android WebView, desktop, web)
  // cannot always fetch GitHub release downloads directly — redirects to asset
  // hosts break CORS — so the API fetches latest.json server-side and caches it.
  const RELEASE_METADATA_URL = 'https://github.com/ShanLim655/Veyra/releases/latest/download/latest.json';
  let releaseCache = { at: 0, body: null };
  app.get('/api/app-version', async (_req, res) => {
    try {
      if (releaseCache.body && Date.now() - releaseCache.at < 5 * 60_000) {
        return res.json(releaseCache.body);
      }
      const response = await fetch(RELEASE_METADATA_URL, {
        signal: AbortSignal.timeout(6000),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        // Keep serving a stale copy rather than flapping between "no release"
        // and an error when GitHub hiccups.
        if (releaseCache.body) return res.json(releaseCache.body);
        return res.status(404).json({ error: 'no_release' });
      }
      const body = await response.json();
      releaseCache = { at: Date.now(), body };
      res.json(body);
    } catch {
      if (releaseCache.body) return res.json(releaseCache.body);
      res.status(503).json({ error: 'release_unavailable' });
    }
  });
  app.use('/api', async (req, res, next) => {
    if (req.path === '/health') return next();
    if (req.path === '/maintenance/purge-expired-attachments' && process.env.PURGE_CRON_SECRET && req.get('x-cron-secret') === process.env.PURGE_CRON_SECRET) {
      req.cronAuthorized = true;
      return next();
    }
    if (req.path === '/queues/deliver' && process.env.QUEUES_WORKER_SECRET && req.get('x-queue-worker-secret') === process.env.QUEUES_WORKER_SECRET) {
      req.queueWorkerAuthorized = true;
      return next();
    }
    authenticateRequest(req, res, next);
  });
  app.post('/api/data', async (req, res) => {
    try {
      // Generous per-user ceiling; only enforced when Redis is configured.
      const limited = await consumeRateLimit(`data:${req.user.id}`, 600, 60_000);
      if (limited && !limited.allowed) {
        return res.status(429).json({ error: 'Too many requests. Please slow down and try again.' });
      }
      const result = await queryData(req.user.id, req.body);
      const change = changeFromDataRequest(req.body, result);
      if (change) await publishMariaDbChanges([change], req.user.id);
      const response = { ...result };
      delete response.realtimeRows;
      res.json(response);
    }
    catch (error) {
      // Never leak driver/internal error details to clients.
      if (typeof error?.code === 'string' && error.code.startsWith('ER_')) {
        console.error('Data request failed:', error);
        return res.status(500).json({ error: 'The server could not complete the request.' });
      }
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
      if (typeof error?.code === 'string' && error.code.startsWith('ER_')) {
        console.error('RPC request failed:', error);
        return res.status(500).json({ error: 'The server could not complete the request.' });
      }
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
    try {
      const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data?.token) throw error || new Error('Could not create upload link.');
      const { data: publicData } = getSupabaseAdmin().storage.from(bucket).getPublicUrl(path);
      res.json({ path, token: data.token, publicUrl: publicData.publicUrl, contentType });
    } catch (error) {
      console.error('Chat media upload link failed:', error);
      res.status(503).json({ error: 'Chat media storage is not configured.' });
    }
  });
  app.post('/api/storage/chat-read', async (req, res) => {
    const storage = getSupabaseAdmin();
    const batch = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : null;
    const items = batch || [req.body || {}];
    const validated = [];
    for (const item of items) {
      const { bucket, path } = item || {};
      const parts = typeof path === 'string' ? path.split('/') : [];
      if (!CHAT_UPLOAD_BUCKETS.has(bucket) || parts.length < 3 || parts.length > 8
        || parts.some((part) => !part || part === '.' || part === '..') || path.length > 512) {
        return res.status(400).json({ error: 'Invalid media path.' });
      }
      validated.push({ bucket, path, scope: parts[1] });
    }
    try {
      // One membership lookup per conversation scope covers every item in the batch.
      const scopes = [...new Set(validated.map((item) => item.scope))]
        .filter((scope) => scope !== 'global' && scope !== 'announcements');
      for (const scope of scopes) {
        const [members] = await pool.execute(
          'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1',
          [scope, req.user.id],
        );
        if (!members.length) return res.status(403).json({ error: 'You cannot access this conversation media.' });
      }
      const signed = await Promise.all(validated.map(async ({ bucket, path }) => {
        const { data, error } = await storage.storage.from(bucket).createSignedUrl(path, 3600);
        return { key: `${bucket}/${path}`, url: error ? null : data?.signedUrl || null };
      }));
      if (batch) {
        const urls = {};
        for (const entry of signed) if (entry.url) urls[entry.key] = entry.url;
        res.set('Cache-Control', 'private, max-age=300').json({ urls, expiresIn: 3600 });
        return;
      }
      const url = signed[0]?.url;
      if (!url) return res.status(404).json({ error: 'Media is missing or unavailable.' });
      res.set('Cache-Control', 'private, max-age=300').json({ url, expiresIn: 3600 });
    } catch (error) {
      console.error('Chat media read signing failed:', error);
      res.status(503).json({ error: 'Chat media storage is unavailable.' });
    }
  });
  // Worker endpoint for optional Altare Queues consumers. A queue worker posts
  // jobs of type "notifications.deliver" here to perform the actual ntfy send.
  app.post('/api/queues/deliver', async (req, res) => {
    if (!req.queueWorkerAuthorized) return res.status(403).json({ error: 'Queue worker authorization required.' });
    const { server, topic, title, message } = req.body || {};
    try {
      const ok = await deliverPushNotification({ server, topic, title, message });
      res.json({ ok });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Notification delivery failed.' });
    }
  });
  app.post('/api/maintenance/purge-expired-attachments', async (req, res) => {
    if (!req.cronAuthorized) {
      const [rows] = await pool.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin' LIMIT 1", [req.user.id]);
      if (!rows.length) return res.status(403).json({ error: 'Super admin access required.' });
    }
    try {
      const attachments = await purgeExpiredAttachments();
      const authCleanup = await cleanupExpiredAuthArtifacts();
      res.json({ ...attachments, authCleanup });
    }
    catch (error) { res.status(500).json({ error: error.message || 'Attachment cleanup failed.' }); }
  });
  app.use((error, _req, res, _next) => {
    console.error('API request failed:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'The server could not complete the request.' });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  return app;
}
