const mongoose = require('mongoose');

/**
 * Campaign — a marketing campaign with an ad spend, used by the Phase 2.3
 * Marketing/ROI report. Each campaign carries a `source` label (e.g.
 * "Google Ads", "Facebook") that is matched (case-insensitive) against a lead's
 * value in the board's designated "source" column to attribute leads + compute
 * cost-per-lead and ROI.
 *
 * Scope: a campaign belongs to a workspace (`workspaceId` = Organisation _id)
 * and optionally a specific board (`boardId`); a null board means it applies
 * org-wide for that source.
 */
const campaignSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    // The source label this campaign drives — matched against the lead source
    // column value to attribute leads. Stored lower-cased-trimmed-insensitive at
    // compare time; kept as entered for display.
    source: { type: String, required: true, trim: true },
    // Ad spend for the campaign (in the workspace's currency; plain number).
    budget: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Campaign', campaignSchema);
