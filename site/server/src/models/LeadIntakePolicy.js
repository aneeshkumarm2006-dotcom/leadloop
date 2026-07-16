const mongoose = require('mongoose');

/**
 * LeadIntakePolicy — a per-board "what happens when a new lead arrives" policy
 * (Phase 3, F9.1).
 *
 * One policy per board (unique `boardId`). When a `lead.intake` event fires for
 * the board (emitted by the F7 inbound webhook resolver / F13 forms), the
 * `leadIntakeRunner` runs four atomic steps against the new task:
 *   1. owner assignment   — round_robin / geo / fixed → person column
 *   2. initial stage       — set `initialStageColumnId` to `initialStageValue`
 *   3. welcome touch       — send the templated email (F8) from the agent's box
 *   4. follow-up           — create a "Call lead" subitem due `followupOffsetHours`
 *
 * Owner-assignment strategies:
 *   - `round_robin` — cycle the `ownerPool` deterministically, advancing
 *     `lastAssignedIndex` atomically ($inc) so concurrent intakes don't collide.
 *   - `geo`         — look up the lead's city (value of `geoColumnId`) in
 *     `geoMap` (city → userId). A city absent from the map falls back to
 *     round-robin across the union of `geoMap` users (AC4).
 *   - `fixed`       — always `fixedOwnerId`.
 *
 * Welcome-email copy: `welcomeEmailTemplateId` references a seeded
 * `EmailTemplate`, OR the inline `welcomeEmailSubject` / `welcomeEmailBody`
 * (edited in the policy form via TemplateVariableMenu) override it. Per-region
 * copy is the pending Thoma stakeholder check — ship `region: null` defaults.
 */
const leadIntakePolicySchema = new mongoose.Schema(
  {
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
      unique: true,
      index: true,
    },
    ownerStrategy: {
      type: String,
      enum: ['round_robin', 'geo', 'fixed'],
      default: 'round_robin',
    },
    // The board person/assignees column the resolved owner is written into.
    // Optional — the runner resolves the board's assignees/person column when
    // unset (prefers key 'assignees', else the first person-typed column).
    ownerColumnId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // round_robin / geo-fallback pool of candidate user ids.
    ownerPool: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    // geo strategy — the city/region column read off the lead, and the
    // city → userId routing map.
    geoColumnId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    geoMap: {
      type: Map,
      of: mongoose.Schema.Types.ObjectId,
      default: {},
    },
    fixedOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Step 2 — initial stage: which status column + which option id.
    initialStageColumnId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    initialStageValue: {
      type: String,
      default: null,
    },
    // Step 3 — welcome email. Either a reusable template ref or inline copy.
    welcomeEmailTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      default: null,
    },
    welcomeEmailSubject: {
      type: String,
      default: '',
    },
    welcomeEmailBody: {
      type: String,
      default: '',
    },
    // Step 4 — follow-up "Call lead" subitem offset (default 24h / next day).
    followupOffsetHours: {
      type: Number,
      default: 24,
    },
    // round_robin cursor — advanced atomically by the runner.
    lastAssignedIndex: {
      type: Number,
      default: -1,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeadIntakePolicy', leadIntakePolicySchema);
