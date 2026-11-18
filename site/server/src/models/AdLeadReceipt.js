const mongoose = require('mongoose');

/**
 * AdLeadReceipt — idempotency ledger for leads pulled straight from ad
 * platforms (Meta Lead Ads webhook, TikTok Instant Forms webhook).
 *
 * Platforms deliver at-least-once (and the same page can be subscribed by more
 * than one workspace), so before ingesting a lead we insert
 * `{ workspaceId, platform, externalId }` — the unique index makes the second
 * delivery a no-op. Rows expire after 90 days.
 */
const adLeadReceiptSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true },
  platform: { type: String, enum: ['meta', 'tiktok'], required: true },
  externalId: { type: String, required: true }, // leadgen_id / TikTok lead id
  connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadConnection', default: null },
  status: { type: String, enum: ['processing', 'ingested', 'failed'], default: 'processing' },
  error: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 3600 },
});

adLeadReceiptSchema.index({ workspaceId: 1, platform: 1, externalId: 1 }, { unique: true });

module.exports = mongoose.models.AdLeadReceipt || mongoose.model('AdLeadReceipt', adLeadReceiptSchema);
