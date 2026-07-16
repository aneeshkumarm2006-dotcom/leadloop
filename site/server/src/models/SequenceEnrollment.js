/**
 * SequenceEnrollment.js — one lead's progress through an EmailSequence.
 *
 * Created when a Task (lead) is enrolled (manually, in bulk for a "mass email",
 * or via the ENROLL_IN_SEQUENCE automation action). `currentStep` is the index
 * of the NEXT step to send; `nextRunAt` is when it's due. The sequenceRunner
 * sweeps `{ status: 'active', nextRunAt: <= now }` every minute, sends the step,
 * advances the cursor, and marks the enrollment `completed` after the last step.
 * `stopped` / `replied` / `unsubscribed` are terminal early exits.
 */

const mongoose = require('mongoose');

const STATUSES = ['active', 'completed', 'stopped', 'replied', 'failed', 'unsubscribed'];

const historyEntrySchema = new mongoose.Schema(
  {
    step: { type: Number, required: true },
    sentAt: { type: Date, default: Date.now },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailMessage', default: null },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'sent' },
    error: { type: String, default: '' },
  },
  { _id: false }
);

const sequenceEnrollmentSchema = new mongoose.Schema(
  {
    sequence: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailSequence',
      required: true,
      index: true,
    },
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', default: null },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', default: null },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      index: true,
    },
    recipientEmail: { type: String, default: '' },
    status: { type: String, enum: STATUSES, default: 'active' },
    // Index of the next step to send (0-based). >= steps.length → complete.
    currentStep: { type: Number, default: 0 },
    nextRunAt: { type: Date, default: null },
    enrolledAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    stoppedReason: { type: String, default: '' },
    lastMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailMessage', default: null },
    history: { type: [historyEntrySchema], default: [] },
    enrolledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Runner sweep — due active enrollments, oldest first.
sequenceEnrollmentSchema.index({ status: 1, nextRunAt: 1 });
// Fast "is this lead already enrolled?" + reply-stop lookups.
sequenceEnrollmentSchema.index({ sequence: 1, task: 1 });
sequenceEnrollmentSchema.index({ task: 1, status: 1 });

sequenceEnrollmentSchema.statics.STATUSES = STATUSES;

module.exports =
  mongoose.models.SequenceEnrollment ||
  mongoose.model('SequenceEnrollment', sequenceEnrollmentSchema);
