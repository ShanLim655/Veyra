# Message encryption at rest

Veyra 1.2.0 encrypts sensitive message content on the server before it is
written to MariaDB, and decrypts it when an authorized client reads it back.

**This is not end-to-end encryption.** The Veyra API holds the keys and
performs both encryption and decryption. Global Chat and Announcements remain
fully accessible to the backend for moderation, reporting, and abuse
prevention. Do not describe Veyra as end-to-end encrypted.

## What is encrypted

| Table | Field | Notes |
| --- | --- | --- |
| `messages` | `content` | Direct messages and group chats |
| `global_messages` | `content` | Global Chat |
| `announcement_messages` | `content` | Announcements |
| `polls` | `question` | Poll questions shown in chat |

Attachments (`image_url`), usernames, conversation names, poll option labels,
and all other fields are intentionally left unencrypted. Poll option text is
excluded because it is stored in a `VARCHAR(255)` column that cannot fit the
encryption envelope; option labels are short structured choices rather than
free-form message content.

## Algorithm and format

- AES-256-GCM via Node's `crypto` module. No custom cryptography.
- A fresh random 12-byte nonce is generated for every value; nonces are never
  reused with the same key.
- Stored format: `veyra:v1:` + base64url(`iv || authTag || ciphertext`).
- The GCM authentication tag is verified on every decryption. Tampered or
  corrupt values fail closed and return a placeholder instead of crashing.

## Key management

Encryption is controlled entirely by server environment variables:

- `MESSAGE_ENCRYPTION_KEY` — base64-encoded 32-byte key used for new writes
  and preferred for reads. Generate with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `MESSAGE_ENCRYPTION_KEY_PREVIOUS` — optional comma-separated list of older
  base64 keys tried only during decryption, enabling zero-downtime rotation.

Keys live outside the database, are never exposed through APIs, logs, or
client responses, and must never be committed or given a `VITE_` prefix.

When `MESSAGE_ENCRYPTION_KEY` is unset, the API logs a warning at startup and
stores new message content as plaintext. Values without the `veyra:v1:`
prefix are always treated as legacy plaintext, so messages written before
encryption was enabled remain readable without a migration.

## Rotation

1. Generate a new key and set it as `MESSAGE_ENCRYPTION_KEY`.
2. Move the old key into `MESSAGE_ENCRYPTION_KEY_PREVIOUS`.
3. Deploy. New writes use the new key; old ciphertext still decrypts via the
   previous-key list.
4. Optionally re-encrypt stored rows later, then remove the old key from
   `MESSAGE_ENCRYPTION_KEY_PREVIOUS`.

## Security properties and limitations

- Protects message content at rest in MariaDB backups/dumps and in Redis,
  where only ciphertext is ever cached (decryption happens after the read
  cache returns).
- Transport security is unchanged: the API must be served over HTTPS and any
  self-hosted WebSocket transport over WSS.
- The API can still read all message content for moderation, search-adjacent
  features, and notification previews. Database-level encryption does not
  protect against a compromised API host or its environment.
- Server-side `content` filters (for example `ilike`) cannot match plaintext
  inside ciphertext; conversation search runs client-side over decrypted
  messages and is unaffected.
- A user who literally types the `veyra:v1:` prefix is unaffected: writes
  always encrypt the full value, so the stored form is still ciphertext.

Implementation: `server/encryption.mjs`, hooked into `server/data.mjs` for
all insert, upsert, update, select, and returning paths. Tests:
`server/encryption.test.mjs` (`npm test`).
