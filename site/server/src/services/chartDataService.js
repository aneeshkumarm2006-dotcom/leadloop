/**
 * chartDataService.js — aggregate board/workspace task data into chart series
 * for a `ChartWidget` (Phase 4, F13.3).
 *
 * `aggregate(widget, { from, to })` loads the in-scope tasks (one board, or every
 * board in a workspace), applies the widget's `query.filter` via the shared
 * `columnFilter.js` evaluator, then builds the series for the widget `type`:
 *
 *   - bar / pie     — group by `query.columnId` (status/dropdown/tags/person),
 *                     `count` (or sum/avg/min/max of `aggregateColumnId`).
 *   - funnel        — ordered stage counts over the status column's option order
 *                     (every stage emitted, 0-filled — AC3 New→…→Closed).
 *   - line          — bucket by `query.columnId` (a date column) per `timeBucket`.
 *   - number        — a single KPI (one aggregate, no group).
 *   - stacked_bar   — group by `columnId`, split each group by `splitBy`.
 *
 * Option ids resolve to labels/colours from the column settings so the renderer
 * needs no board metadata. This is the single aggregation path the per-board
 * Insights tab and (later) the F15 dashboards both read from.
 */

const Board = require('../models/Board');
const Task = require('../models/Task');
const { matchesFilter, getColumnValue } = require('../utils/columnFilter');

const DEFAULT_COLOR = '#6B7280';
const NONE_KEY = '__none__';
const NONE_LABEL = '(None)';

// Deterministic palette for keys with no configured colour (person ids, options
// missing a colour). Mirrors the calendar's per-person palette intent.
const PALETTE = [
  '#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED',
  '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#0D9488',
];

const asId = (v) => (v == null ? '' : v.toString());
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

const paletteColor = (key) => {
  const s = asId(key);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

const toNumber = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Find a board column subdoc by string id across the loaded boards. */
const buildColumnIndex = (boards) => {
  const index = new Map();
  for (const b of boards || []) {
    for (const c of (b && Array.isArray(b.columns) ? b.columns : [])) {
      index.set(asId(c._id), c);
    }
  }
  return index;
};

/** Sorted option list `[{ id, label, color }]` for a status/dropdown/tags column. */
const optionList = (column) => {
  const opts = column && column.settings && Array.isArray(column.settings.options)
    ? column.settings.options
    : [];
  return opts
    .map((o) => ({
      id: o && o.id != null ? asId(o.id) : null,
      label: (o && o.label) || (o && o.id != null ? asId(o.id) : ''),
      color: (o && o.color) || null,
      order: typeof (o && o.order) === 'number' ? o.order : 0,
    }))
    .filter((o) => o.id != null)
    .sort((a, b) => a.order - b.order);
};

/** Resolve a group key → `{ label, color }` from the column's options. */
const labelColor = (column, key) => {
  if (key === NONE_KEY) return { label: NONE_LABEL, color: DEFAULT_COLOR };
  const opt = optionList(column).find((o) => o.id === asId(key));
  if (opt) return { label: opt.label, color: opt.color || paletteColor(key) };
  // person id / unmapped value — id as label, deterministic colour.
  return { label: asId(key), color: paletteColor(key) };
};

/**
 * Group keys a task contributes to for `column`. Scalar (status/dropdown) → one
 * key; array (tags/person) → one per element; empty → the `(None)` bucket.
 */
const groupKeys = (value) => {
  if (isEmpty(value)) return [NONE_KEY];
  if (Array.isArray(value)) {
    const ks = value.map(asId).filter(Boolean);
    return ks.length ? ks : [NONE_KEY];
  }
  return [asId(value)];
};

/** Reduce an accumulated bucket `{ count, nums:[] }` to a single value. */
const reduceAgg = (aggregate, bucket) => {
  if (!bucket) return 0;
  switch (aggregate) {
    case 'sum':
      return bucket.nums.reduce((a, n) => a + n, 0);
    case 'avg':
      return bucket.nums.length ? bucket.nums.reduce((a, n) => a + n, 0) / bucket.nums.length : 0;
    case 'min':
      return bucket.nums.length ? Math.min(...bucket.nums) : 0;
    case 'max':
      return bucket.nums.length ? Math.max(...bucket.nums) : 0;
    case 'count':
    default:
      return bucket.count;
  }
};

const newBucket = () => ({ count: 0, nums: [] });

/** Add a task's contribution to a bucket: bump count + collect the agg number. */
const addToBucket = (bucket, task, aggregateColumnId) => {
  bucket.count += 1;
  if (aggregateColumnId) {
    const n = toNumber(getColumnValue(task.columnValues, aggregateColumnId));
    if (n != null) bucket.nums.push(n);
  }
};

/** Truncate a date value to the start of its day/week(Mon)/month in UTC → ISO. */
const bucketDate = (value, timeBucket) => {
  if (isEmpty(value)) return null;
  const raw = value && typeof value === 'object' && !(value instanceof Date)
    ? value.start || value.end
    : value;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (timeBucket === 'month') return new Date(Date.UTC(y, m, 1)).toISOString();
  if (timeBucket === 'week') {
    const base = new Date(Date.UTC(y, m, day));
    const offset = (base.getUTCDay() + 6) % 7; // Monday-start
    base.setUTCDate(base.getUTCDate() - offset);
    return base.toISOString();
  }
  // day
  return new Date(Date.UTC(y, m, day)).toISOString();
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bucketLabel = (iso, timeBucket) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mon = MONTHS[d.getUTCMonth()];
  if (timeBucket === 'month') return `${mon} ${d.getUTCFullYear()}`;
  if (timeBucket === 'week') return `Wk of ${mon} ${d.getUTCDate()}`;
  return `${mon} ${d.getUTCDate()}`;
};

const epochOrNull = (v) => {
  if (v == null || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};
const withinRange = (ms, from, to) => {
  if (ms == null) return false;
  if (from != null && ms < from) return false;
  if (to != null && ms > to) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Series builders (pure — take filtered tasks + the resolved query/columns).
// ---------------------------------------------------------------------------

/** bar / pie — group by columnId; order present keys by the column option order. */
const buildGrouped = (type, tasks, query, column) => {
  const { aggregate = 'count', aggregateColumnId, columnId } = query;
  const buckets = new Map();
  for (const t of tasks) {
    for (const key of groupKeys(getColumnValue(t.columnValues, columnId))) {
      if (!buckets.has(key)) buckets.set(key, newBucket());
      addToBucket(buckets.get(key), t, aggregateColumnId);
    }
  }
  // Order: option order first, then any extra keys (e.g. (None)) appended.
  const orderedIds = optionList(column).map((o) => o.id);
  const present = [...buckets.keys()];
  const ordered = [
    ...orderedIds.filter((id) => buckets.has(id)),
    ...present.filter((k) => !orderedIds.includes(k)),
  ];
  const series = ordered.map((key) => {
    const { label, color } = labelColor(column, key);
    return { key, label, color, value: reduceAgg(aggregate, buckets.get(key)) };
  });
  const total = series.reduce((a, s) => a + s.value, 0);
  return { type, aggregate, series, total };
};

/** funnel — every stage of the status column's option order, 0-filled (AC3). */
const buildFunnel = (tasks, query, column) => {
  const { aggregate = 'count', aggregateColumnId, columnId } = query;
  const buckets = new Map();
  for (const t of tasks) {
    for (const key of groupKeys(getColumnValue(t.columnValues, columnId))) {
      if (!buckets.has(key)) buckets.set(key, newBucket());
      addToBucket(buckets.get(key), t, aggregateColumnId);
    }
  }
  const series = optionList(column).map((o) => ({
    key: o.id,
    label: o.label,
    color: o.color || paletteColor(o.id),
    value: reduceAgg(aggregate, buckets.get(o.id)),
  }));
  const total = series.reduce((a, s) => a + s.value, 0);
  return { type: 'funnel', aggregate, series, total };
};

/** number — single KPI across all filtered tasks. */
const buildNumber = (tasks, query, title) => {
  const { aggregate = 'count', aggregateColumnId } = query;
  const bucket = newBucket();
  for (const t of tasks) addToBucket(bucket, t, aggregateColumnId);
  return { type: 'number', aggregate, value: reduceAgg(aggregate, bucket), label: title || '' };
};

/** line — bucket by a date column per timeBucket; window-filtered by [from,to]. */
const buildLine = (tasks, query, from, to) => {
  const { aggregate = 'count', aggregateColumnId, columnId, timeBucket = 'month' } = query;
  const buckets = new Map();
  for (const t of tasks) {
    const iso = bucketDate(getColumnValue(t.columnValues, columnId), timeBucket);
    if (!iso) continue;
    if ((from != null || to != null) && !withinRange(new Date(iso).getTime(), from, to)) continue;
    if (!buckets.has(iso)) buckets.set(iso, newBucket());
    addToBucket(buckets.get(iso), t, aggregateColumnId);
  }
  const series = [...buckets.keys()]
    .sort((a, b) => new Date(a) - new Date(b))
    .map((iso) => ({ key: iso, label: bucketLabel(iso, timeBucket), value: reduceAgg(aggregate, buckets.get(iso)) }));
  return { type: 'line', aggregate, timeBucket, series };
};

/** stacked_bar — group by columnId, split by splitBy. */
const buildStacked = (tasks, query, groupCol, splitCol) => {
  const { aggregate = 'count', aggregateColumnId, columnId, splitBy } = query;
  // rows[groupKey][stackKey] = bucket
  const rows = new Map();
  const stackKeys = new Set();
  for (const t of tasks) {
    const gKeys = groupKeys(getColumnValue(t.columnValues, columnId));
    const sKeys = groupKeys(splitBy ? getColumnValue(t.columnValues, splitBy) : undefined);
    for (const g of gKeys) {
      if (!rows.has(g)) rows.set(g, new Map());
      const stacks = rows.get(g);
      for (const s of sKeys) {
        stackKeys.add(s);
        if (!stacks.has(s)) stacks.set(s, newBucket());
        addToBucket(stacks.get(s), t, aggregateColumnId);
      }
    }
  }
  const orderGroup = optionList(groupCol).map((o) => o.id);
  const groupOrder = [
    ...orderGroup.filter((id) => rows.has(id)),
    ...[...rows.keys()].filter((k) => !orderGroup.includes(k)),
  ];
  const orderStack = optionList(splitCol).map((o) => o.id);
  const stackOrder = [
    ...orderStack.filter((id) => stackKeys.has(id)),
    ...[...stackKeys].filter((k) => !orderStack.includes(k)),
  ];
  const stacks = stackOrder.map((key) => {
    const { label, color } = labelColor(splitCol, key);
    return { key, label, color };
  });
  const groups = groupOrder.map((gKey) => {
    const { label } = labelColor(groupCol, gKey);
    const values = {};
    for (const sKey of stackOrder) {
      values[sKey] = reduceAgg(aggregate, rows.get(gKey).get(sKey));
    }
    return { key: gKey, label, values };
  });
  return { type: 'stacked_bar', aggregate, stacks, groups };
};

/**
 * Aggregate a widget into a renderer-ready series payload.
 *
 * @param {Object} widget                  - a ChartWidget doc (or POJO).
 * @param {Object} [opts]
 * @param {Date|string} [opts.from]        - window lower bound.
 * @param {Date|string} [opts.to]          - window upper bound.
 * @returns {Promise<Object>} type-specific series (see file header).
 */
const aggregate = async (widget, { from, to } = {}) => {
  if (!widget) throw new Error('aggregate requires a widget');
  const type = widget.type;
  const query = widget.query || {};

  // Resolve scope → boards (with columns) + their top-level tasks.
  let boards;
  if (widget.boardId) {
    const b = await Board.findById(widget.boardId).select('columns organisation').lean();
    boards = b ? [b] : [];
  } else if (widget.workspaceId) {
    boards = await Board.find({ organisation: widget.workspaceId }).select('columns organisation').lean();
  } else {
    boards = [];
  }
  const boardIds = boards.map((b) => b._id);
  const tasks = boardIds.length
    ? await Task.find({ board: { $in: boardIds }, parent: null })
        .select('name columnValues status createdAt board')
        .lean()
    : [];

  const colIndex = buildColumnIndex(boards);
  const groupCol = query.columnId ? colIndex.get(asId(query.columnId)) || null : null;
  const splitCol = query.splitBy ? colIndex.get(asId(query.splitBy)) || null : null;

  // Apply the shared filter, then (for non-line types) the optional createdAt
  // window. Line applies its window against the bucketed date column instead.
  const fromMs = epochOrNull(from);
  const toMs = epochOrNull(to);
  let scoped = tasks.filter((t) => matchesFilter(t, query.filter));
  if (type !== 'line' && (fromMs != null || toMs != null)) {
    scoped = scoped.filter((t) => withinRange(epochOrNull(t.createdAt), fromMs, toMs));
  }

  switch (type) {
    case 'bar':
    case 'pie':
      return buildGrouped(type, scoped, query, groupCol);
    case 'funnel':
      return buildFunnel(scoped, query, groupCol);
    case 'number':
      return buildNumber(scoped, query, widget.title);
    case 'line':
      return buildLine(scoped, query, fromMs, toMs);
    case 'stacked_bar':
      return buildStacked(scoped, query, groupCol, splitCol);
    default:
      throw new Error(`Unknown chart type: ${type}`);
  }
};

module.exports = {
  aggregate,
  // Exported for unit tests.
  _internals: {
    buildGrouped,
    buildFunnel,
    buildNumber,
    buildLine,
    buildStacked,
    bucketDate,
    reduceAgg,
    groupKeys,
    optionList,
    labelColor,
  },
};
