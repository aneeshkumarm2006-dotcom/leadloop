const mongoose = require('mongoose');
const aesEncrypt = require('../utils/aesEncrypt');

/**
 * SmsConfig — a workspace's Twilio SMS credentials (Phase 3, F10.1).
 *
 * One row per workspace (unique `workspaceId`): the Account SID + Auth Token the
 * `SEND_SMS` action and the task SMS tab send through, plus the default sender
 * number / Messaging Service and the TCPA/CASL opt-out footer toggle.
 *
 * The Twilio Auth Token is stored ENCRYPTED (AES-256-GCM via aesEncrypt.js,
 * sharing the `EMAIL_TOKEN_ENCRYPTION_KEY` introduced by F8) — never plaintext.
 * Write it with `setAuthToken()` and read it with `getDecryptedAuthToken()`; the
 * latter honours the previous-key rotation fallback and flags rows that should
 * be re-encrypted on their next save.
 */
const smsConfigSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      unique: true,
    },
    accountSid: { type: String, default: '' },
    // AES-GCM ciphertext (`iv:tag:ciphertext` hex) — never the plaintext token.
    authToken: { type: String, default: null },
    // The number sends originate from (E.164), e.g. "+15551234567".
    defaultFrom: { type: String, default: '' },
    // Optional Twilio Messaging Service SID (overrides defaultFrom when set).
    messagingServiceSid: { type: String, default: '' },
    // Append "\n\nReply STOP to opt out" to outbound bodies (TCPA/CASL) unless
    // the body already mentions STOP. On by default.
    appendOptOutFooter: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  }
);

/**
 * Encrypt + store the Twilio Auth Token under the CURRENT key. Pass `null`/`''`
 * to clear it. A no-op when `token` is `undefined` (so a partial update that
 * only touches the sender number leaves the stored token untouched).
 */
smsConfigSchema.methods.setAuthToken = function setAuthToken(token) {
  if (token === undefined) return this;
  this.authToken = token ? aesEncrypt.encrypt(token) : null;
  return this;
};

/**
 * Decrypt the stored Auth Token. Returns `{ authToken, needsReEncrypt }`.
 * `needsReEncrypt` is true when the value decrypted only under the PREVIOUS key
 * — callers can `setAuthToken(...)` + `save()` to lazily re-encrypt (rotation
 * strategy). Returns a null token when none is stored or it fails to decrypt.
 */
smsConfigSchema.methods.getDecryptedAuthToken = function getDecryptedAuthToken() {
  if (!this.authToken) return { authToken: null, needsReEncrypt: false };
  const meta = aesEncrypt.decryptWithMeta(this.authToken);
  if (!meta) return { authToken: null, needsReEncrypt: false };
  return { authToken: meta.plaintext, needsReEncrypt: meta.usedPreviousKey };
};

/** Whether the config has the minimum to send (SID + token + a sender). */
smsConfigSchema.methods.isSendable = function isSendable() {
  return !!(this.accountSid && this.authToken && (this.defaultFrom || this.messagingServiceSid));
};

module.exports = mongoose.model('SmsConfig', smsConfigSchema);
