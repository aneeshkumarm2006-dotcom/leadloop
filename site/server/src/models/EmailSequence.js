/**
 * EmailSequence.js — a multi-step email drip cadence (Phase 4, Comms).
 *
 * A sequence is an ordered list of `steps`, each with a relative delay (after the
 * previous step, or after enrollment for the first step) and a templated
 * subject/body. Leads (Tasks) are enrolled into a sequence; the sequenceRunner
 * walks each enrollment step-by-step, sending through the existing tracked
 * `sendEmailForTask` path (so open/click tracking comes for free), and stops a
 * contact automatically on reply when `stopOnReply` is set.
 *
 * Board-scoped: `emailColumnId` names the board column that holds each lead's
 * email address (defaults to the board's first `email` column when unset).
 */

const mongoose = require('mongoose');

const DELAY_UNITS = ['minutes', 'hours', 'days'];

const stepSchema = new mongoose.Schema(
  {
    // Delay BEFORE this step fires, measured from the previous step's send
    // (or from enrollment for the first step). 0 = send immediately.
    delayAmount: { type: Number, default: 0, min: 0 },
    delayUnit: { type: String, enum: DELAY_UNITS, default: 'days' },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    // Optional EmailTemplate to source subject/body from when the inline
    // subject/body are left blank.
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTemplate', default: null },
  },
  { _id: false }
);

const emailSequenceSchema = new mongoose.Schema(
  {
    organisation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    // Board column id (string — board columns are subdocs) holding the lead's
    // email. Empty → resolve the board's first `email` column at send time.
    emailColumnId: { type: String, default: '' },
    steps: { type: [stepSchema], default: [] },
    // Stop a contact's enrollment automatically when they reply (an inbound
    // email arrives on their task). Honoured by the runner's reply listener.
    stopOnReply: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

emailSequenceSchema.statics.DELAY_UNITS = DELAY_UNITS;

module.exports =
  mongoose.models.EmailSequence ||
  mongoose.model('EmailSequence', emailSequenceSchema);
