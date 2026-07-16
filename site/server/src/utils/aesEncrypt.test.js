/**
 * aesEncrypt.test.js — unit tests for the F8.1 AES-256-GCM helper.
 *
 * Pure / no DB. Exercises round-trip, wrong-key failure, previous-key fallback
 * (the rotation strategy), and tamper detection. Run from the server directory:
 *     node --test src/utils/aesEncrypt.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { encrypt, decrypt, decryptWithMeta, KEY_BYTES } = require('./aesEncrypt');

const KEY_A = crypto.randomBytes(KEY_BYTES).toString('hex');
const KEY_B = crypto.randomBytes(KEY_BYTES).toString('hex');

// Snapshot + restore the env keys around each scenario so tests don't leak.
const withEnv = (current, previous, fn) => {
  const savedCur = process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
  const savedPrev = process.env.EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (current == null) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
  else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = current;
  if (previous == null) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  else process.env.EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS = previous;
  try {
    return fn();
  } finally {
    if (savedCur === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = savedCur;
    if (savedPrev === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS;
    else process.env.EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS = savedPrev;
  }
};

test('round-trip: encrypt then decrypt returns the original plaintext', () => {
  withEnv(KEY_A, null, () => {
    const secret = 'ya29.refresh-token-value-12345';
    const ct = encrypt(secret);
    assert.notEqual(ct, secret);
    assert.equal(decrypt(ct), secret);
  });
});

test('ciphertext is non-deterministic (fresh IV per encrypt)', () => {
  withEnv(KEY_A, null, () => {
    const a = encrypt('same input');
    const b = encrypt('same input');
    assert.notEqual(a, b);
    assert.equal(decrypt(a), 'same input');
    assert.equal(decrypt(b), 'same input');
  });
});

test('wrong key fails to decrypt', () => {
  const ct = withEnv(KEY_A, null, () => encrypt('top secret'));
  withEnv(KEY_B, null, () => {
    assert.throws(() => decrypt(ct));
  });
});

test('previous-key fallback: decrypt succeeds after rotation', () => {
  // Encrypted under KEY_A (the old key).
  const ct = withEnv(KEY_A, null, () => encrypt('rotate me'));
  // After rotation: current=KEY_B, previous=KEY_A → decrypt must still work.
  withEnv(KEY_B, KEY_A, () => {
    assert.equal(decrypt(ct), 'rotate me');
    const meta = decryptWithMeta(ct);
    assert.equal(meta.plaintext, 'rotate me');
    assert.equal(meta.usedPreviousKey, true); // signals re-encrypt-on-write
  });
});

test('decryptWithMeta reports current-key hits as usedPreviousKey:false', () => {
  withEnv(KEY_A, KEY_B, () => {
    const ct = encrypt('fresh');
    const meta = decryptWithMeta(ct);
    assert.equal(meta.plaintext, 'fresh');
    assert.equal(meta.usedPreviousKey, false);
  });
});

test('tamper detection: a flipped ciphertext byte throws', () => {
  withEnv(KEY_A, null, () => {
    const ct = encrypt('integrity matters');
    const parts = ct.split(':');
    // Corrupt one hex char of the ciphertext segment.
    const last = parts[2];
    const flipped = (last[0] === 'a' ? 'b' : 'a') + last.slice(1);
    const tampered = `${parts[0]}:${parts[1]}:${flipped}`;
    assert.throws(() => decrypt(tampered));
    assert.equal(decryptWithMeta(tampered), null); // best-effort returns null
  });
});

test('malformed ciphertext throws', () => {
  withEnv(KEY_A, null, () => {
    assert.throws(() => decrypt('not-a-valid-payload'));
  });
});

test('missing key throws a clear error on encrypt', () => {
  withEnv(null, null, () => {
    assert.throws(() => encrypt('x'), /EMAIL_TOKEN_ENCRYPTION_KEY/);
  });
});
