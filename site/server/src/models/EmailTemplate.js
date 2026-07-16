const mongoose = require('mongoose');

/**
 * EmailTemplate — a reusable, named email body with `{{variable}}` tokens
 * (Phase 3, F9.1).
 *
 * Used as the welcome-touch copy for the F9 Lead Intake policy (and reusable by
 * F14 auto-response drafts later). Seeded global templates carry `isSeed: true`
 * and `workspaceId: null`; workspaces may also save their own. `key` is a stable
 * slug, unique among seed templates, so the seed upsert is idempotent.
 *
 * Bodies are interpolated at send time by `templateInterpolate.js` — `{{Column
 * Name}}` tokens resolve against the lead's task, `{{user.*}}` against the
 * sending agent.
 */
const emailTemplateSchema = new mongoose.Schema(
  {
    // Null for global seed templates; set for workspace-authored ones.
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      default: null,
      index: true,
    },
    key: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      required: true,
    },
    subject: {
      type: String,
      default: '',
    },
    body: {
      type: String,
      default: '',
    },
    // Region tag (Edmonton / Saskatoon / …) or null for region-agnostic copy.
    region: {
      type: String,
      default: null,
    },
    isSeed: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Seed templates resolve by their stable slug; unique + sparse so
// workspace-authored templates (key: null) don't collide.
emailTemplateSchema.index({ key: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
