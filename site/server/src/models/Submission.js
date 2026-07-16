const mongoose = require('mongoose');

/**
 * Submission — an audit row for every public form submission (Phase 4, F13.1).
 *
 * The deliverable is the task (created via the F1 column engine); this row is
 * the audit trail. `payload` is the raw `{ [formFieldId]: value }` body, `taskId`
 * links to the created task, and `ip`/`userAgent` capture the submitter for
 * abuse triage. Mirrors how `WebhookDelivery` records an inbound webhook (F7).
 *
 * Index: `{ formId: 1, createdAt: -1 }` — list a form's recent submissions.
 */
const submissionSchema = new mongoose.Schema(
  {
    formId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Form',
      required: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

submissionSchema.index({ formId: 1, createdAt: -1 });

module.exports = mongoose.model('Submission', submissionSchema);
