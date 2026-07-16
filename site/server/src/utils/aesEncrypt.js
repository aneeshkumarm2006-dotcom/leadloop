/**
 * aesEncrypt.js — AES-256-GCM token encryption (Phase 3, F8.1).
 *
 * A dependency-free helper built on Node's built-in `crypto`, used to encrypt
 * the OAuth tokens stored on `EmailAccount` (and reused by F10 `SmsConfig` /
 * F11 `WhatsAppConfig` auth tokens). Never store these plaintext.
 *
 * Wire format: `iv:tag:ciphertext`, each part lowercase hex. A fresh random 12-
 * byte IV is generated per `encrypt`, so the same plaintext never produces the
 * same ciphertext. GCM's 16-byte auth tag is stored alongside and verified on
 * decrypt — a tampered ciphertext throws rather than returning garbage.
 *
 * Key: a 32-byte (256-bit) value supplied as 64 hex chars via
 * `EMAIL_TOKEN_ENCRYPTION_KEY`. Generate one with:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Key rotation (pre-flight decision — re-encrypt-on-read lazy migration):
 *   `encrypt` always uses the CURRENT key. `decrypt` tries the current key, then
 *   falls back to `EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS` when set. A value that
 *   only decrypts under the previous key is re-encrypted with the current key
 *   the next time its row is saved (model statics call `encrypt`, which always
 *   uses the current key). Rotation runbook: set `_PREVIOUS` = old key and the
 *   primary = new key, deploy, let active rows re-encrypt on access, drop
 *   `_PREVIOUS`. No bulk migration job.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

/**
 * Coerce a key (hex string or Buffer) into a 32-byte Buffer, throwing a clear
 * error on the wrong shape so a misconfigured env fails loudly at first use.
 */
const toKeyBuffer = (key, label = 'encryption key') => {
  if (!key) throw new Error(`aesEncrypt: missing ${label}`);
  const buf = Buffer.isBuffer(key) ? key : Buffer.from(String(key).trim(), 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `aesEncrypt: ${label} must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars), got ${buf.length}`
    );
  }
  return buf;
};

/** The current key from env (or an explicit override). */
const currentKey = (override) =>
  toKeyBuffer(override || process.env.EMAIL_TOKEN_ENCRYPTION_KEY, 'EMAIL_TOKEN_ENCRYPTION_KEY');

/** The optional previous key from env — returns null when unset. */
const previousKey = () => {
  const raw = process.env.EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (!raw || !String(raw).trim()) return null;
  return toKeyBuffer(raw, 'EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS');
};

/**
 * Encrypt a UTF-8 plaintext string. Always uses the current key (overridable for
 * tests). Returns `iv:tag:ciphertext` in hex.
 *
 * @param {string} plaintext
 * @param {string|Buffer} [key] - 32-byte hex/Buffer; defaults to env current key
 * @returns {string}
 */
const encrypt = (plaintext, key) => {
  if (plaintext == null) throw new Error('aesEncrypt.encrypt requires a plaintext');
  const keyBuf = currentKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
};

/** Decrypt one `iv:tag:ciphertext` payload under a single key. Throws on miss. */
const decryptWithKey = (payload, keyBuf) => {
  const parts = String(payload).split(':');
  if (parts.length !== 3) throw new Error('aesEncrypt: malformed ciphertext');
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  if (iv.length !== IV_BYTES) throw new Error('aesEncrypt: bad IV length');
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

/**
 * Decrypt a payload, trying the current key first then the previous key (when
 * `EMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS` is set). Throws if neither key works
 * (tamper / wrong-key / corruption all surface as an error, never silent data).
 *
 * @param {string} payload - `iv:tag:ciphertext`
 * @param {string|Buffer} [key] - explicit key override (skips env + previous)
 * @returns {string} plaintext
 */
const decrypt = (payload, key) => {
  if (payload == null || payload === '') throw new Error('aesEncrypt.decrypt requires a ciphertext');
  if (key) return decryptWithKey(payload, toKeyBuffer(key, 'override key'));

  const keys = [currentKey()];
  const prev = previousKey();
  if (prev) keys.push(prev);

  let lastErr;
  for (const k of keys) {
    try {
      return decryptWithKey(payload, k);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('aesEncrypt: decrypt failed');
};

/**
 * Decrypt + report which key succeeded. `usedPreviousKey: true` signals the
 * caller to re-encrypt-and-persist on the next write (lazy rotation). Returns
 * null on total failure rather than throwing, so best-effort readers can skip.
 *
 * @param {string} payload
 * @returns {{ plaintext: string, usedPreviousKey: boolean } | null}
 */
const decryptWithMeta = (payload) => {
  if (payload == null || payload === '') return null;
  try {
    return { plaintext: decryptWithKey(payload, currentKey()), usedPreviousKey: false };
  } catch {
    const prev = previousKey();
    if (!prev) return null;
    try {
      return { plaintext: decryptWithKey(payload, prev), usedPreviousKey: true };
    } catch {
      return null;
    }
  }
};

/** Whether a token-encryption key is configured (so callers can no-op in dev). */
const isConfigured = () => {
  const raw = process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
  return !!(raw && String(raw).trim());
};

module.exports = {
  encrypt,
  decrypt,
  decryptWithMeta,
  isConfigured,
  // Exported for unit tests.
  KEY_BYTES,
};
