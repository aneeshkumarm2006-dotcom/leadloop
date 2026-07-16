const mongoose = require('mongoose');

/**
 * BoardConnection — denormalised edge between a `connect_boards` column on one
 * board (`fromBoardId` / `fromColumnId`) and the board it points at
 * (`toBoardId`). Phase 1, F2.
 *
 * Why it exists: the mirror-refresh service (services/mirrorRefresh.js) needs a
 * cheap reverse lookup — "when a task on board X changes, which connect columns
 * on which boards reference X?" Scanning every board's `columns[]` per task
 * change would be O(boards). This collection answers it with one indexed query
 * on `toBoardId`.
 *
 * One row per connect-column edge: the unique index on
 * `{ fromBoardId, fromColumnId }` guarantees a single connection per column.
 * A `connect_boards` column may list several `targetBoardIds` in its settings,
 * but the registry edge records the PRIMARY (first) target board as
 * `toBoardId`. The lazy/TTL recompute in mirrorRefresh is the backstop that
 * keeps multi-target mirrors eventually-consistent even when an invalidation
 * keys off a non-primary target. See phase-1-TODO §F2.1.
 */
const boardConnectionSchema = new mongoose.Schema(
  {
    fromBoardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
    },
    toBoardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
    },
    // Id of the `connect_boards` column subdoc on the from-board.
    fromColumnId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Reverse lookup for mirror invalidation: given a changed task's board id,
// find every connect-column edge that targets it.
boardConnectionSchema.index({ toBoardId: 1 });

// One connection row per connect-column edge. Re-running the column upsert is
// idempotent against this constraint.
boardConnectionSchema.index({ fromBoardId: 1, fromColumnId: 1 }, { unique: true });

module.exports = mongoose.model('BoardConnection', boardConnectionSchema);
