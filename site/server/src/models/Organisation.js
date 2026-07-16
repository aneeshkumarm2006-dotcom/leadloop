const mongoose = require('mongoose');

/**
 * Organisation — the workspace tenant. Phase 1 / F3 renames the *surface* to
 * "Workspace" (API + UI) but keeps the MongoDB collection named `organisations`
 * to avoid a downtime-inducing rename. New code can require the readability
 * alias at models/Workspace.js; both point at this exact model.
 *
 * F3 additions (rename surface only — the admin/admins/members/inviteCode shape
 * is untouched so every existing membership check keeps working):
 *   - displayName     — optional friendlier label shown in the UI
 *   - region          — coarse geography for grouping workspaces
 *   - parentWorkspace — optional hierarchy pointer (a regional child of a parent)
 */
const REGIONS = ['Edmonton', 'Saskatoon', 'Regina', 'Montreal', 'Other'];

const organisationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  displayName: {
    type: String,
  },
  region: {
    type: String,
    enum: REGIONS,
  },
  parentWorkspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    default: null,
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  inviteCode: {
    type: String,
    unique: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

organisationSchema.statics.REGIONS = REGIONS;

module.exports = mongoose.model('Organisation', organisationSchema);
module.exports.REGIONS = REGIONS;
