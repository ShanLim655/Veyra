# Administration and roles

Veyra has three application roles stored in the `user_roles` MariaDB table:

| Role | Label in UI | Powers |
| --- | --- | --- |
| `user` | — (default) | Standard member. No role row is also treated as `user`. |
| `admin` | Mod | Read access to all messages, conversations, and members; post announcements; moderate groups and content; view the Members and Analytics tabs. |
| `super_admin` | Admin | Everything `admin` can do, plus the Role Management and Admin Logs tabs, and exclusive permission to grant/revoke roles. |

A user may technically hold multiple `user_roles` rows (the unique key is
`(user_id, role)`), but the UI and `db:grant-role` treat role assignment as
one role per user — the grant script replaces all rows with a single role.

## How enforcement works

- **Frontend:** `useUserRole()` (`src/hooks/useUserRole.ts`) reads `user_roles`
  and exposes `isAdmin` / `isSuperAdmin`. `/admin` (`AdminDashboard`) redirects
  non-admins and only renders the Role Management and Admin Logs tabs for
  `super_admin`. UI gating is cosmetic only.
- **Backend (authoritative):** `server/data.mjs` checks `isAdmin()` /
  `isSuperAdmin()` inside the row-level policy for every `/api/data` request —
  admins bypass membership scoping on messages, conversations, reactions,
  polls, and announcements. `server/rpc.mjs` `adminCheck()` guards admin RPCs
  (`get_admin_analytics_counts`, `get_admin_daily_stats`,
  `get_admin_top_users`, `get_user_role_for_admin`). Only `super_admin` can
  insert/update/delete `user_roles` rows through the API; everyone can read
  only their own row.
- **Audit:** privileged UI actions write to `admin_logs` (insert restricted
  to admins logging their own `admin_id`); super admins can read the log.

## Granting the first admin (bootstrap)

Role changes through the API require an existing `super_admin`, so the first
grant must come from direct database access:

```bash
# By username or email; role is user|admin|super_admin|none
npm run db:grant-role -- alice super_admin
npm run db:grant-role -- alice@example.com admin
npm run db:grant-role -- alice none      # revoke all roles
```

The script (`server/grant-role.mjs`) resolves the user via `profiles.username`
or `auth_users.email`, then replaces their `user_roles` rows with the single
requested role inside a transaction. Equivalent raw SQL:

```sql
DELETE FROM user_roles WHERE user_id = '<profile-id>';
INSERT INTO user_roles (id, user_id, role)
VALUES (UUID(), '<profile-id>', 'super_admin');
```

`profiles.id` equals `auth_users.id`; find the id with
`SELECT id, username FROM profiles WHERE username = 'alice'`.

## Managing roles day to day

Once a `super_admin` exists, sign in and open **Admin Dashboard → Role
Management** (`/admin`). The tab lists every profile with their current role;
super admins can assign `user`, `admin`, or `super_admin`, or remove the role
entirely. Changes go through `/api/data` on `user_roles` and are written to
`admin_logs`.

Notes:

- Role reads are not realtime-pushed to other sessions; a user who is granted
  a role sees `/admin` access on their next role fetch (page load/reload).
- Removing your own `super_admin` role is allowed by the API but locks you out
  of role management — keep at least one other super admin if you demote
  yourself.
- There is no self-service admin signup path; roles are never assignable by
  non-super-admins through any endpoint.
