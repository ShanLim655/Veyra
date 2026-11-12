import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Server-side encryption for sensitive message content stored in MariaDB.
// This is NOT end-to-end encryption: the backend encrypts before writing and
// decrypts after reading, so the API remains able to moderate Global Chat and
// Announcements. See docs/message-encryption.md for the full security model.
//
// Stored format: "veyra:v1:" + base64url(iv || authTag || ciphertext)
// Values without the prefix are legacy plaintext and are returned unchanged,
// which keeps pre-1.2.0 messages readable without a migration.

export const ENCRYPTED_VALUE_PREFIX = 'veyra:v1:';
export const DECRYPTION_FAILED_TEXT = '[This message could not be decrypted.]';

const IV_BYTES = 12;
const TAG_BYTES = 16;

// Only user-authored message content is encrypted. Short structured fields
// (poll option labels, conversation names, usernames) intentionally stay
// plaintext; see docs/message-encryption.md for the rationale.
const ENCRYPTED_FIELDS = {
  messages: ['content'],
  global_messages: ['content'],
  announcement_messages: ['content'],
  polls: ['question'],
};

let cachedKeys = null;

function decodeKey(value, label) {
  const key = Buffer.from(String(value || '').trim(), 'base64');
  if (key.length !== 32) {
    throw new Error(`${label} must be a base64-encoded 32-byte key.`);
  }
  return key;
}

function loadKeys() {
  if (cachedKeys) return cachedKeys;
  const current = String(process.env.MESSAGE_ENCRYPTION_KEY || '').trim();
  const previous = String(process.env.MESSAGE_ENCRYPTION_KEY_PREVIOUS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  cachedKeys = {
    current: current ? decodeKey(current, 'MESSAGE_ENCRYPTION_KEY') : null,
    previous: previous.map((value, index) => decodeKey(value, `MESSAGE_ENCRYPTION_KEY_PREVIOUS entry ${index + 1}`)),
  };
  return cachedKeys;
}

export function encryptionEnabled() {
  return Boolean(loadKeys().current);
}

// Call once at startup so a malformed key fails fast with a clear error
// instead of surfacing later as a confusing runtime failure.
export function assertEncryptionConfig() {
  loadKeys();
}

export function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_VALUE_PREFIX);
}

export function encryptField(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const { current } = loadKeys();
  if (!current) return value;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', current, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_VALUE_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

export function decryptField(value) {
  if (typeof value !== 'string' || !isEncryptedValue(value)) return value;
  const { current, previous } = loadKeys();
  const packed = Buffer.from(value.slice(ENCRYPTED_VALUE_PREFIX.length), 'base64url');
  if (packed.length <= IV_BYTES + TAG_BYTES) return DECRYPTION_FAILED_TEXT;
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
  for (const key of [current, ...previous]) {
    if (!key) continue;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Authentication failed for this key; try the next configured key.
    }
  }
  console.error('Message decryption failed: no configured key could authenticate the value.');
  return DECRYPTION_FAILED_TEXT;
}

export function encryptRowForTable(table, row) {
  const fields = ENCRYPTED_FIELDS[table];
  if (!fields || !row || typeof row !== 'object') return row;
  let changed = false;
  const next = { ...row };
  for (const field of fields) {
    if (typeof next[field] === 'string' && next[field].length > 0) {
      next[field] = encryptField(next[field]);
      changed = true;
    }
  }
  return changed ? next : row;
}

export function decryptRowsForTable(table, data) {
  const fields = ENCRYPTED_FIELDS[table];
  if (!fields || data == null) return data;
  const decryptRow = (row) => {
    if (!row || typeof row !== 'object') return row;
    let changed = false;
    const next = { ...row };
    for (const field of fields) {
      if (typeof next[field] === 'string' && isEncryptedValue(next[field])) {
        next[field] = decryptField(next[field]);
        changed = true;
      }
    }
    return changed ? next : row;
  };
  return Array.isArray(data) ? data.map(decryptRow) : decryptRow(data);
}
