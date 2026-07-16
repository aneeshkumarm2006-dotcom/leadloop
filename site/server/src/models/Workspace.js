const mongoose = require('mongoose');

/**
 * Workspace (Phase 3.0) — a real grouping layer INSIDE an organisation.
 * Hierarchy: Organisation (the company / tenant) → Workspace → Board.
 *
 * A board keeps its `organisation` ref (tenant scoping + all existing permission
 * code keeps working) AND gains a `workspace` ref (this model) for grouping and
 * per-workspace access control (Stage 2). Non-admin members reach a workspace /
 * its boards via `WorkspaceGrant`; org owners/admins see everything.
 *
 * This REPLACES the former readability alias that re-exported Organisation
 * (nothing in the codebase imported it). The org model stays `Organisation`.
 */
const workspaceSchema = new mongoose.Schema(
  {
    organisation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    // The auto-created "General" workspace that holds pre-existing boards during
    // migration. Exactly one per org; cannot be deleted while it's the only one.
    isDefault: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Workspace', workspaceSchema);
