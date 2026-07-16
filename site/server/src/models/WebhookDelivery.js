const mongoose = require('mongoose');

/**
 * WebhookDelivery — one audit/queue row per webhook attempt (Phase 3, F7.2).
 *
 * Inbound: written `status: 'delivered'` after a successful ingress so the
 * delivery log shows received payloads.
 *
 * Outbound: written `status: 'pending'` by the dispatcher, then advanced to
 * `delivered` (2xx) or retried. On failure `attempt` increments and
 * `nextRetryAt` is set to the next backoff instant (1m/5m/30m/2h); after the
 * retries are exhausted the row is marked `failed`. The minute retry cron scans
 * `{ status: 'pending', nextRetryAt <= now }` and re-attempts — hence the
 * compound index below.
 */
const webhookDeliverySchema = new mongoose.Schema({
  endpointId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WebhookEndpoint',
    required: true,
  },
  direction: {
    type: String,
    enum: ['in', 'out'],
    required: true,
  },
  // The inbound body received, or the outbound envelope sent (redacted of the
  // signature/secret — those never land here).
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  // Outbound only — the destination's response.
  response: {
    status: { type: Number, default: null },
    body: { type: String, default: null },
  },
  status: {
    type: String,
    enum: ['pending', 'delivered', 'failed'],
    required: true,
    default: 'pending',
  },
  // Count of attempts already made (0 before the first POST). Drives backoff.
  attempt: {
    type: Number,
    default: 0,
  },
  // When the retry cron should next re-attempt a `pending` outbound delivery.
  nextRetryAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Retry-cron scan: pending deliveries whose next attempt is due.
webhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });
// Delivery-log reads: most-recent-first per endpoint.
webhookDeliverySchema.index({ endpointId: 1, createdAt: -1 });

module.exports = mongoose.model('WebhookDelivery', webhookDeliverySchema);
