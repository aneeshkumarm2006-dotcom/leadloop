const mongoose = require('mongoose');
const aesEncrypt = require('../utils/aesEncrypt');

/**
 * EmailAccount — a user's connected sending/receiving mailbox (Phase 3, F8.2).
 *
 * One row per (user, workspace): the provider OAuth connection that the Emails
 * tab sends through and that inbound capture writes replies against. OAuth
 * tokens are stored ENCRYPTED (AES-256-GCM via aesEncrypt.js) — never plaintext.
 * Use `setTokens()` to write and `getDecryptedTokens()` to read; the latter
 * transparently honours the previous-key rotation fallback and flags rows that
 * should be re-encrypted on their next save.
 *
 *   - provider 'gmail'      — Gmail API via googleapis (OAuth)
 *   - provider 'microsoft'  — Microsoft Graph (OAuth)
 *   - provider 'smtp'       — IMAP read + SMTP send fallback
 */
const emailAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    required: true,
  },
  provider: {
    type: String,
    enum: ['gmail', 'microsoft', 'smtp'],
    required: true,
  },
  // OAuth credentials — accessToken/refreshToken are AES-GCM ciphertext.
  oauthTokens: {
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    scope: { type: String, default: '' },
  },
  // The address sends originate from (the connected mailbox's primary address).
  defaultFrom: { type: String, default: '' },
  // Optional HTML/text signature appended to composed messages.
  signature: { type: String, default: '' },
  // For Gmail push (Pub/Sub) + IMAP fallback bookkeeping.
  watch: {
    historyId: { type: String, default: null }, // Gmail last-seen history id
    subscriptionId: { type: String, default: null }, // Graph subscription id
    expiresAt: { type: Date, default: null },
  },
  status: {
    type: String,
    enum: ['active', 'error', 'disconnected'],
    default: 'active',
  },
  lastError: { type: String, default: null },
  connectedAt: { type: Date, default: Date.now },
  lastSyncAt: { type: Date, default: null },
});

// One mailbox per user per workspace.
emailAccountSchema.index({ userId: 1, workspaceId: 1 }, { unique: true });

/**
 * Encrypt + store OAuth tokens. Pass only the fields you have; omitted fields
 * are left untouched (e.g. a token refresh updates accessToken + expiresAt but
 * keeps the existing refreshToken). Always encrypts under the CURRENT key.
 */
emailAccountSchema.methods.setTokens = function setTokens({
  accessToken,
  refreshToken,
  expiresAt,
  scope,
} = {}) {
  if (accessToken !== undefined) {
    this.oauthTokens.accessToken = accessToken ? aesEncrypt.encrypt(accessToken) : null;
  }
  if (refreshToken !== undefined) {
    this.oauthTokens.refreshToken = refreshToken ? aesEncrypt.encrypt(refreshToken) : null;
  }
  if (expiresAt !== undefined) {
    this.oauthTokens.expiresAt = expiresAt ? new Date(expiresAt) : null;
  }
  if (scope !== undefined) this.oauthTokens.scope = scope || '';
  return this;
};

/**
 * Decrypt the stored tokens. Returns `{ accessToken, refreshToken, expiresAt,
 * scope, needsReEncrypt }`. `needsReEncrypt` is true when any token decrypted
 * only under the PREVIOUS key — callers can `setTokens(...)` + `save()` to
 * lazily re-encrypt under the current key (rotation strategy). Returns nulls for
 * tokens that fail to decrypt (corrupt / key fully rotated out).
 */
emailAccountSchema.methods.getDecryptedTokens = function getDecryptedTokens() {
  const out = {
    accessToken: null,
    refreshToken: null,
    expiresAt: this.oauthTokens?.expiresAt || null,
    scope: this.oauthTokens?.scope || '',
    needsReEncrypt: false,
  };
  for (const field of ['accessToken', 'refreshToken']) {
    const ct = this.oauthTokens?.[field];
    if (!ct) continue;
    const meta = aesEncrypt.decryptWithMeta(ct);
    if (meta) {
      out[field] = meta.plaintext;
      if (meta.usedPreviousKey) out.needsReEncrypt = true;
    }
  }
  return out;
};

/** Whether the access token is expired (with a 60s skew) and needs refresh. */
emailAccountSchema.methods.isAccessTokenExpired = function isAccessTokenExpired(now = new Date()) {
  const exp = this.oauthTokens?.expiresAt;
  if (!exp) return true;
  return new Date(exp).getTime() - 60_000 <= now.getTime();
};

module.exports = mongoose.model('EmailAccount', emailAccountSchema);
