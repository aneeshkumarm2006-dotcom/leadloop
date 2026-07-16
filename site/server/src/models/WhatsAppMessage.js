const mongoose = require('mongoose');

/**
 * WhatsAppMessage — one WhatsApp message in a task's conversation
 * (Phase 3, F11.1).
 *
 * Same shape as `SmsMessage` (F10.1) — both directions in one collection, a
 * Twilio Message SID for dedup + status callbacks, and an append-only
 * `statusUpdates[]` history — plus an optional `mediaUrl` for image/document
 * messages (Cloudinary-hosted; sent to WhatsApp by URL).
 *
 *   - `direction: 'out'` — sent from the WhatsApp tab or the SEND_WHATSAPP
 *     automation. `status` walks queued → sent → delivered (or failed).
 *   - `direction: 'in'`  — captured from the Twilio inbound webhook, routed to
 *     the matching Lead task by the sender's phone, and OPENS the 24-hour
 *     free-form window (F11.2). `status: 'received'`.
 *
 * The chat-bubble UI (shared `ChatBubble`, F10.5) reads the thread by `taskId`.
 */
const statusUpdateSchema = new mongoose.Schema(
  {
    status: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const whatsappMessageSchema = new mongoose.Schema({
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
  // Optional media (image/document) URL — Cloudinary-hosted, sent by URL.
  mediaUrl: { type: String, default: null },
  // Twilio Message SID (e.g. "SMxxxx"/"MMxxxx"). Null when the send never
  // reached Twilio.
  twilioSid: { type: String, default: null },
  status: {
    type: String,
    enum: ['queued', 'sent', 'delivered', 'failed', 'received'],
    default: 'queued',
  },
  // Append-only delivery-status history (sent → delivered → failed …).
  statusUpdates: { type: [statusUpdateSchema], default: [] },
  // Transient send error (e.g. opted-out / window closed) for surfacing in UI.
  error: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
});

// Thread reads: most-recent-first per task.
whatsappMessageSchema.index({ taskId: 1, sentAt: -1 });
// Dedup on replayed callbacks; sparse so rows without a SID don't collide.
whatsappMessageSchema.index({ twilioSid: 1 }, { unique: true, sparse: true });
// Inbound routing-by-phone + 24h-window reads the latest message from a number.
whatsappMessageSchema.index({ from: 1, sentAt: -1 });

module.exports = mongoose.model('WhatsAppMessage', whatsappMessageSchema);
