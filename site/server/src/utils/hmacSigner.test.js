/**
 * hmacSigner.test.js — unit tests for the F7.1 HMAC signer.
 *
 * Covers sign→verify round-trip, tamper detection, wrong-secret miss, and the
 * timing-safe wrong-length guard (no throw on a malformed signature).
 *
 * Run from the server directory:
 *     node --test src/utils/hmacSigner.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sign, verify } = require('./hmacSigner');

const SECRET = 'super-secret-key';

test('sign → verify round-trip succeeds', () => {
  const body = JSON.stringify({ event: 'STATUS_BECAME', taskId: 'abc' });
  const sig = sign(body, SECRET);
  assert.equal(typeof sig, 'string');
  assert.match(sig, /^[0-9a-f]{64}$/); // SHA-256 → 64 hex chars
  assert.equal(verify(body, SECRET, sig), true);
});

test('verify: tampered body fails', () => {
  const body = JSON.stringify({ amount: 100 });
  const sig = sign(body, SECRET);
  const tampered = JSON.stringify({ amount: 100000 });
  assert.equal(verify(tampered, SECRET, sig), false);
});

test('verify: wrong secret fails', () => {
  const body = 'hello';
  const sig = sign(body, SECRET);
  assert.equal(verify(body, 'different-secret', sig), false);
});

test('verify: malformed / wrong-length signature returns false (no throw)', () => {
  const body = 'hello';
  assert.equal(verify(body, SECRET, 'deadbeef'), false); // too short
  assert.equal(verify(body, SECRET, ''), false);
  assert.equal(verify(body, SECRET, undefined), false);
  assert.equal(verify(body, SECRET, 'zz'.repeat(32)), false); // non-hex, right-ish length
});

test('sign: throws without a secret', () => {
  assert.throws(() => sign('x', ''));
});

test('sign: object body is serialised deterministically', () => {
  const obj = { a: 1, b: 2 };
  const a = sign(obj, SECRET);
  const b = sign(JSON.stringify(obj), SECRET);
  assert.equal(a, b);
});
