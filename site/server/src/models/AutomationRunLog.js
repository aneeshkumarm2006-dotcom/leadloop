const mongoose = require('mongoose');

/**
 * AutomationRunLog — per-action audit row (Phase 2, F5.3).
 *
 * One row is written for every action execution *attempt* (by
 * `automationActionRunner.runActions`), capturing the outcome and a small,
 * redacted `payloadSummary`. This is the durable audit source (consumed by the
 * F16 audit view later) and backs `GET /api/automations/:id/run-log/actions`.
 *
 * It complements — rather than replaces — the capped `Automation.triggerHistory`:
 * triggerHistory is the last-20 quick view embedded on the automation; this
 * collection is the unbounded, queryable history. Both are fed from the same
 * per-action outcomes so the drawer and the audit table agree (F5.4).
 *
 * `runId` groups the rows produced by one firing (one event → N action rows)
 * under a single parent id so multi-action runs roll up together.
 */
const automationRunLogSchema = new mongoose.Schema({
  // Required for automation-driven rows; intake-policy rows (F9) carry a
  // `policyId` instead, so this is conditionally required.
  automationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Automation',
    required: function requireAutomationId() {
      return !this.policyId;
    },
    default: null,
    index: true,
  },
  // F9 — set when the row is produced by a LeadIntakePolicy run rather than an
  // Automation. The intake-events panel queries by `policyId` + `source`.
  policyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeadIntakePolicy',
    default: null,
    index: true,
  },
  // Discriminates the producer: 'automation' (default) | 'lead_intake' (F9).
  source: {
    type: String,
    enum: ['automation', 'lead_intake'],
    default: 'automation',
  },
  // The triggering (or created) task this action acted on. Null for actions with
  // no task context (e.g. "Run now" on a CREATE_TASK with no triggering item).
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    default: null,
    index: true,
  },
  // Groups all action rows from a single automation firing.
  runId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true,
  },
  actionType: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['ok', 'failed', 'skipped'],
    required: true,
  },
  error: {
    type: String,
    default: null,
  },
  // Small, redacted snapshot of what the action did/would do (e.g. the column +
  // value written, or the composed-but-undelivered message for a disabled
  // channel action). Never store secrets or full PII here.
  payloadSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Audit reads filter by automation or task and sort by recency.
automationRunLogSchema.index({ automationId: 1, createdAt: -1 });
automationRunLogSchema.index({ taskId: 1, createdAt: -1 });
// F9 — intake-events panel reads the policy's parent run rows, newest first.
automationRunLogSchema.index({ policyId: 1, createdAt: -1 });

module.exports = mongoose.model('AutomationRunLog', automationRunLogSchema);
