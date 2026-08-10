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

// Business profile captured by the first-run setup wizard. `country` drives
// currency/date defaults and, later, which compliance regime applies (US TCPA
// vs Canada CASL); `businessType` picks the starter board template.
const COUNTRIES = ['CA', 'US'];
const BUSINESS_TYPES = ['sales', 'leasing', 'both', 'property_management'];

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

  // --- Business profile (setup wizard) -------------------------------------
  country: { type: String, enum: COUNTRIES, default: null },
  timezone: { type: String, default: '' }, // IANA name, e.g. America/Toronto
  currency: { type: String, default: '' }, // ISO 4217, e.g. CAD
  businessType: { type: String, enum: BUSINESS_TYPES, default: null },

  /**
   * Speed-to-lead policy. See services/slaService.resolvePolicy — anything
   * missing or invalid falls back to the defaults (5-minute target,
   * escalate at 10).
   */
  sla: {
    enabled: { type: Boolean, default: true },
    targetMinutes: { type: Number, default: 5 },
    escalateAfterMinutes: { type: Number, default: 10 },
    reassign: { type: Boolean, default: true },
  },

  /**
   * First-run setup state. Most checklist items are DERIVED from real data
   * (does a board exist? a second member? a lead source?) rather than stored —
   * a stored flag drifts from reality, and the whole point of this checklist is
   * that it reflects what is actually configured. Only what cannot be derived
   * lives here: whether the wizard was finished, and whether the workspace
   * dismissed the checklist.
   */
  setup: {
    wizardCompletedAt: { type: Date, default: null },
    checklistDismissed: { type: Boolean, default: false },
    // Items the user explicitly ticked that have no derivable signal.
    manualDone: { type: [String], default: [] },
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

organisationSchema.statics.REGIONS = REGIONS;
organisationSchema.statics.COUNTRIES = COUNTRIES;
organisationSchema.statics.BUSINESS_TYPES = BUSINESS_TYPES;

module.exports = mongoose.model('Organisation', organisationSchema);
module.exports.REGIONS = REGIONS;
module.exports.COUNTRIES = COUNTRIES;
module.exports.BUSINESS_TYPES = BUSINESS_TYPES;
