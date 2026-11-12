// Grant or revoke an application role for a user.
//
// Usage:
//   npm run db:grant-role -- <username-or-email> <user|admin|super_admin|none>
//
// Examples:
//   npm run db:grant-role -- alice admin
//   npm run db:grant-role -- alice@example.com super_admin
//   npm run db:grant-role -- alice none        # remove all role rows
//
// This is the bootstrap path for the FIRST super_admin: role changes through
// the API/UI require an existing super_admin, so the initial grant must come
// from direct database access like this script. Afterwards, super admins can
// manage roles from the Admin Dashboard → Role Management tab.
import { randomUUID } from 'node:crypto';
import { pool } from './db.mjs';

const VALID_ROLES = new Set(['user', 'admin', 'super_admin']);
const [identifier, roleArg] = process.argv.slice(2);
const role = String(roleArg || '').trim().toLowerCase();

try {
  if (!identifier || !role) {
    console.error('Usage: npm run db:grant-role -- <username-or-email> <user|admin|super_admin|none>');
    process.exitCode = 1;
  } else if (role !== 'none' && !VALID_ROLES.has(role)) {
    console.error(`Invalid role "${roleArg}". Expected one of: user, admin, super_admin, none.`);
    process.exitCode = 1;
  } else {
    const isEmail = identifier.includes('@');
    const [rows] = isEmail
      ? await pool.execute('SELECT p.id, p.username FROM profiles p JOIN auth_users a ON a.id = p.id WHERE a.email = ? LIMIT 1', [identifier.trim().toLowerCase()])
      : await pool.execute('SELECT id, username FROM profiles WHERE username = ? LIMIT 1', [identifier.trim()]);

    if (!rows.length) {
      console.error(`No user found for "${identifier}"${isEmail ? ' (email)' : ' (username)'}.`);
      process.exitCode = 1;
    } else {
      const user = rows[0];
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute('DELETE FROM user_roles WHERE user_id = ?', [user.id]);
        if (role !== 'none') {
          await connection.execute('INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)', [randomUUID(), user.id, role]);
        }
        await connection.commit();
        console.log(`${user.username} (${user.id}): role set to ${role === 'none' ? 'none (all roles removed)' : role}.`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  }
} catch (error) {
  console.error('Role change failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
