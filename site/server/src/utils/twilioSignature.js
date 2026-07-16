/**
 * twilioSignature.js — Twilio `X-Twilio-Signature` validation (Phase 3, F10.4).
 *
 * A tiny, dependency-free verifier built on Node's built-in `crypto` (the
 * "hmacSigner.js-style wrapper" the F10 plan calls for — Twilio uses HMAC-SHA1 +
 * base64, not the SHA-256/hex of F7's `hmacSigner`, so it gets its own helper).
 * Reused by the F11 WhatsApp callbacks.
 *
 * Algorithm (Twilio's documented scheme for an x-www-form-urlencoded POST):
 *   1. Start with the exact request URL Twilio called (scheme + host + path).
 *   2. Append, for each POST param sorted alphabetically by key, the key
 *      immediately followed by its value (no separators).
 *   3. HMAC-SHA1 that UTF-8 string under the workspace's Auth Token.
 *   4. base64-encode the digest and constant-time compare to the header.
 *
 * The Auth Token is the shared secret only Twilio + this server know, so a
 * forged request can't produce a matching signature even though the params it
 * is computed over (incl. `AccountSid`, used to find the workspace) are public.
 */

const crypto = require('crypto');

/**
 * Compute the expected base64 HMAC-SHA1 signature for a request.
 *
 * @param {string} authToken - the workspace's Twilio Auth Token (plaintext)
 * @param {string} url       - the full URL Twilio POSTed to
 * @param {Object} params    - the parsed POST body params (`req.body`)
 * @returns {string} base64 digest
 */
const expectedSignature = (authToken, url, params = {}) => {
  if (!authToken) throw new Error('twilioSignature: missing authToken');
  let data = String(url == null ? '' : url);
  if (params && typeof params === 'object') {
    for (const key of Object.keys(params).sort()) {
      const v = params[key];
      data += key + (v == null ? '' : Array.isArray(v) ? v.join('') : String(v));
    }
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
};

/**
 * Constant-time verify a received `X-Twilio-Signature`. Returns false (never
 * throws) on any mismatch, missing input, or length difference so the caller can
 * branch on a boolean and reject with 403.
 *
 * @param {string} authToken
 * @param {string} signature - the `X-Twilio-Signature` header value
 * @param {string} url
 * @param {Object} params
 * @returns {boolean}
 */
const verify = (authToken, signature, url, params) => {
  if (!authToken || typeof signature !== 'string' || signature.length === 0) {
    return false;
  }
  let expected;
  try {
    expected = expectedSignature(authToken, url, params);
  } catch {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
};

module.exports = { expectedSignature, verify };
