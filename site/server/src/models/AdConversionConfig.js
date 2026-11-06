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
    },

    google: {
      enabled: { type: Boolean, default: false },
      customerId: { type: String, default: '' }, // 10 digits, dashes optional
      conversionActions: {
        qualified: { type: String, default: '' }, // numeric ID or resource name
        customer: { type: String, default: '' },
      },
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

adConversionConfigSchema.methods.ruleFor = function ruleFor(boardId, groupId) {
  const b = String(boardId);
  const g = String(groupId);
  return (this.rules || []).find((r) => String(r.boardId) === b && String(r.groupId) === g) || null;
};

adConversionConfigSchema.statics.STAGES = STAGES;

module.exports = mongoose.model('AdConversionConfig', adConversionConfigSchema);
