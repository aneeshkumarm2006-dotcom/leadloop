const mongoose = require('mongoose');

/**
 * ConversionEvent — one attempt-tracked send of a lead's stage to one ad
 * platform. Doubles as the work queue (pending/failed rows with a due
 * `nextAttemptAt` are retried by the runner) and as the audit trail shown on
 * the lead ("Sent to Meta ✓", "Skipped — no ad consent").
 *
 * Unique on (task, platform, stage): a lead is reported as Qualified to Meta at
 * most once, however many times it is dragged in and out of the stage.
 */
const conversionEventSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    platform: { type: String, enum: ['meta', 'google'], required: true },
    stage: { type: String, enum: ['qualified', 'customer'], required: true },
    eventId: { type: String, required: true }, // sent to the platform for de-duplication
    eventTime: { type: Date, required: true }, // when the lead reached the stage

    // pending → sent | failed (retrying) | dead (gave up) | skipped (not eligible)
    status: { type: String, enum: ['pending', 'sent', 'failed', 'dead', 'skipped'], default: 'pending', index: true },
    reason: { type: String, default: '' }, // skip/failure reason (machine key or platform message)
    test: { type: Boolean, default: false }, // sent with a Meta test event code
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    response: { type: mongoose.Schema.Types.Mixed, default: null }, // trimmed platform reply
  },
  { timestamps: true }
);

conversionEventSchema.index({ taskId: 1, platform: 1, stage: 1 }, { unique: true });

module.exports = mongoose.model('ConversionEvent', conversionEventSchema);
