import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedInteger, normalizeGroupMemberIds, normalizeGroupName } from './rpc.mjs';

const owner = '4e6a80d2-9d4e-4c9e-9e47-1f09f2d3b4a5';
const member = 'b8a11e2d-9c30-4a2a-a55e-2d7f60e7e32c';

test('group names are trimmed and constrained to the database column size', () => {
  assert.equal(normalizeGroupName('  Veyra Group  '), 'Veyra Group');
  assert.throws(() => normalizeGroupName('   '), /required/);
  assert.throws(() => normalizeGroupName('x'.repeat(101)), /100 characters/);
});

test('group membership input includes the owner and removes duplicates', () => {
  assert.deepEqual(normalizeGroupMemberIds(owner, [member, owner, member]), [owner, member]);
});

test('group membership input rejects non-lists and malformed IDs', () => {
  assert.throws(() => normalizeGroupMemberIds(owner, member), /list/);
  assert.throws(() => normalizeGroupMemberIds(owner, ['not-a-uuid']), /invalid/);
});

test('admin report bounds normalize invalid, fractional, and extreme inputs', () => {
  assert.equal(boundedInteger(undefined, 7, 1, 90), 7);
  assert.equal(boundedInteger('not-a-number', 10, 1, 100), 10);
  assert.equal(boundedInteger('4.9', 7, 1, 90), 4);
  assert.equal(boundedInteger(0, 7, 1, 90), 1);
  assert.equal(boundedInteger(500, 10, 1, 100), 100);
});

test('group membership input is bounded before database operations', () => {
  const owner = '00000000-0000-4000-8000-000000000000';
  const members = Array.from({ length: 255 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  });
  assert.equal(normalizeGroupMemberIds(owner, members).length, 256);
  assert.throws(() => normalizeGroupMemberIds(owner, [...members, '00000000-0000-4000-8000-000000000999']), /cannot exceed 256/);
});
