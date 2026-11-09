# Veyra

Veyra is a real-time messaging app built with React, Vite, TypeScript, Tailwind CSS, and shadcn/ui. It supports private and group chats, global chat, announcements, profiles, moderation, media sharing, voice messages, polls, mentions, reactions, and notifications.

## Architecture

- **MariaDB** stores the 19 application tables: profiles, conversations, messages, friendships, roles, polls, notification preferences, and related data.
- **Supabase Auth** manages accounts, sessions, MFA, password recovery, and linked identities.
- **Supabase Storage** stores avatars, banners, chat images, videos, and voice messages.
- **Node.js** serves the app API on the same VPS as MariaDB. It verifies Supabase access tokens before reading or writing application data.
- **Supabase Realtime** remains in use for presence. Data-change listeners refresh from the MariaDB API every five seconds.

MariaDB credentials stay on the server. Only the Supabase URL, publishable key, and hCaptcha site key are used by the browser.

## Features

- Email login, signup, password reset, hCaptcha, MFA, OAuth linking, and session management.
- Direct messages, group membership and roles, global chat, and announcements.
- Replies, edits, emoji reactions, markdown, mentions, files, images, video, music cards, and voice messages.
- Single-choice and multiple-choice polls.
- Profiles, custom status, privacy, notifications, and theme settings.
- Admin tools for member management, analytics, roles, moderation, and logs.
- ntfy push notifications and cleanup of old chat attachments.

## Setup

### 1. Install

Use Node.js 20 or later, MariaDB 10.5 or later, and npm:

```bash
npm install
```

### 2. Configure MariaDB

MariaDB should listen on loopback on the same VPS as the app. Create a database and a restricted application user:

```sql
CREATE DATABASE veyra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'veyra_app'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON veyra.* TO 'veyra_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Copy `.env.example` to `.env.local` and set `MARIADB_*` values. `.env.local` is ignored by Git. Keep MariaDB off the public internet.

### 3. Configure Supabase

Set the same Supabase project URL and publishable (or legacy anon) key for `SUPABASE_*` and `VITE_SUPABASE_*`. Set `VITE_HCAPTCHA_SITE_KEY` as well. Never put `SUPABASE_SERVICE_ROLE_KEY` or MariaDB credentials in a `VITE_*` variable.

In Supabase Dashboard:

1. Enable Email Auth and any OAuth providers you use.
2. Set the Site URL to the deployed app URL.
3. Add password-reset redirect URLs for production and local development, including `/reset-password`.
4. Keep the app's Storage buckets and policies configured:

   | Bucket | Access | Contents |
   | --- | --- | --- |
   | `avatars` | Public read | Profile and group avatars |
   | `banners` | Public read | Profile banners |
   | `chat-images` | Private | Chat images and files |
   | `chat-videos` | Private | Chat videos |
   | `chat-voice` | Private | Voice messages |

Existing Supabase accounts and stored files remain in Supabase. MariaDB profile IDs use the matching Supabase Auth user IDs.

### 4. Create the application tables

Apply `database/schema.sql` to MariaDB:

```bash
npm run db:migrate
```

### 5. Import existing application data (optional)

To copy current public tables out of Supabase Postgres, temporarily set `LEGACY_POSTGRES_URL` in `.env.local` to the project's PostgreSQL connection string, then run:

```bash
npm run db:import:legacy
```

The import expects the MariaDB schema to exist with no application rows. It copies all 19 application tables and preserves their IDs without changing or deleting the source data. Supabase Auth accounts and Storage objects stay in Supabase. Remove `LEGACY_POSTGRES_URL` from `.env.local` after the import.

### 6. Start development

```bash
npm run dev
```

Vite serves the frontend on `http://localhost:8080` and proxies `/api` to the Node server on port `3001`.

## Production on the VPS

Build the frontend with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_HCAPTCHA_SITE_KEY` set in the build environment:

```bash
npm ci
npm run build
npm run db:migrate
npm start
```

The Node server hosts both the compiled frontend and API on `PORT` (default `3001`). Run it as a managed service and put Nginx or Caddy in front for HTTPS. Keep MariaDB bound to loopback. The old static Vercel setup cannot connect to a MariaDB instance on this VPS; deploy the app server on the VPS with the database.

## Attachment cleanup and notifications

`SUPABASE_SERVICE_ROLE_KEY` is server-only and is needed to delete expired objects from Supabase Storage. To run cleanup from a scheduler, set a long random `PURGE_CRON_SECRET` on the VPS and send it in the `x-cron-secret` header to:

```text
POST /api/maintenance/purge-expired-attachments
```

The cleanup marks chat attachments older than 14 days as expired and exempts admins. Without a cron secret, a signed-in `super_admin` can call the endpoint. ntfy server URL and notification preferences are stored in MariaDB; the server restricts outbound ntfy hosts to the configured supported servers.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and the Node API |
| `npm run build` | Build the frontend |
| `npm start` | Serve the production frontend and API |
| `npm run db:migrate` | Initialize the MariaDB schema |
| `npm run db:import:legacy` | Import Supabase Postgres app tables into MariaDB |
| `npm run lint` | Run ESLint |

The `supabase/migrations/` and `supabase/functions/` directories are retained as historical PostgreSQL material. Do not run `supabase db push` for the application tables. Make MariaDB schema changes in `database/schema.sql`.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Authenticated home |
| `/auth` | Sign in, signup, and password recovery |
| `/reset-password` | Password recovery |
| `/chat` | Friends, direct messages, and groups |
| `/global-chat` | Community chat |
| `/announcements` | Announcement channel |
| `/settings` | Profile, account, privacy, and notifications |
| `/admin` | Admin and moderation dashboard |
