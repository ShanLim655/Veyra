import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';

process.env.MESSAGE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.MESSAGE_ENCRYPTION_KEY_PREVIOUS = randomBytes(32).toString('base64');

const {
  DECRYPTION_FAILED_TEXT,
  ENCRYPTED_VALUE_PREFIX,
  decryptField,
  decryptRowsForTable,
  encryptField,
  encryptRowForTable,
  encryptionEnabled,
  isEncryptedValue,
} = await import('./encryption.mjs');

test('encryption is enabled with a valid key', () => {
  assert.equal(encryptionEnabled(), true);
});

test('encrypted values round-trip and are prefixed', () => {
  const stored = encryptField('hello veyra');
  assert.equal(isEncryptedValue(stored), true);
  assert.ok(stored.startsWith(ENCRYPTED_VALUE_PREFIX));
  assert.notEqual(stored, 'hello veyra');
  assert.equal(decryptField(stored), 'hello veyra');
});

test('nonces are never reused for identical plaintext', () => {
  assert.notEqual(encryptField('same text'), encryptField('same text'));
});

test('legacy plaintext passes through decryption unchanged', () => {
  assert.equal(decryptField('an old plaintext message'), 'an old plaintext message');
  assert.equal(decryptField(null), null);
  assert.equal(decryptField(42), 42);
});

test('tampered ciphertext fails safely without throwing', () => {
  const stored = encryptField('secret');
  const tampered = `${stored.slice(0, -2)}xx`;
  const result = decryptField(tampered);
  assert.equal(result, DECRYPTION_FAILED_TEXT);
});

test('values encrypted with a previous key still decrypt', () => {
  const previousKey = process.env.MESSAGE_ENCRYPTION_KEY_PREVIOUS.split(',')[0];
  const key = Buffer.from(previousKey, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update('rotated', 'utf8'), cipher.final()]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
  assert.equal(decryptField(`${ENCRYPTED_VALUE_PREFIX}${packed}`), 'rotated');
});

test('row helpers only touch configured fields', () => {
  const row = { id: 'm1', content: 'private', image_url: 'https://example.com/x.png' };
  const stored = encryptRowForTable('messages', row);
  assert.notEqual(stored.content, 'private');
  assert.equal(stored.image_url, row.image_url);
  const back = decryptRowsForTable('messages', [stored])[0];
  assert.equal(back.content, 'private');
});

test('unrelated tables are not encrypted', () => {
  const row = { content: 'profile bio text' };
  assert.equal(encryptRowForTable('profiles', row), row);
  assert.equal(decryptRowsForTable('profiles', [row])[0].content, 'profile bio text');
});

test('single-row payloads decrypt correctly', () => {
  const stored = encryptRowForTable('global_messages', { id: 'g1', content: 'global hi' });
  const result = decryptRowsForTable('global_messages', stored);
  assert.equal(result.content, 'global hi');
});
