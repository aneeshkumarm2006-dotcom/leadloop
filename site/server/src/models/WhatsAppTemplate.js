const mongoose = require('mongoose');

/**
 * WhatsAppTemplate — a workspace's approved WhatsApp message templates
 * (Phase 3, F11.1).
 *
 * WhatsApp Business requires pre-approved templates to message a contact OUTSIDE
 * the 24-hour customer-service window. Each row mirrors a Twilio Content
 * resource: `providerTemplateId` is the Twilio Content SID (`HXxxxx`), `body`
 * carries the `{{1}}`/`{{2}}`… placeholders, `variables` lists the ordered
 * placeholder names, and `status` reflects Meta's approval state. The template
 * manager (F11.5) syncs these from Twilio and the `SEND_WHATSAPP` action /
 * service block sends of non-`approved` templates outside the window (AC1).
 *
 * The `(workspaceId, providerTemplateId)` unique index makes the sync an
 * idempotent upsert.
 */
const whatsappTemplateSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    required: true,
  },
  // Twilio Content SID (e.g. "HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx").
  providerTemplateId: { type: String, required: true },
  name: { type: String, default: '' },
  language: { type: String, default: 'en' },
  // Template body with `{{1}}`, `{{2}}`… variable placeholders.
  body: { type: String, default: '' },
  status: {
    type: String,
    enum: ['approved', 'pending', 'rejected'],
    default: 'pending',
  },
  // Ordered placeholder names/labels (e.g. ["1", "2"] or ["name", "date"]).
  variables: { type: [String], default: [] },
  lastSyncedAt: { type: Date, default: Date.now },
});

whatsappTemplateSchema.index(
  { workspaceId: 1, providerTemplateId: 1 },
  { unique: true }
);

module.exports = mongoose.model('WhatsAppTemplate', whatsappTemplateSchema);
