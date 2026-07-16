const mongoose = require('mongoose');

/**
 * LeadIngestLog — one row per API lead submission (Phase 4b, F14).
 *
 * The F14 counterpart to `WebhookDelivery` / `Submission`: it preserves each
 * inbound payload and its outcome so the docs UI can show a "recent submissions"
 * log and the admin can confirm their website form is wired up correctly. A
 * failed log write never fails the submission (the task is the deliverable), so
 * this is best-effort audit, not a source of truth.
 *
 * `status`:
 *   - `created`   — a task was created (normal path);
 *   - `provisioned` — first call: columns were defined AND a task created;
 *   - `evolved`   — a later call carried new fields; columns were added AND a
 *      task created (schema evolution);
 *   - `rejected`  — the submission was refused (disabled key, empty body, …);
 *      `error` carries the reason.
 */
const leadIngestLogSchema = new mongoose.Schema(
  {
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadConnection',
      required: true,
      index: true,
    },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board' },
    // The created task, when one was created.
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    status: {
      type: String,
      enum: ['created', 'provisioned', 'evolved', 'rejected'],
      default: 'created',
    },
    // Raw submitted body (capped upstream at 256KB by the route's body parser).
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Non-fatal warnings surfaced to the caller (unknown key, invalid value…).
    warnings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    error: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

module.exports = mongoose.model('LeadIngestLog', leadIngestLogSchema);
