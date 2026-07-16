const mongoose = require('mongoose');
const aesEncrypt = require('../utils/aesEncrypt');

/**
 * WhatsAppConfig — a workspace's Twilio WhatsApp Business credentials
 * (Phase 3, F11.1).
 *
 * One row per workspace (unique `workspaceId`): the Account SID + Auth Token the
 * `SEND_WHATSAPP` action and the task WhatsApp tab send through, plus the
 * WhatsApp sender id (a `whatsapp:`-capable Twilio number or Messaging Service).
 *
 * The Auth Token is stored ENCRYPTED (AES-256-GCM via aesEncrypt.js, sharing the
 * `EMAIL_TOKEN_ENCRYPTION_KEY` introduced by F8 — the SAME key as the F10
 * `SmsConfig`) — never plaintext. Write it with `setAuthToken()` and read it with
 * `getDecryptedAuthToken()`; the latter honours the previous-key rotation
 * fallback and flags rows that should be re-encrypted on their next save.
 *
 * Mirrors `SmsConfig` (F10.1); WhatsApp reuses the same Twilio account + the F10
 * opt-out gate, so a number that replied STOP is suppressed on both channels.
 */
const whatsappConfigSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    required: true,
    unique: true,
  },
  accountSid: { type: String, default: '' },
  // AES-GCM ciphertext (`iv:tag:ciphertext` hex) — never the plaintext token.
  authToken: { type: String, default: null },
  // The WhatsApp-enabled sender (E.164 of the approved number, e.g.
  // "+14155238886", or a Messaging Service SID). The adapter prefixes it with
  // `whatsapp:` at send time.
  whatsappSenderId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

/**
 * Encrypt + store the Twilio Auth Token under the CURRENT key. Pass `null`/`''`
 * to clear it. A no-op when `token` is `undefined` (so a partial update that
 * only touches the sender leaves the stored token untouched).
 */
whatsappConfigSchema.methods.setAuthToken = function setAuthToken(token) {
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
whatsappConfigSchema.methods.getDecryptedAuthToken = function getDecryptedAuthToken() {
  if (!this.authToken) return { authToken: null, needsReEncrypt: false };
  const meta = aesEncrypt.decryptWithMeta(this.authToken);
  if (!meta) return { authToken: null, needsReEncrypt: false };
  return { authToken: meta.plaintext, needsReEncrypt: meta.usedPreviousKey };
};

/** Whether the config has the minimum to send (SID + token + a sender). */
whatsappConfigSchema.methods.isSendable = function isSendable() {
  return !!(this.accountSid && this.authToken && this.whatsappSenderId);
};

module.exports = mongoose.model('WhatsAppConfig', whatsappConfigSchema);
