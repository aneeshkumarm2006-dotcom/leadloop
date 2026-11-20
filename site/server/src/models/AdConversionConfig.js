const mongoose = require('mongoose');
const aesEncrypt = require('../utils/aesEncrypt');

/**
 * AdConversionConfig — where a workspace's qualified leads are reported back to
 * (Meta Conversions API, Google Ads offline conversions) and which pipeline
 * stages trigger it. One row per workspace.
 *
 * Meta: the dataset ID + a dataset access token generated in Events Manager
 * (scoped to that one dataset). The token is stored ENCRYPTED (AES-256-GCM via
 * aesEncrypt.js, same key as the email/SMS tokens) and never returned to the
 * client.
 *
 * Google: the client's Ads customer ID + conversion action(s). Credentials are
 * the agency's (developer token + MCC OAuth refresh token, from env) — the
 * client account must be linked under that manager account.
 *
 * One-click connections (services/adConnectService.js): an admin signs in
 * with Meta / Google / TikTok and picks accounts from dropdowns. The OAuth
 * results live under `meta.connection`, `google.connection` and `tiktok`; on
 * "select" they are mirrored into the original fields (meta.datasetId +
 * meta.accessToken, google.customerId + conversionActions) so the sender keeps
 * working unchanged. Every platform token (user/page/refresh) is AES-encrypted
 * and never returned to the client. Manual setup ("Advanced") still works:
 * `method` stays 'manual' (Meta) / 'agency' (Google).
 *
 * Rules: "a lead entering group X on board Y is a <stage>". `stage` is
 * 'qualified' or 'customer'; each platform maps a stage to its own event name /
 * conversion action.
 */
const STAGES = ['qualified', 'customer'];

const ruleSchema = new mongoose.Schema(
  {
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskGroup', required: true },
    stage: { type: String, enum: STAGES, required: true },
  },
  { _id: false }
);

const CONNECTION_STATUSES = ['none', 'authorized', 'ready'];

const metaPageSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true },
    name: { type: String, default: '' },
    accessToken: { type: String, default: null }, // AES-GCM page token
    instagramId: { type: String, default: '' },
    subscribed: { type: Boolean, default: false },
    connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadConnection', default: null },
  },
  { _id: false }
);

const pendingSchema = new mongoose.Schema(
  {
    idHash: { type: String, required: true },
    userId: { type: String, required: true },
    grant: { type: String, required: true }, // AES-GCM ciphertext
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false }
);

const adConversionConfigSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, unique: true },

    meta: {
      enabled: { type: Boolean, default: false },
      datasetId: { type: String, default: '' },
      // AES-GCM ciphertext — never the plaintext token.
      accessToken: { type: String, default: null },
      // When set, every event is sent as a TEST event (Events Manager → Test
      // events) and never counts towards real ad results.
      testEventCode: { type: String, default: '' },
      // Last time "Send test event" came back clean (no Meta warnings).
      lastTestOkAt: { type: Date, default: null },
      eventNames: {
        qualified: { type: String, default: 'QualifiedLead' },
        customer: { type: String, default: 'ConvertedLead' },
      },
      // One-click (OAuth) connection. `meta.accessToken` above holds the same
      // (long-lived user / system-user) token once assets are selected.
      connection: {
        method: { type: String, enum: ['manual', 'oauth'], default: 'manual' },
        status: { type: String, enum: CONNECTION_STATUSES, default: 'none' },
        userId: { type: String, default: '' },
        userName: { type: String, default: '' },
        // AES-GCM user token held between sign-in and asset selection.
        userToken: { type: String, default: null },
        tokenExpiresAt: { type: Date, default: null }, // null = non-expiring
        businessId: { type: String, default: '' },
        businessName: { type: String, default: '' },
        adAccountId: { type: String, default: '' },
        adAccountName: { type: String, default: '' },
        pixelName: { type: String, default: '' },
        pages: { type: [metaPageSchema], default: [] },
        connectedAt: { type: Date, default: null },
      },
    },

    google: {
      enabled: { type: Boolean, default: false },
      customerId: { type: String, default: '' }, // 10 digits, dashes optional
      conversionActions: {
        qualified: { type: String, default: '' }, // numeric ID or resource name
        customer: { type: String, default: '' },
      },
      connection: {
        method: { type: String, enum: ['agency', 'oauth'], default: 'agency' },
        status: { type: String, enum: CONNECTION_STATUSES, default: 'none' },
        email: { type: String, default: '' },
        refreshToken: { type: String, default: null }, // AES-GCM
        scopes: { type: [String], default: [] },
        loginCustomerId: { type: String, default: '' }, // manager (MCC) id, else ''
        customerName: { type: String, default: '' },
        currencyCode: { type: String, default: '' },
        conversionTrackingId: { type: String, default: '' }, // 'AW-123456789'
        autoTagging: { type: Boolean, default: false },
        gtm: {
          accountId: { type: String, default: '' },
          containerId: { type: String, default: '' },
          containerPublicId: { type: String, default: '' },
          workspaceId: { type: String, default: '' },
          tagId: { type: String, default: '' },
          versionId: { type: String, default: '' },
          publishedAt: { type: Date, default: null },
        },
        leadFormConnectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadConnection', default: null },
        connectedAt: { type: Date, default: null },
      },
    },

    tiktok: {
      enabled: { type: Boolean, default: false },
      accessToken: { type: String, default: null }, // AES-GCM
      connection: {
        status: { type: String, enum: CONNECTION_STATUSES, default: 'none' },
        userName: { type: String, default: '' },
        advertiserIds: { type: [String], default: [] },
        connectedAt: { type: Date, default: null },
      },
      bcId: { type: String, default: '' },
      advertiserId: { type: String, default: '' },
      advertiserName: { type: String, default: '' },
      pixelCode: { type: String, default: '' },
      pixelName: { type: String, default: '' },
      eventNames: {
        qualified: { type: String, default: 'QualifiedLead' },
        customer: { type: String, default: 'ConvertedLead' },
      },
      testEventCode: { type: String, default: '' },
      lastTestOkAt: { type: Date, default: null },
      instantForms: {
        enabled: { type: Boolean, default: false },
        connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadConnection', default: null },
        subscriptionId: { type: String, default: '' },
        // sha256 of the secret carried in the webhook URL (?k=…) — the
        // webhook's authentication; the plaintext is never stored.
        webhookKeyHash: { type: String, default: null, index: true },
        subscribedAt: { type: Date, default: null },
      },
    },

    // Single-use OAuth nonces (sha256) — only the latest "Connect" click per
    // platform can complete, and only once.
    oauthNonces: {
      meta: { type: String, default: null },
      google: { type: String, default: null },
      tiktok: { type: String, default: null },
    },

    // Sign-ins awaiting confirmation by the admin who started them (see
    // adConnectService.confirmOAuth). `grant` is AES-GCM JSON (token + profile);
    // only the sha256 of the one-time pendingId is stored.
    pendingOAuth: {
      meta: { type: pendingSchema, default: null },
      google: { type: pendingSchema, default: null },
      tiktok: { type: pendingSchema, default: null },
    },

    rules: { type: [ruleSchema], default: [] },

    // Health-alert bookkeeping (see services/adTrackingService.js).
    health: {
      lastFailureAlertAt: { type: Date, default: null },
    },

    // Country code assumed for 10-digit phone numbers when hashing.
    defaultPhoneCountryCode: { type: String, default: '1' },
  },
  { timestamps: true }
);

adConversionConfigSchema.methods.setMetaToken = function setMetaToken(token) {
  if (token === undefined) return this;
  this.meta.accessToken = token ? aesEncrypt.encrypt(token) : null;
  return this;
};

adConversionConfigSchema.methods.getMetaToken = function getMetaToken() {
  if (!this.meta || !this.meta.accessToken) return null;
  const meta = aesEncrypt.decryptWithMeta(this.meta.accessToken);
  return meta ? meta.plaintext : null;
};

// --- encrypted token helpers (plaintext never persisted) ----------------------
const enc = (token) => (token ? aesEncrypt.encrypt(token) : null);
const dec = (cipher) => {
  if (!cipher) return null;
  const m = aesEncrypt.decryptWithMeta(cipher);
  return m ? m.plaintext : null;
};

adConversionConfigSchema.methods.setMetaUserToken = function setMetaUserToken(token) {
  this.meta.connection.userToken = enc(token);
  return this;
};
adConversionConfigSchema.methods.getMetaUserToken = function getMetaUserToken() {
  return dec(this.meta && this.meta.connection && this.meta.connection.userToken);
};
adConversionConfigSchema.methods.getMetaPageToken = function getMetaPageToken(pageId) {
  const page = ((this.meta && this.meta.connection && this.meta.connection.pages) || []).find((p) => p.pageId === String(pageId));
  return page ? dec(page.accessToken) : null;
};
adConversionConfigSchema.methods.setGoogleRefreshToken = function setGoogleRefreshToken(token) {
  this.google.connection.refreshToken = enc(token);
  return this;
};
adConversionConfigSchema.methods.getGoogleRefreshToken = function getGoogleRefreshToken() {
  return dec(this.google && this.google.connection && this.google.connection.refreshToken);
};
adConversionConfigSchema.methods.setTikTokToken = function setTikTokToken(token) {
  this.tiktok.accessToken = enc(token);
  return this;
};
adConversionConfigSchema.methods.getTikTokToken = function getTikTokToken() {
  return dec(this.tiktok && this.tiktok.accessToken);
};

adConversionConfigSchema.methods.ruleFor = function ruleFor(boardId, groupId) {
  const b = String(boardId);
  const g = String(groupId);
  return (this.rules || []).find((r) => String(r.boardId) === b && String(r.groupId) === g) || null;
};

adConversionConfigSchema.statics.STAGES = STAGES;
adConversionConfigSchema.statics.encryptToken = enc;
adConversionConfigSchema.statics.decryptToken = dec;

adConversionConfigSchema.index({ 'meta.connection.pages.pageId': 1 });

module.exports = mongoose.model('AdConversionConfig', adConversionConfigSchema);
