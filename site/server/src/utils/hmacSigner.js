/**
 * hmacSigner.js — HMAC-SHA256 request signing (Phase 3, F7.1).
 *
 * A tiny, dependency-free signing helper built on Node's built-in `crypto`.
 * Used by F7's outbound webhook dispatcher to sign the JSON envelope it POSTs
 * (header `X-CRM-Signature`) and reused by F10/F11 for Twilio signature
 * validation. No new npm dependency — `crypto` ships with Node.
 *
 * Wire format: a lowercase hex SHA-256 HMAC digest of the exact request body
 * string under the shared secret. Verification is timing-safe (constant-time
 * compare) so a byte-by-byte early-return can't leak the signature.
 *
 *   const sig = sign(JSON.stringify(body), endpoint.secret);
 *   // … later, on the receiving side …
 *   const ok = verify(rawBodyString, endpoint.secret, headers['x-crm-signature']);
 */

const crypto = require('crypto');

/** Normalise a body to the exact string that gets hashed. */
const toBuffer = (body) => {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  // Objects are serialised deterministically by the caller; if a raw object
  // slips through, JSON.stringify it so we never hash "[object Object]".
  return Buffer.from(JSON.stringify(body == null ? '' : body), 'utf8');
};

/**
 * Compute the hex HMAC-SHA256 of `body` under `secret`.
 * @param {string|Buffer|Object} body
 * @param {string} secret
 * @returns {string} lowercase hex digest
 */
const sign = (body, secret) => {
  if (!secret) throw new Error('hmacSigner.sign requires a secret');
  return crypto.createHmac('sha256', secret).update(toBuffer(body)).digest('hex');
};

/**
 * Timing-safe verification of a hex signature against the freshly-computed one.
 * Returns false (never throws) on any mismatch, missing input, or length
 * difference so callers can branch on a boolean.
 *
 * @param {string|Buffer|Object} body
 * @param {string} secret
 * @param {string} signature - hex digest received from the sender
 * @returns {boolean}
 */
const verify = (body, secret, signature) => {
  if (!secret || typeof signature !== 'string' || signature.length === 0) {
    return false;
  }
  let expected;
  try {
    expected = sign(body, secret);
  } catch {
    return false;
  }
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  // timingSafeEqual throws on unequal lengths — guard so a wrong-length forgery
  // returns false rather than blowing up the request.
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
};

module.exports = { sign, verify };
