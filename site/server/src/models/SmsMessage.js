const mongoose = require('mongoose');

/**
 * SmsMessage — one SMS in a task's conversation (Phase 3, F10.1).
 *
 * Both directions live in one collection:
 *   - `direction: 'out'` — sent from the SMS tab or the SEND_SMS automation.
 *     `status` walks queued → sent → delivered (or failed), driven first by the
 *     Twilio create response and then by the `POST /api/sms/status` callbacks,
 *     each of which appends to `statusUpdates[]`.
 *   - `direction: 'in'`  — captured from the Twilio inbound webhook and routed to
 *     the matching Lead task by the sender's phone. `status: 'received'`.
 *
 * `twilioSid` is the provider Message SID (unique sparse so a replayed status
 * callback / re-delivery never double-writes the same message). The chat-bubble
 * UI (shared with F11 WhatsApp) reads the thread by `taskId`.
 */
const statusUpdateSchema = new mongoose.Schema(
  {
    status: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const smsMessageSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  direction: {
    type: String,
    enum: ['in', 'out'],
    required: true,
  },
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  body: { type: String, default: '' },
  // Twilio Message SID (e.g. "SMxxxx"). Null for a send that never reached Twilio.
  twilioSid: { type: String, default: null },
  status: {
    type: String,
    enum: ['queued', 'sent', 'delivered', 'failed', 'received'],
    default: 'queued',
  },
  // Append-only delivery-status history (sent → delivered → failed …).
  statusUpdates: { type: [statusUpdateSchema], default: [] },
  // Transient send error (e.g. opted-out / invalid number) for surfacing in UI.
  error: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
});

// Thread reads: most-recent-first per task.
smsMessageSchema.index({ taskId: 1, sentAt: -1 });
// Dedup on replayed callbacks; sparse so rows without a SID don't collide.
smsMessageSchema.index({ twilioSid: 1 }, { unique: true, sparse: true });
// Inbound routing-by-phone reads the latest message from a given number.
smsMessageSchema.index({ from: 1, sentAt: -1 });

module.exports = mongoose.model('SmsMessage', smsMessageSchema);
