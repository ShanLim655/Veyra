import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.mjs';

const scrypt = promisify(scryptCallback);
const COOKIE = 'veyra_session';
const GOOGLE_STATE_COOKIE = 'veyra_google_oauth';
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

function safeReturnTo(value) {
  const candidate = String(value || '/').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return '/';
  try {
    const parsed = new URL(candidate, APP_URL);
    return parsed.origin === new URL(APP_URL).origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/';
  } catch {
    return '/';
  }
}

function authRedirect(res, error, returnPath = '/auth') {
  const url = new URL(`${APP_URL}${safeReturnTo(returnPath)}`);
  url.searchParams.set('error', error);
  return res.redirect(302, url.toString());
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function availableGoogleUsername(connection, email) {
  const localPart = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'user';
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = attempt === 0 ? '' : `_${randomBytes(3).toString('hex')}`;
    const username = `${localPart.slice(0, 32 - suffix.length)}${suffix}`;
    const [rows] = await connection.execute('SELECT id FROM profiles WHERE username = ? LIMIT 1', [username]);
    if (!rows.length) return username;
  }
  throw new Error('Could not generate a unique username for the Google account.');
}

async function createOrVerifyGoogleUser(profile) {
  const email = normalizeEmail(profile.email);
  const connection = await pool.getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    const [identities] = await connection.execute(
      "SELECT user_id FROM auth_identities WHERE provider = 'google' AND provider_user_id = ? LIMIT 1 FOR UPDATE",
      [profile.sub],
    );
    if (identities.length) {
      userId = identities[0].user_id;
    } else {
      const [users] = await connection.execute('SELECT id FROM auth_users WHERE email = ? LIMIT 1 FOR UPDATE', [email]);
      if (users.length) {
        userId = users[0].id;
      } else {
        userId = randomUUID();
        const username = await availableGoogleUsername(connection, email);
        const displayName = String(profile.name || email.split('@')[0]).trim().slice(0, 80);
        await connection.execute(
          'INSERT INTO auth_users (id, email, password_hash, email_verified_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))',
          [userId, email, await passwordHash(randomToken())],
        );
        await connection.execute('INSERT INTO profiles (id, username, display_name, username_set) VALUES (?, ?, ?, TRUE)', [userId, username, displayName]);
        await connection.execute("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, 'user')", [randomUUID(), userId]);
      }
      await connection.execute(
        'INSERT INTO auth_identities (id, user_id, provider, provider_user_id) VALUES (?, ?, ?, ?)',
        [randomUUID(), userId, 'google', profile.sub],
      );
    }
    await connection.execute('UPDATE auth_users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(3)) WHERE id = ?', [userId]);
    const [profiles] = await connection.execute('SELECT id FROM profiles WHERE id = ? LIMIT 1', [userId]);
    if (!profiles.length) {
      const username = await availableGoogleUsername(connection, email);
      const displayName = String(profile.name || email.split('@')[0]).trim().slice(0, 80);
      await connection.execute('INSERT INTO profiles (id, username, display_name, username_set) VALUES (?, ?, ?, TRUE)', [userId, username, displayName]);
    }
    await connection.execute("INSERT IGNORE INTO user_roles (id, user_id, role) VALUES (?, ?, 'user')", [randomUUID(), userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return userId;
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
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : cookieValue(req, COOKIE);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.email_verified_at, p.username, p.display_name, p.avatar_url
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
  app.post('/api/auth/native/pair/start', async (req, res) => {
    const clientId = String(req.body?.clientId || '');
    if (!['android', 'desktop'].includes(clientId)) return res.status(400).json({ error: 'Unsupported app type.' });
    const code = randomToken();
    const id = randomUUID();
    await pool.execute(
      'INSERT INTO auth_native_codes (id, code_hash, client_id, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE))',
      [id, hashToken(code), clientId],
    );
    res.json({ code, clientId, approveUrl: `${APP_URL}/pair?code=${encodeURIComponent(code)}&clientId=${encodeURIComponent(clientId)}`, expiresIn: 300 });
  });

  app.post('/api/auth/native/pair/approve', authenticateRequest, async (req, res) => {
    const code = String(req.body?.code || '');
    const [result] = await pool.execute(
      'UPDATE auth_native_codes SET user_id = ? WHERE code_hash = ? AND user_id IS NULL AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(3)',
      [req.user.id, hashToken(code)],
    );
    if (!result.affectedRows) return res.status(400).json({ error: 'Pairing code is invalid, expired, or already approved.' });
    const [rows] = await pool.execute('SELECT client_id FROM auth_native_codes WHERE code_hash = ? LIMIT 1', [hashToken(code)]);
    res.json({ ok: true, clientId: rows[0]?.client_id });
  });

  app.post('/api/auth/native/exchange', async (req, res) => {
    const code = String(req.body?.code || '');
    const clientId = String(req.body?.clientId || '');
    if (code.length < 32 || code.length > 128 || !['android', 'desktop'].includes(clientId)) {
      return res.status(400).json({ error: 'Invalid pairing request.' });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT id, user_id, client_id FROM auth_native_codes WHERE code_hash = ? AND client_id = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(3) LIMIT 1 FOR UPDATE',
        [hashToken(code), clientId],
      );
      if (!rows.length) {
        await connection.rollback();
        return res.status(400).json({ error: 'Pairing code is invalid or expired.' });
      }
      if (!rows[0].user_id) {
        await connection.rollback();
        return res.status(202).json({ pending: true });
      }
      const token = randomToken();
      await connection.execute(
        'INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))',
        [randomUUID(), rows[0].user_id, hashToken(token), SESSION_DAYS],
      );
      await connection.execute('UPDATE auth_native_codes SET consumed_at = UTC_TIMESTAMP(3) WHERE id = ?', [rows[0].id]);
      const [users] = await connection.execute(
        'SELECT u.id, u.email, p.username, p.display_name FROM auth_users u JOIN profiles p ON p.id = u.id WHERE u.id = ? LIMIT 1',
        [rows[0].user_id],
      );
      await connection.commit();
      res.json({ token, clientId: rows[0].client_id, user: users[0] });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  });

  app.get('/api/auth/google', (req, res) => {
    if (!allowRequest(req, res, 'google-auth', 20)) return;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const returnTo = safeReturnTo(req.query.returnTo);
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return authRedirect(res, 'google_not_configured', returnTo);
    const state = randomToken();
    const verifier = randomToken();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    res.cookie(GOOGLE_STATE_COOKIE, `${state}.${verifier}.${Buffer.from(returnTo).toString('base64url')}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/google',
      maxAge: 10 * 60 * 1000,
    });
    const redirectUri = `${APP_URL}/api/auth/google/callback`;
    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    res.redirect(302, authorizationUrl.toString());
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const storedState = cookieValue(req, GOOGLE_STATE_COOKIE);
    res.clearCookie(GOOGLE_STATE_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/google',
    });
    try {
      const [expectedState, verifier, encodedReturnTo] = String(storedState || '').split('.');
      let returnTo = '/';
      try { if (encodedReturnTo) returnTo = safeReturnTo(Buffer.from(encodedReturnTo, 'base64url').toString()); } catch {}
      if (req.query.error) {
        const errorUrl = new URL(`${APP_URL}${returnTo === '/' ? '/auth' : returnTo}`);
        errorUrl.searchParams.set('error', 'google_access_denied');
        return res.redirect(302, errorUrl.toString());
      }
      if (!expectedState || !verifier || !timingSafeStringEqual(expectedState, req.query.state)) return authRedirect(res, 'google_state_invalid', returnTo);
      if (!req.query.code) return authRedirect(res, 'google_auth_failed', returnTo);

      const redirectUri = `${APP_URL}/api/auth/google/callback`;
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          code: String(req.query.code),
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) throw new Error(`Google token exchange failed (${tokenResponse.status}).`);

      const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await userInfoResponse.json();
      if (!userInfoResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
        throw new Error('Google did not return a verified email address.');
      }
      const email = normalizeEmail(profile.email);
      if (!email.endsWith('@gmail.com') && !profile.hd) return authRedirect(res, 'google_email_not_supported');
      const userId = await createOrVerifyGoogleUser({ ...profile, email });
      await createSession(userId, res);
      return res.redirect(302, `${APP_URL}${returnTo}`);
    } catch (error) {
      console.error('Google OAuth callback failed:', error);
      return authRedirect(res, 'google_auth_failed', returnTo);
    }
  });

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
    const authorization = String(req.headers.authorization || '');
    const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
    const cookieToken = cookieValue(req, COOKIE);
    const tokens = [...new Set([bearerToken, cookieToken].filter(Boolean))];
    if (tokens.length) await pool.execute(`DELETE FROM auth_sessions WHERE token_hash IN (${tokens.map(() => '?').join(',')})`, tokens.map(hashToken));
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
