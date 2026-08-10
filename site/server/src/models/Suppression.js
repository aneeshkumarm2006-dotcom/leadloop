const mongoose = require('mongoose');

/**
 * Suppression — "never contact this address/number again", workspace-wide.
 *
 * Complements the existing per-channel `SmsOptOut` (which already handles SMS
 * STOP keywords) by covering EMAIL unsubscribes, do-not-call entries and manual
 * additions in one place. The consent gate checks both, so an SMS opt-out
 * recorded by the older path still blocks.
 *
 * `value` is stored normalised (lowercased email / last-10-digit phone key) so
 * a lookup is exact and formatting differences can't slip through.
 */

const suppressionSchema = new mongoose.Schema(
  {
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },

    // 'email' | 'phone' — which identifier this row suppresses.
    kind: { type: String, enum: ['email', 'phone'], required: true },
    // Normalised key used for matching (see consentGate.normalizeKey).
    value: { type: String, required: true },
    // What the user actually typed/replied, for display.
    display: { type: String, default: '' },

    /**
     * Why they are suppressed — shown in the UI and the audit export:
     *   stop         replied STOP to a text
     *   unsubscribe  clicked unsubscribe in an email
     *   dnc          on a do-not-call registry
     *   manual       added by an admin
     *   bounce       hard bounce / invalid address
     */
    reason: { type: String, enum: ['stop', 'unsubscribe', 'dnc', 'manual', 'bounce'], default: 'manual' },

    // Free-text evidence (the inbound message, the request, who added it).
    note: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One row per identifier per workspace; re-suppressing is idempotent.
suppressionSchema.index({ organisation: 1, kind: 1, value: 1 }, { unique: true });

module.exports = mongoose.model('Suppression', suppressionSchema);
