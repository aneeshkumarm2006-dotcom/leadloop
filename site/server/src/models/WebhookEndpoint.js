const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * WebhookEndpoint — a per-board inbound or outbound webhook (Phase 3, F7.2).
 *
 * Two directions share one collection:
 *   - `direction: 'in'`  — a public ingress URL `/api/webhooks/in/:token`. An
 *     external system POSTs JSON; the inbound resolver maps it onto a new task
 *     (via `mapping`) and emits `lead.intake` + `webhook.received`. `token` is
 *     the unguessable path segment; `secret` is reserved for optional inbound
 *     signature verification.
 *   - `direction: 'out'` — a destination `url` the `POST_WEBHOOK` action ships a
 *     signed JSON envelope to (HMAC over the body with `secret`, sent as
 *     `X-CRM-Signature`). `eventTypes` optionally filters which events fire it.
 *
 * `token` and `secret` are generated with `crypto.randomBytes` in the
 * pre-validate hook below when absent, so controllers never have to remember to.
 */
const webhookEndpointSchema = new mongoose.Schema({
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    required: true,
    index: true,
  },
  direction: {
    type: String,
    enum: ['in', 'out'],
    required: true,
  },
  // Inbound only — the unguessable path token. Unique + sparse so outbound rows
  // (which have no token) don't collide on `null`.
  token: {
    type: String,
    default: null,
  },
  // Outbound only — the destination URL.
  url: {
    type: String,
    default: null,
  },
  // Shared HMAC secret: signs outbound envelopes; verifies inbound signatures.
  secret: {
    type: String,
    required: true,
  },
  // Inbound only — `{ [columnId]: jsonPath }` applied to the request body.
  mapping: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  // Outbound only — event names that fire this endpoint (empty = all).
  eventTypes: {
    type: [String],
    default: [],
  },
  enabled: {
    type: Boolean,
    default: true,
    index: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Unique sparse index on the inbound token so `/in/:token` resolves with one
// indexed lookup and outbound rows (token: null) are exempt from uniqueness.
webhookEndpointSchema.index({ token: 1 }, { unique: true, sparse: true });

/**
 * Generate the credentials on first save. Inbound rows get a URL-safe `token`;
 * both directions get a `secret`. Uses hex so the values are safe in URLs and
 * headers without extra encoding.
 */
webhookEndpointSchema.pre('validate', function generateCredentials(next) {
  if (this.direction === 'in' && !this.token) {
    this.token = crypto.randomBytes(24).toString('hex');
  }
  if (!this.secret) {
    this.secret = crypto.randomBytes(32).toString('hex');
  }
  next();
});

module.exports = mongoose.model('WebhookEndpoint', webhookEndpointSchema);
