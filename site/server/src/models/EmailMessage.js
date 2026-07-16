const mongoose = require('mongoose');

/**
 * EmailMessage — one email in a task's thread (Phase 3, F8.2).
 *
 * Both directions live in one collection:
 *   - `direction: 'out'` — composed + sent from the Emails tab or the
 *     SEND_EMAIL automation. `status` walks queued → sent → (bounced/failed).
 *     Open/click tracking appends to `openedAt[]` / `clicks[]`.
 *   - `direction: 'in'`  — captured from provider push / IMAP poll and routed to
 *     the matching Lead task by the sender's email. `status: 'received'`.
 *
 * `threadId` groups a conversation; `messageId` is the provider's RFC-5322
 * Message-ID (unique sparse so a re-sync never double-writes the same message);
 * `inReplyTo` carries the parent Message-ID for threading.
 */
const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, default: '' },
    mime: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const emailMessageSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  threadId: { type: String, default: null },
  direction: {
    type: String,
    enum: ['in', 'out'],
    required: true,
  },
  from: { type: String, default: '' },
  to: { type: [String], default: [] },
  cc: { type: [String], default: [] },
  bcc: { type: [String], default: [] },
  subject: { type: String, default: '' },
  // Plain-text body (rendered in the thread list / preview).
  body: { type: String, default: '' },
  // Sanitised HTML body (rendered in the read pane).
  bodyHtml: { type: String, default: '' },
  attachments: { type: [attachmentSchema], default: [] },
  // Provider Message-ID + threading parent.
  messageId: { type: String, default: null },
  inReplyTo: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
  // Tracking — one entry appended per open / click event.
  openedAt: { type: [Date], default: [] },
  clicks: {
    type: [
      new mongoose.Schema(
        { url: { type: String, default: '' }, at: { type: Date, default: Date.now } },
        { _id: false }
      ),
    ],
    default: [],
  },
  status: {
    type: String,
    enum: ['queued', 'sent', 'failed', 'bounced', 'received'],
    default: 'queued',
  },
  // Set on send/receive: 'gmail' | 'microsoft' | 'smtp' | 'resend' | 'unknown'.
  provider: { type: String, default: null },
  // The user whose mailbox sent it (outbound) — for "from the agent's mailbox".
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
});

// Thread reads: most-recent-first per task.
emailMessageSchema.index({ taskId: 1, sentAt: -1 });
// Dedup on re-sync; sparse so outbound rows without a Message-ID don't collide.
emailMessageSchema.index({ messageId: 1 }, { unique: true, sparse: true });
emailMessageSchema.index({ threadId: 1 });

module.exports = mongoose.model('EmailMessage', emailMessageSchema);
