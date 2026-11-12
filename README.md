# Veyra

Veyra is a real-time messaging app built with React, Vite, TypeScript, Tailwind CSS, and shadcn/ui. It supports private and group chats, global chat, announcements, profiles, moderation, media sharing, voice messages, polls, mentions, reactions, and notifications.

Desktop and Android installers are built and released through GitHub Actions. See [Releases.md](Releases.md) for versioning, publishing, signing, and update behavior.

## Architecture

- **MariaDB** stores the 19 messaging and product data tables plus the authentication tables for users, sessions, email tokens, and Google identities.
- **MariaDB and the Node API** manage accounts, password hashes, sessions, email verification, and password recovery.
- **Sequenzy** sends account verification and password reset emails through its transactional API.
- **Supabase Storage** stores avatars, banners, chat images, videos, and voice messages.
- **Node.js** API and MariaDB power accounts and application data. The API can run on a server or as a Vercel Function.
- **Supabase Realtime** carries presence and lightweight, member-scoped MariaDB change notices. Redis provides short-lived authenticated read caching, request coalescing, shared rate limiting, and a bounded retry queue for change notices; MariaDB remains the permanent source of truth.
- **Message content encryption:** sensitive message text (`messages`, `global_messages`, `announcement_messages` content and poll questions) is encrypted with AES-256-GCM on the server before reaching MariaDB. This is encryption at rest, not end-to-end encryption — the API decrypts for authorized reads and moderation. See [docs/message-encryption.md](docs/message-encryption.md).
- **Optional Altare Queues:** background jobs such as notification delivery can be published to an external queue, fully disabled by default with inline fallback. See [docs/queues.md](docs/queues.md).

MariaDB, Google OAuth, and Sequenzy credentials stay on the server. The browser uses Supabase for Storage, presence, and receiving scoped change notices.

## Features

- Email signup, verified email login, password reset, and password changes.
- Google sign-in backed by the same MariaDB account and session tables.
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

For local development, create a database and application user in MariaDB:

```sql
CREATE DATABASE veyra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'veyra_app'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON veyra.* TO 'veyra_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Copy `.env.example` to `.env.local` and set `MARIADB_*` values. `.env.local` is ignored by Git. For Vercel, use Layerbase's pooled connection details, set `MARIADB_SSL=true`, and keep the pool size at `1` (the server caps it at `2`). Layerbase's free MariaDB sleeps after inactivity, so its first connection can take longer while the database wakes.

### 3. Configure Supabase

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Storage reads and Realtime. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-only; the service key creates signed avatar/banner uploads and sends MariaDB change broadcasts, and also supports expired-object cleanup. Set `APP_URL` to the public app origin and `SEQUENZY_API_KEY` to a Sequenzy company API key with `transactional:send` permission. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the API runtime environment to enable Google sign-in. Never put database, Google, or Sequenzy credentials in a `VITE_*` variable.

Set `REDIS_URL` in `.env.local` and the production API environment to enable Redis. Veyra accepts `redis://` for Redis endpoints without TLS. Redis is optional and best-effort: MariaDB remains authoritative, Realtime notices are retried from a bounded Redis Stream, and missed messages are recovered from MariaDB when chat history loads. Cache entries are user and query scoped, expire quickly, and are invalidated after table writes. If Redis is unavailable, reads and broadcasts fall back to the existing MariaDB and Supabase paths. Typing and presence continue to use Supabase Realtime, which already provides connected-client presence and disconnect cleanup without exposing Redis credentials to browsers.

Redis read caching is restricted to results up to 256 KB and expires after two seconds. Each table has a generation key so a write invalidates older cached results across API instances. In-flight identical reads are coalesced per warm function instance; user ID and the complete query payload are part of the key, preserving authorization and pagination boundaries. Do not enable Redis eviction policies that can evict the stream outbox before acknowledged events are sent; MariaDB history still repairs missed live events.

See [Redis operations and configuration](docs/redis.md) for connection setup, fallback behavior, and capacity notes.

### Message encryption and optional queues

Set `MESSAGE_ENCRYPTION_KEY` (base64, 32 bytes) in the API runtime environment to encrypt message content before it is stored in MariaDB; `MESSAGE_ENCRYPTION_KEY_PREVIOUS` accepts comma-separated older keys for rotation. Without it, the API warns at startup and stores content unencrypted, and pre-existing plaintext messages always remain readable. Full details, including what is and is not encrypted, are in [docs/message-encryption.md](docs/message-encryption.md).

Altare Queues integration is off unless `ALTARE_QUEUES_ENABLED=true` and `ALTARE_QUEUES_URL` point at a queue service. When disabled, nothing connects to a queue and notification delivery runs inline. See [docs/queues.md](docs/queues.md) for the worker contract.

### Sessions and rate limiting

Sessions are stored hashed in MariaDB (`auth_sessions`, 30-day expiry). Signed-in users can list their sessions with `GET /api/auth/sessions` and revoke one or all others with `POST /api/auth/sessions/revoke` (`{ "session_id": "..." }` or `{ "others": true }`). Changing or resetting a password revokes all sessions. Auth endpoints are rate limited per client IP; when `REDIS_URL` is configured the counters are shared across API instances, otherwise an in-memory fallback applies.

In Supabase Dashboard:

1. Keep Supabase Storage buckets and policies configured:

   | Bucket | Access | Contents |
   | --- | --- | --- |
   | `avatars` | Public read | Profile and group avatars |
   | `banners` | Public read | Profile banners |
   | `chat-images` | Private | Chat images and files |
   | `chat-videos` | Private | Chat videos |
   | `chat-voice` | Private | Voice messages |

Supabase Auth is not used. New account IDs are generated by the Veyra API and stored in MariaDB.

Apply `supabase/migrations/20261109000000_profile_upload_limits.sql` once in the Supabase SQL Editor to enforce Veyra's 25 MB avatar and banner limit. The API signs uploads for the authenticated Veyra user, so Supabase Auth policies do not authorize these uploads.

### Google sign-in

Create a Web application OAuth client and configure its consent screen in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), following [Google's web server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server). Add the public `APP_URL` origin to Authorized JavaScript origins and `APP_URL/api/auth/google/callback` to Authorized redirect URIs. For this Vercel deployment, use `https://veyra-pink-mu.vercel.app/api/auth/google/callback`. Put the client ID and secret in the API runtime environment. Google identities are stored by Google's stable `sub` identifier in MariaDB. Run `npm run db:migrate` before enabling Google sign-in. Supabase Auth is not involved.

The project uses one Vercel Function for all `/api/*` requests, so it stays within the Hobby plan function limit; no proxy target or VPS is required. Add `MARIADB_HOST`, `MARIADB_PORT`, `MARIADB_DATABASE`, `MARIADB_USER`, and `MARIADB_PASSWORD` as Vercel environment variables. MariaDB must accept connections from Vercel Functions. A database bound only to `127.0.0.1` or a private network cannot be reached by Vercel. Add `APP_URL`, Google, Sequenzy, and other server-only settings there as well.

### Native app sign-in and account sync

Windows and Android use a one-time, five-minute pairing code to connect to an existing Veyra account. From the app's Google sign-in button, Veyra opens the system browser at the real Veyra site, where the browser address and Google sign-in flow remain visible. Sign in there with email or Google, then approve the device. Approval opens the Veyra app through the `veyra://pair` callback; the app exchanges the approved one-time code for its own MariaDB-backed session. If the native callback cannot open, the app's pending sign-in can still finish when you return to it. The browser keeps its normal web session. Android stores the app token with Android Keystore-backed secure storage; Windows encrypts it with Electron `safeStorage`. Both apps attach that session to API requests, so they access the same account and MariaDB data as the website without copying browser cookies.

The Google OAuth client is a Web application. Its redirect URI remains `APP_URL/api/auth/google/callback`; no Android package redirect URI or Google SDK client is needed for this browser-based flow. Google can reuse an existing browser sign-in; it is not forced to show the account picker on each attempt. The `veyra` URL protocol is registered by the Windows installer and by the Android build's generated manifest. Private message inserts are sent through scoped Supabase Realtime topics with the new message row, so the receiving chat can render it immediately without refetching an entire history page. Typing presence expires automatically if a device disconnects before sending a stop-typing update.

### Email delivery with Sequenzy

Create and verify a sending domain in Sequenzy, create a company API key with `transactional:send`, then set `SEQUENZY_API_KEY` in the API runtime environment. Set `APP_URL` to the public Veyra origin. The API sends verification and password reset links directly through Sequenzy's transactional endpoint; Supabase SMTP and Auth settings are not involved. See [Sequenzy's transactional email API](https://docs.sequenzy.com/concepts/transactional-emails).

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

The import expects the MariaDB schema to exist with no application rows. It copies all 19 application data tables and preserves their IDs without changing or deleting the source data. It does not import Supabase Auth accounts or passwords. Storage objects stay in Supabase. Remove `LEGACY_POSTGRES_URL` from `.env.local` after the import.

### 6. Start development

```bash
npm run dev
```

Vite serves the frontend on `http://localhost:8080` and proxies `/api` to the Node server on port `3001`.

## Production on Vercel or Node.js

Build the frontend with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_HCAPTCHA_SITE_KEY` set in the build environment:

```bash
npm ci
npm run build
npm run db:migrate
npm start
```

The Node server can host the compiled frontend and API on `PORT` (default `3001`). On Vercel, a single function runs the same Express API for all API paths; set the pooled Layerbase MariaDB connection and server secrets in Vercel's environment settings. `MARIADB_POOL_SIZE` is capped at two per function instance and idle connections are released quickly to reduce pressure on Layerbase's 20-connection Free limit.

## Attachment cleanup and notifications

`SUPABASE_SERVICE_ROLE_KEY` is server-only and powers signed profile uploads, live change broadcasts, and deletion of expired objects from Supabase Storage. To run cleanup from a scheduler, set a long random `PURGE_CRON_SECRET` in the API runtime environment and send it in the `x-cron-secret` header to:

```text
POST /api/maintenance/purge-expired-attachments
```

The cleanup marks chat attachments older than 14 days as expired and exempts admins. The same authorized call also removes expired sessions, native pairing codes, and email tokens. Without a cron secret, a signed-in `super_admin` can call the endpoint. ntfy server URL and notification preferences are stored in MariaDB; the server restricts outbound ntfy hosts to the configured supported servers.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and the Node API |
| `npm run build` | Build the frontend |
| `npm start` | Serve the production frontend and API |
| `npm run db:migrate` | Initialize the MariaDB schema |
| `npm run db:import:legacy` | Import Supabase Postgres app tables into MariaDB |
| `npm run lint` | Run ESLint |
| `npm test` | Run server unit tests |

The `supabase/migrations/` and `supabase/functions/` directories contain historical PostgreSQL material plus documented Storage-only changes. Do not run `supabase db push` for application tables. Make MariaDB schema changes in `database/schema.sql`.

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

---

## Acknowledgements

# MASSIVE MASSIVE THANK YOU TO [LysaKrysa](https://github.com/LysaKrysa)

Veyra would not exist in its current form without **[Chatt](https://github.com/LysaKrysa/Chatt)** and the generosity of its creator, **[LysaKrysa](https://github.com/LysaKrysa)**, for making the project open source.

Chatt was the starting point that made Veyra possible. Having access to the source gave me something real to learn from, build upon, rethink, and turn into a project of my own. It helped turn an idea into something I could actually work on, and eventually grow into Veyra.

I’m genuinely grateful for the time, effort, and work that went into creating Chatt and sharing it with everyone. Open-source projects like this make it possible for other developers to learn, experiment, create, and take ideas further. That generosity deserves recognition.

**Thank you, LysaKrysa, for open-sourcing Chatt and helping make Veyra possible.** This project is here in large part because you chose to share your work. I truly appreciate it.

Please go check out the original project: **[LysaKrysa/Chatt](https://github.com/LysaKrysa/Chatt)**.
