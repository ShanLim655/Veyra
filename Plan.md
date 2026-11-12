# Veyra 1.2.0 — Implementation Plan

Implementation strategy for [plans/Plan-1.2.0.md](plans/Plan-1.2.0.md).

## Affected components

| Area | Files | Change |
| --- | --- | --- |
| Message encryption | `server/encryption.mjs` (new), `server/data.mjs`, `server/app.mjs`, `server/encryption.test.mjs` (new) | AES-256-GCM encrypt on insert/upsert/update, decrypt after the Redis read cache on every select/returning path. Legacy plaintext stays readable. |
| Rate limiting | `server/redis.mjs`, `server/auth.mjs`, `server/app.mjs` | `consumeRateLimit()` fixed-window counters in Redis; auth endpoints fall back to in-memory buckets; `/api/data` gets a generous per-user ceiling when Redis is available. |
| Sessions | `server/auth.mjs`, `server/maintenance.mjs`, `server/app.mjs` | `GET /api/auth/sessions`, `POST /api/auth/sessions/revoke`; password change revokes all sessions; purge endpoint also deletes expired sessions, pairing codes, and email tokens. |
| Optional queues | `server/queues.mjs` (new), `server/notifications.mjs`, `server/app.mjs` | Env-gated Altare Queues producer with inline fallback; `POST /api/queues/deliver` worker endpoint guarded by `QUEUES_WORKER_SECRET`. |
| Realtime/presence | `src/integrations/supabase/mariadb-realtime.ts`, `src/components/chat/ChatView.tsx`, `src/hooks/usePresence.ts` | Reconnect detection + `onMariaDbRealtimeReconnect`; ChatView resyncs on recovery; presence heartbeats and global-presence teardown. |
| Desktop updater | `desktop/main.cjs`, `desktop/update.html` (new), `desktop/update-preload.cjs` (new) | Non-blocking check, dedicated progress window, verified download, explicit install action, retry/later on failure. |
| Android updater | `src/components/AndroidUpdateCheck.tsx` | AlertDialog with version/notes, toast on check or open failure. |
| CI | `.github/workflows/ci.yml` (new) | Lint + server tests + production build on PRs and pushes. |
| Docs/env | `README.md`, `Releases.md`, `docs/message-encryption.md`, `docs/queues.md`, `docs/redis.md`, `.env.example`, `package.json` | Document encryption, queues, sessions, rate limits; new env vars; version 1.2.0. |

## Key decisions

- **Encryption scope:** `content` on the three message tables plus `polls.question`. Poll option text stays plaintext (`VARCHAR(255)` cannot hold the encryption envelope). No custom crypto; AES-256-GCM via `node:crypto`.
- **Backward compatibility:** ciphertext is self-describing (`veyra:v1:` prefix); unprefixed values are legacy plaintext. No migration required; old messages remain readable.
- **Cache safety:** decryption runs after `cachedRead` returns, so Redis only ever stores ciphertext.
- **Queues:** producer-only integration. Veyra never requires a queue connection; publish failures run the inline fallback. A worker contract (`/api/queues/deliver`) is provided for consumers.
- **Updater:** the existing `latest.json` release metadata is reused; no electron-updater dependency added. Install still uses the NSIS `/S` silent flag, but only after explicit user action.

## Testing performed

- `npm test` — server unit tests including AES-GCM round-trip, nonce uniqueness, tamper failure, key rotation, and row-field scoping (12 tests).
- `npm run lint`, `npm run build` — run before push; CI repeats them on the PR.
- Manual verification limits: no live MariaDB/Redis/Supabase credentials in this environment, so end-to-end messaging, realtime, and updater flows are covered by code review and unit tests rather than live integration tests.

## Known limitations

- Server-side `content` filters cannot match plaintext inside ciphertext; conversation search is client-side and unaffected.
- Queued notification jobs require an external Altare Queues worker calling `/api/queues/deliver`; without one, enabling queues means notifications are queued rather than pushed immediately.
- The Windows updater flow is exercised by CI build only; on-device update UX should be verified on a real install before tagging.
