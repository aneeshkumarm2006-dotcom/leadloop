const mongoose = require('mongoose');

/**
 * CalendarView — a saved, per-user calendar configuration (Phase 4, F12.2).
 *
 * Replaces the single global calendar with saved views. Each view picks:
 *   - a SOURCE column (`date` or `timeline`) that supplies each event's
 *     start/end — or, when `boardId` is null ("global"), falls back to the
 *     legacy task `dueDate` across every board in the workspace;
 *   - an optional COLOR-BY column (`status`/`dropdown`/`tags`/`person`) that
 *     colours each event (status/dropdown/tags by option colour, person by a
 *     deterministic per-user palette);
 *   - an arbitrary FILTER using the shared filter shape
 *     `[{ columnId, op, value }]` (see utils/columnFilter.js — the single
 *     source of truth reused by F13 saved table views + chart queries);
 *   - a LAYOUT (month/week/day/agenda/resource). The `resource` layout groups
 *     events into one row per option/person of `resourceColumnId`.
 *
 * `isShared` promotes a view to the whole workspace (visible to every member,
 * editable by the owner or a workspace admin). `sortOrder` drives sidebar order.
 *
 * Indexes:
 *   - { userId, sortOrder }      — load a user's own views in display order.
 *   - { workspaceId, isShared }  — load the workspace's shared views.
 */
const LAYOUTS = ['month', 'week', 'day', 'agenda', 'resource'];

const calendarViewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
    },
    // Null = a "global" view spanning every board in the workspace (legacy
    // dueDate source). Non-null = a board-scoped, column-driven view.
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      default: null,
    },
    name: { type: String, required: true, trim: true },
    // ObjectId of a board column, stored as a string for representation parity
    // with how `columnValues` keys + the shared filter shape carry column ids.
    sourceColumnId: { type: String, default: null },
    colorByColumnId: { type: String, default: null },
    // Shared filter shape: [{ columnId, op: 'eq'|'in'|'between', value }].
    filter: { type: mongoose.Schema.Types.Mixed, default: [] },
    layout: {
      type: String,
      enum: LAYOUTS,
      default: 'month',
    },
    resourceColumnId: { type: String, default: null },
    isShared: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

calendarViewSchema.index({ userId: 1, sortOrder: 1 });
calendarViewSchema.index({ workspaceId: 1, isShared: 1 });

calendarViewSchema.statics.LAYOUTS = LAYOUTS;

module.exports = mongoose.model('CalendarView', calendarViewSchema);
module.exports.LAYOUTS = LAYOUTS;
