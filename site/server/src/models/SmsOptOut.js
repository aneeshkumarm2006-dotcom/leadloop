const mongoose = require('mongoose');

/**
 * SmsOptOut — a phone number that has opted out of SMS for a workspace
 * (Phase 3, F10.1).
 *
 * Written when an inbound reply is STOP/STOPALL/UNSUBSCRIBE (and removed on
 * START/UNSTOP). `smsService.send` checks this collection BEFORE every send and
 * blocks opted-out numbers — the TCPA/CASL compliance gate. The same check is
 * reused by F11 WhatsApp so STOP suppresses both channels for the number.
 *
 * `phone` is the sender's number as Twilio delivers it (E.164, e.g.
 * "+15551234567") — kept for display. Matching is done on `phoneKey` (the
 * last-10 digits), the SAME tolerant key the inbound resolver uses, so a STOP
 * from any format blocks sends to the same line stored in any other format
 * (a lead in national format would otherwise slip the gate — TCPA/CASL). The
 * unique (workspaceId, phoneKey) index makes the opt-out idempotent.
 */
const smsOptOutSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    required: true,
  },
  phone: { type: String, required: true },
  phoneKey: { type: String, required: true },
  optedOutAt: { type: Date, default: Date.now },
});

smsOptOutSchema.index({ workspaceId: 1, phoneKey: 1 }, { unique: true });

module.exports = mongoose.model('SmsOptOut', smsOptOutSchema);
