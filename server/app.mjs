import express from 'express';
import { pool } from './db.mjs';
import { queryData } from './data.mjs';
import { callRpc } from './rpc.mjs';
import { sendTestNotification } from './notifications.mjs';
import { purgeExpiredAttachments } from './maintenance.mjs';
import { authenticateRequest, registerAuthRoutes } from './auth.mjs';

export function createApp() {
  const app = express();
  if (!process.env.MARIADB_USER || !process.env.MARIADB_DATABASE) throw new Error('MARIADB_USER and MARIADB_DATABASE are required.');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
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
    try { res.json(await queryData(req.user.id, req.body)); }
    catch (error) {
      const status = /not allowed|unknown table|unsupported/i.test(error.message) ? 403 : 400;
      res.status(status).json({ error: error.message || 'Database request failed.' });
    }
  });
  app.post('/api/rpc', async (req, res) => {
    try { res.json({ data: await callRpc(req.user.id, req.body?.name, req.body?.args || {}) }); }
    catch (error) {
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
  app.use((error, _req, res, _next) => {
    console.error('API request failed:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'The server could not complete the request.' });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  return app;
}
