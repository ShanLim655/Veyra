import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { queryData } from './data.mjs';
import { callRpc } from './rpc.mjs';
import { sendTestNotification } from './notifications.mjs';
import { purgeExpiredAttachments } from './maintenance.mjs';

const app = express();
const port = Number(process.env.PORT || 3001);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!process.env.MARIADB_USER || !process.env.MARIADB_DATABASE) {
  throw new Error('MARIADB_USER and MARIADB_DATABASE are required.');
}
if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for Auth token verification.');
}

const authClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.use('/api', async (req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path === '/maintenance/purge-expired-attachments'
    && process.env.PURGE_CRON_SECRET
    && req.get('x-cron-secret') === process.env.PURGE_CRON_SECRET) {
    req.cronAuthorized = true;
    return next();
  }
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const { data, error } = await authClient.auth.getUser(match[1]);
    if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session.' });
    req.user = data.user;
    req.accessToken = match[1];
    next();
  } catch {
    res.status(401).json({ error: 'Unable to verify session.' });
  }
});

app.post('/api/data', async (req, res) => {
  try {
    res.json(await queryData(req.user.id, req.body));
  } catch (error) {
    const status = /not allowed|unknown table|unsupported/i.test(error.message) ? 403 : 400;
    res.status(status).json({ error: error.message || 'Database request failed.' });
  }
});

app.post('/api/rpc', async (req, res) => {
  try {
    res.json({ data: await callRpc(req.user.id, req.body?.name, req.body?.args || {}) });
  } catch (error) {
    const status = /not allowed|admin access|unsupported|only the|must be|access required/i.test(error.message) ? 403 : 400;
    res.status(status).json({ error: error.message || 'Database action failed.' });
  }
});

app.post('/api/notifications/test', async (req, res) => {
  try { res.json(await sendTestNotification(req.user.id)); }
  catch (error) { res.status(400).json({ ok: false, error: error.message }); }
});

app.post('/api/maintenance/purge-expired-attachments', async (req, res) => {
  if (!req.cronAuthorized) {
    const [rows] = await pool.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'super_admin' LIMIT 1", [req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Super admin access required.' });
  }
  try { res.json(await purgeExpiredAttachments()); }
  catch (error) { res.status(500).json({ error: error.message || 'Attachment cleanup failed.' }); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));

if (process.env.NODE_ENV === 'production') {
  const distPath = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(distPath));
  app.get(/.*/, (_req, res) => res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))));
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Veyra API listening on port ${port}.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await pool.end();
    process.exit(0);
  });
}
