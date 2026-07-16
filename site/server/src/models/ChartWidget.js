const mongoose = require('mongoose');

/**
 * ChartWidget — a saved chart definition over board / workspace task data
 * (Phase 4, F13.1). **This is the shared chart primitive F15 dashboards reuse**
 * — both the per-board Insights tab and the F15 executive/team dashboards render
 * `ChartWidget` rows through the single `ChartWidgetRenderer` path, and both read
 * their series from `chartDataService.aggregate(widget, { from, to })`.
 *
 * A widget is scoped to ONE board (`boardId`) or to a whole workspace
 * (`workspaceId`, cross-board — used by F15). `query` describes the aggregation:
 *   - `columnId`          : the primary group / x-axis column (string id).
 *   - `aggregate`         : count (default) or sum/avg/min/max of…
 *   - `aggregateColumnId` : …this number column (for sum/avg/min/max).
 *   - `splitBy`           : optional secondary dimension (stacked_bar).
 *   - `timeBucket`        : day/week/month grouping for `line` over a date column.
 *   - `filter`            : shared filter shape `[{ columnId, op, value }]`.
 *
 * Indexes: `{ boardId: 1 }`, `{ workspaceId: 1 }`.
 */
const TYPES = ['bar', 'line', 'pie', 'funnel', 'number', 'stacked_bar'];
const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max'];
const TIME_BUCKETS = ['day', 'week', 'month'];
// Phase 2.4 — who can see a widget. 'everyone' = any workspace member;
// 'admins' = workspace admins only (lock sensitive widgets, e.g. revenue/ROI).
const VISIBILITIES = ['everyone', 'admins'];

const chartQuerySchema = new mongoose.Schema(
  {
    // Column ids stored as strings (parity with the filter shape / columnValues).
    columnId: { type: String, default: null },
    aggregate: { type: String, enum: AGGREGATES, default: 'count' },
    aggregateColumnId: { type: String, default: null },
    splitBy: { type: String, default: null },
    timeBucket: { type: String, enum: TIME_BUCKETS, default: 'month' },
    // Shared filter shape: [{ columnId, op: 'eq'|'in'|'between', value }].
    filter: { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  { _id: false }
);

const chartLayoutSchema = new mongoose.Schema(
  {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    w: { type: Number, default: 4 },
    h: { type: Number, default: 4 },
  },
  { _id: false }
);

const chartWidgetSchema = new mongoose.Schema(
  {
    // Exactly one of boardId / workspaceId is the scope. workspaceId is always
    // set (the owning workspace) so workspace-scoped F15 queries can find it.
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      default: null,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      default: null,
    },
    type: { type: String, enum: TYPES, required: true },
    title: { type: String, default: '', trim: true },
    query: { type: chartQuerySchema, default: () => ({}) },
    layout: { type: chartLayoutSchema, default: () => ({}) },
    // Phase 2.4 — visibility gate. Members only see 'everyone' widgets; admins
    // see all. Enforced server-side in the list + data endpoints.
    visibility: { type: String, enum: VISIBILITIES, default: 'everyone' },
  },
  { timestamps: true }
);

chartWidgetSchema.index({ boardId: 1 });
chartWidgetSchema.index({ workspaceId: 1 });

chartWidgetSchema.statics.TYPES = TYPES;
chartWidgetSchema.statics.AGGREGATES = AGGREGATES;
chartWidgetSchema.statics.TIME_BUCKETS = TIME_BUCKETS;
chartWidgetSchema.statics.VISIBILITIES = VISIBILITIES;

module.exports = mongoose.model('ChartWidget', chartWidgetSchema);
module.exports.TYPES = TYPES;
module.exports.AGGREGATES = AGGREGATES;
module.exports.TIME_BUCKETS = TIME_BUCKETS;
module.exports.VISIBILITIES = VISIBILITIES;
