const mongoose = require('mongoose');

/**
 * LeadConsent — what a specific lead agreed to, per channel.
 *
 * The point of this record is not the boolean; it is the EVIDENCE. If a
 * regulator or a plaintiff asks "on what basis did you text this person?", the
 * answer has to be a timestamped record naming the exact wording shown, where
 * it was captured, and from what IP. So we store all of it.
 *
 * One document per (lead, channel).
 */

const leadConsentSchema = new mongoose.Schema(
  {
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },

    channel: { type: String, enum: ['email', 'sms', 'whatsapp', 'call'], required: true },

    // 'express' | 'implied' | 'none' | 'withdrawn' — see consentService.STATES.
    state: { type: String, default: 'none' },

    // For implied consent, what created it: 'enquiry' (6 months under CASL) or
    // 'transaction' (2 years). Ignored for express consent.
    basis: { type: String, enum: ['enquiry', 'transaction', null], default: null },

    // --- evidence ----------------------------------------------------------
    // Where it came from: 'form' | 'import' | 'manual' | 'reply' | 'portal'.
    source: { type: String, default: '' },
    // The EXACT consent wording shown at capture time. Wording changes over the
    // years; what matters is what THIS person actually agreed to.
    wording: { type: String, default: '' },
    capturedAt: { type: Date, default: null },
    // Explicit override of the implied-consent expiry.
    expiresAt: { type: Date, default: null },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    // Set when the person opts out, so the audit trail keeps both moments.
    withdrawnAt: { type: Date, default: null },

    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

leadConsentSchema.index({ task: 1, channel: 1 }, { unique: true });

module.exports = mongoose.model('LeadConsent', leadConsentSchema);
