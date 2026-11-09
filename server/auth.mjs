import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.mjs';

const scrypt = promisify(scryptCallback);
const COOKIE = 'veyra_session';
const SESSION_DAYS = 30;
const EMAIL_TOKEN_HOURS = 2;
const APP_URL = (process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:8080').replace(/\/$/, '');
const rateBuckets = new Map();

function allowRequest(req, res, name, limit = 10, windowMs = 15 * 60 * 1000) {
  const key = `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.until <= now) {
    rateBuckets.set(key, { count: 1, until: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) {
    res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    return false;
  }
  bucket.count++;
  return true;
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const cookieValue = (req, name) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((item) => { const index = item.indexOf('='); return index < 0 ? ['', ''] : [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())]; }))[name];
const randomToken = () => randomBytes(32).toString('base64url');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [salt, value] = String(stored).split(':');
  if (!salt || !value) return false;
  const expected = Buffer.from(value, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function sendSequenzyEmail(to, subject, html) {
  if (!process.env.SEQUENZY_API_KEY) throw new Error('Email delivery is not configured. Set SEQUENZY_API_KEY on the server.');
  const response = await fetch('https://api.sequenzy.com/api/v1/transactional/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SEQUENZY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, body: html, trackAs: 'veyra-auth' }),
  });
  if (!response.ok) throw new Error(`Sequenzy email delivery failed (${response.status}).`);
}

async function verifyCaptcha(token, remoteIp) {
  if (!process.env.HCAPTCHA_SECRET) {
    if (process.env.VITE_HCAPTCHA_SITE_KEY) throw new Error('hCaptcha is enabled in the frontend but HCAPTCHA_SECRET is missing on the API server.');
    return;
  }
  if (!token) throw Object.assign(new Error('Complete the captcha challenge.'), { status: 400 });
  const body = new URLSearchParams({ secret: process.env.HCAPTCHA_SECRET, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  const response = await fetch('https://api.hcaptcha.com/siteverify', { method: 'POST', body });
  const result = await response.json();
  if (!result.success) throw Object.assign(new Error('Captcha verification failed. Please try again.'), { status: 400 });
}

async function createEmailToken(userId, email, purpose) {
  const token = randomToken();
  await pool.execute('DELETE FROM auth_email_tokens WHERE user_id = ? AND purpose = ?', [userId, purpose]);
  await pool.execute(
    'INSERT INTO auth_email_tokens (id, user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR))',
    [randomUUID(), userId, hashToken(token), purpose, EMAIL_TOKEN_HOURS],
  );
  const link = purpose === 'confirm'
    ? `${APP_URL}/auth?token=${encodeURIComponent(token)}`
    : `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const name = escapeHtml(email);
  const isConfirm = purpose === 'confirm';
  await sendSequenzyEmail(
    email,
    isConfirm ? 'Confirm your Veyra email' : 'Reset your Veyra password',
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h1>${isConfirm ? 'Confirm your email' : 'Reset your password'}</h1><p>${isConfirm ? `Confirm the email address ${name} to finish creating your Veyra account.` : 'We received a request to reset your Veyra password.'}</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#171717;color:white;text-decoration:none;border-radius:8px">${isConfirm ? 'Confirm email' : 'Reset password'}</a></p><p>This link expires in ${EMAIL_TOKEN_HOURS} hours. If you did not request this, you can ignore this email.</p></div>`,
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400000 });
}

async function createSession(userId, res) {
  const token = randomToken();
  await pool.execute(
    'INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))',
    [randomUUID(), userId, hashToken(token), SESSION_DAYS],
  );
  setSessionCookie(res, token);
}

export async function authenticateRequest(req, res, next) {
  const token = cookieValue(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.email_verified_at, p.username, p.display_name
       FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
       JOIN profiles p ON p.id = u.id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3) AND u.email_verified_at IS NOT NULL LIMIT 1`,
      [hashToken(token)],
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid or expired session.' });
    req.user = { ...rows[0], user_metadata: { username: rows[0].username, display_name: rows[0].display_name } };
    next();
  } catch (error) { next(error); }
}

export function registerAuthRoutes(app) {
  app.post('/api/auth/signup', async (req, res) => {
    if (!allowRequest(req, res, 'signup', 5, 60 * 60 * 1000)) return;
    await verifyCaptcha(req.body?.captchaToken, req.ip);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const username = String(req.body?.username || email.split('@')[0]).trim().slice(0, 32);
    const displayName = String(req.body?.display_name || username).trim().slice(0, 80);
    if (!email.includes('@') || password.length < 8 || !username) return res.status(400).json({ error: 'Enter a valid email, username, and password of at least 8 characters.' });
    const userId = randomUUID();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('INSERT INTO auth_users (id, email, password_hash) VALUES (?, ?, ?)', [userId, email, await passwordHash(password)]);
      await connection.execute('INSERT INTO profiles (id, username, display_name, username_set) VALUES (?, ?, ?, TRUE)', [userId, username, displayName]);
      await connection.execute("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, 'user')", [randomUUID(), userId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        const [existing] = await pool.execute('SELECT id, email, email_verified_at FROM auth_users WHERE email = ? LIMIT 1', [email]);
        if (existing.length && !existing[0].email_verified_at) {
          try {
            await createEmailToken(existing[0].id, email, 'confirm');
            return res.status(201).json({ ok: true, message: 'A new confirmation email was sent. Check your inbox.' });
          } catch (mailError) {
            console.error('Confirmation email retry failed:', mailError);
            return res.status(502).json({ error: 'Could not send the confirmation email right now.' });
          }
        }
        return res.status(409).json({ error: 'That email or username is already in use.' });
      }
      throw error;
    } finally { connection.release(); }
    try { await createEmailToken(userId, email, 'confirm'); }
    catch (error) { console.error('Confirmation email failed:', error); return res.status(502).json({ error: 'Account created, but the confirmation email could not be sent. Please try again later.' }); }
    res.status(201).json({ ok: true, message: 'Account created. Check your email to confirm your address.' });
  });

  app.post('/api/auth/login', async (req, res) => {
    if (!allowRequest(req, res, 'login', 20)) return;
    await verifyCaptcha(req.body?.captchaToken, req.ip);
    const email = normalizeEmail(req.body?.email);
    const [rows] = await pool.execute('SELECT id, email, password_hash, email_verified_at FROM auth_users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !(await passwordMatches(String(req.body?.password || ''), user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    if (!user.email_verified_at) return res.status(403).json({ error: 'Please confirm your email before signing in.' });
    await createSession(user.id, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authenticateRequest, (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', async (req, res) => {
    const token = cookieValue(req, COOKIE);
    if (token) await pool.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [hashToken(token)]);
    res.clearCookie(COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });

  app.post('/api/auth/forgot', async (req, res) => {
    if (!allowRequest(req, res, 'forgot', 5, 60 * 60 * 1000)) return;
    await verifyCaptcha(req.body?.captchaToken, req.ip);
    const email = normalizeEmail(req.body?.email);
    const [rows] = await pool.execute('SELECT id, email FROM auth_users WHERE email = ? AND email_verified_at IS NOT NULL LIMIT 1', [email]);
    if (rows.length) {
      try { await createEmailToken(rows[0].id, rows[0].email, 'reset'); }
      catch (error) { console.error('Password reset email failed:', error); return res.status(502).json({ error: 'Could not send reset email right now.' }); }
    }
    res.json({ ok: true, message: 'If that account exists, a password reset link has been sent.' });
  });

  app.post('/api/auth/verify', async (req, res) => {
    const token = String(req.body?.token || '');
    const [rows] = await pool.execute("SELECT id, user_id FROM auth_email_tokens WHERE token_hash = ? AND purpose = 'confirm' AND expires_at > UTC_TIMESTAMP(3) LIMIT 1", [hashToken(token)]);
    if (!rows.length) return res.status(400).json({ error: 'Verification link is invalid or expired.' });
    await pool.execute('UPDATE auth_users SET email_verified_at = UTC_TIMESTAMP(3) WHERE id = ?', [rows[0].user_id]);
    await pool.execute('DELETE FROM auth_email_tokens WHERE id = ?', [rows[0].id]);
    res.json({ ok: true });
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const [rows] = await pool.execute('SELECT id, user_id FROM auth_email_tokens WHERE token_hash = ? AND purpose = \'reset\' AND expires_at > UTC_TIMESTAMP(3) LIMIT 1', [hashToken(token)]);
    if (!rows.length) return res.status(400).json({ error: 'Reset link is invalid or expired.' });
    await pool.execute('UPDATE auth_users SET password_hash = ? WHERE id = ?', [await passwordHash(password), rows[0].user_id]);
    await pool.execute('DELETE FROM auth_email_tokens WHERE user_id = ? AND purpose = \'reset\'', [rows[0].user_id]);
    await pool.execute('DELETE FROM auth_sessions WHERE user_id = ?', [rows[0].user_id]);
    res.clearCookie(COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });

  app.post('/api/auth/change-password', authenticateRequest, async (req, res) => {
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const [rows] = await pool.execute('SELECT password_hash FROM auth_users WHERE id = ?', [req.user.id]);
    if (!(await passwordMatches(String(req.body?.current_password || ''), rows[0]?.password_hash || ''))) return res.status(400).json({ error: 'Current password is incorrect.' });
    await pool.execute('UPDATE auth_users SET password_hash = ? WHERE id = ?', [await passwordHash(password), req.user.id]);
    res.json({ ok: true });
  });
}
