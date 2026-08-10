const mongoose = require('mongoose');

/**
 * DuplicateCandidate — "these two leads look like the same person".
 *
 * Detection NEVER merges on its own. It records a candidate pair for a human to
 * confirm, because a wrong merge destroys two real people's records while a
 * missed duplicate is merely annoying (see dedupeService.js).
 *
 * `task` is the newly-arrived lead, `duplicateOf` the older record it appears
 * to duplicate. The pair is stored in that direction so the queue reads as
 * "this new lead may already exist".
 */

const duplicateCandidateSchema = new mongoose.Schema(
  {
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },

    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },

    // 0–100 from dedupeService.scoreMatch, plus which signals fired
    // ('phone' | 'email' | 'name') so the UI can explain WHY.
    score: { type: Number, default: 0 },
    reasons: { type: [String], default: [] },

    /**
     * pending  — waiting for a human
     * merged   — resolved by merging the pair
     * dismissed— a human said these are different people; never re-raise
     */
    status: { type: String, enum: ['pending', 'merged', 'dismissed'], default: 'pending', index: true },

    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One row per pair — re-detecting the same pair must not spawn duplicates of
// the duplicate record itself.
duplicateCandidateSchema.index({ task: 1, duplicateOf: 1 }, { unique: true });
// The queue query: this workspace's unresolved pairs, newest first.
duplicateCandidateSchema.index({ organisation: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('DuplicateCandidate', duplicateCandidateSchema);
