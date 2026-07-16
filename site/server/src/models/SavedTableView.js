const mongoose = require('mongoose');

/**
 * SavedTableView — a saved, per-user table configuration for a board
 * (Phase 4, F13.1).
 *
 * Persists the generic table view's filter, group-by, multi-column sort, and
 * column-visibility choices so a user's table layout survives across sessions
 * (F13 AC4). The `filter` reuses the shared filter shape
 * `[{ columnId, op, value }]` (utils/columnFilter.js — the single source of
 * truth introduced by F12 and adopted here + by `ChartWidget.query.filter`).
 *
 * Column ids (`groupBy`, `sort[].columnId`, `visibleColumnIds`) are stored as
 * strings for representation parity with `columnValues` keys + the filter shape
 * (same choice CalendarView made for its column-id fields).
 *
 * Index: `{ userId: 1, boardId: 1 }` — load a user's views for a board.
 */
const sortClauseSchema = new mongoose.Schema(
  {
    columnId: { type: String, required: true },
    dir: { type: String, enum: ['asc', 'desc'], default: 'asc' },
  },
  { _id: false }
);

const savedTableViewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    // Shared filter shape: [{ columnId, op: 'eq'|'in'|'between', value }].
    filter: { type: mongoose.Schema.Types.Mixed, default: [] },
    groupBy: { type: String, default: null },
    sort: { type: [sortClauseSchema], default: [] },
    visibleColumnIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

savedTableViewSchema.index({ userId: 1, boardId: 1 });

module.exports = mongoose.model('SavedTableView', savedTableViewSchema);
