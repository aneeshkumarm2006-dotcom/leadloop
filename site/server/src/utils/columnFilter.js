/**
 * columnFilter.js — pure predicate evaluator for the shared filter shape
 * `[{ columnId, op: 'eq'|'in'|'between', value }]` (Phase 4, F12.1).
 *
 * This is the SINGLE SOURCE OF TRUTH for the filter shape adopted by:
 *   - F12 calendar views    (`CalendarView.filter`)
 *   - F13 saved table views (`SavedTableView.filter`)
 *   - F13 chart queries     (`ChartWidget.query.filter`)
 *
 * Design notes:
 *   - It operates PURELY on a task's stored `columnValues` (a Mongoose Map or a
 *     plain object from `.lean()`). It does NOT take board column metadata, so a
 *     clause referencing a DELETED column naturally resolves to "no match"
 *     (the value is absent → undefined → fails the op) rather than throwing.
 *     That keeps the "Column missing" banner (F12 AC4) a UI concern, not a 500.
 *   - All clauses combine with AND. An empty / non-array filter matches every
 *     task (no filtering).
 *   - Option-ids (status/dropdown/tags) compare as strings; person ids as
 *     strings; dates parse to epoch ms; numbers compare numerically.
 *
 * Ops:
 *   - eq      : scalar/option-id equality. If the task value is an array
 *               (tags/person), matches when the array CONTAINS the value.
 *   - in      : `value` is an array of allowed values. Matches when the task
 *               value (scalar) is one of them, or (array value) intersects.
 *   - between : `value` is `[lo, hi]` or `{ from, to }`. Date or numeric range,
 *               inclusive. Either bound may be null/'' for an open-ended range.
 */

const VALID_OPS = ['eq', 'in', 'between'];

/**
 * Read a column value off a task in a representation-agnostic way:
 *   - Mongoose `Map`         → `.get(columnId)`
 *   - plain object (`.lean`) → `obj[columnId]`
 * Returns `undefined` when the task has no value for the column (incl. the
 * deleted-column case).
 */
const getColumnValue = (columnValues, columnId) => {
  if (!columnValues || columnId == null) return undefined;
  const key = columnId.toString();
  if (typeof columnValues.get === 'function') {
    return columnValues.get(key);
  }
  if (typeof columnValues === 'object') {
    return columnValues[key];
  }
  return undefined;
};

/** Normalise any scalar id/option to a comparable string, or null. */
const toComparableString = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') {
    // ObjectId-like or a populated `{ _id }`.
    if (v._id != null) return v._id.toString();
    if (typeof v.toString === 'function') {
      const s = v.toString();
      return s === '[object Object]' ? null : s;
    }
    return null;
  }
  return v.toString();
};

/** Coerce a task value to a flat array of comparable strings. */
const toStringArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(toComparableString).filter((s) => s != null);
  const s = toComparableString(v);
  return s == null ? [] : [s];
};

/** Parse a value to epoch ms (Date | ISO string | timeline `{start}`), or null. */
const toEpoch = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    // A timeline value — anchor the range comparison on its start.
    if (v.start != null) return toEpoch(v.start);
    if (v.end != null) return toEpoch(v.end);
    return null;
  }
  const d = new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
};

/** Parse a value to a finite number, or null. */
const toNumber = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normalise a `between` bound spec into `{ lo, hi }` (raw, un-parsed). */
const betweenBounds = (value) => {
  if (Array.isArray(value)) return { lo: value[0], hi: value[1] };
  if (value && typeof value === 'object') {
    return {
      lo: value.from != null ? value.from : value.min != null ? value.min : value.start,
      hi: value.to != null ? value.to : value.max != null ? value.max : value.end,
    };
  }
  return { lo: undefined, hi: undefined };
};

const evalEq = (taskVal, target) => {
  const want = toComparableString(target);
  if (want == null) return false;
  if (Array.isArray(taskVal)) {
    return toStringArray(taskVal).includes(want);
  }
  const have = toComparableString(taskVal);
  return have != null && have === want;
};

const evalIn = (taskVal, target) => {
  const allowed = new Set(toStringArray(target));
  if (allowed.size === 0) return false;
  const have = toStringArray(taskVal);
  return have.some((h) => allowed.has(h));
};

const evalBetween = (taskVal, target) => {
  const { lo, hi } = betweenBounds(target);

  // Prefer a date interpretation when either bound or the value parses as a
  // date but not cleanly as a number; otherwise fall back to numeric.
  const asDate = () => {
    const v = toEpoch(taskVal);
    if (v == null) return false;
    const loV = toEpoch(lo);
    const hiV = toEpoch(hi);
    if (loV != null && v < loV) return false;
    if (hiV != null && v > hiV) return false;
    return loV != null || hiV != null;
  };
  const asNumber = () => {
    const v = toNumber(taskVal);
    if (v == null) return false;
    const loV = toNumber(lo);
    const hiV = toNumber(hi);
    if (loV != null && v < loV) return false;
    if (hiV != null && v > hiV) return false;
    return loV != null || hiV != null;
  };

  // If the value looks numeric (and bounds are numeric), compare numerically.
  if (toNumber(taskVal) != null && (toNumber(lo) != null || toNumber(hi) != null)) {
    return asNumber();
  }
  return asDate();
};

/**
 * Evaluate one clause against a task's columnValues. Returns false (no match)
 * for unknown ops or absent values — never throws.
 */
const evaluateClause = (columnValues, clause) => {
  if (!clause || typeof clause !== 'object') return true; // tolerate junk → no-op
  const { columnId, op, value } = clause;
  if (!columnId || !VALID_OPS.includes(op)) return true; // malformed clause → ignored
  const taskVal = getColumnValue(columnValues, columnId);

  switch (op) {
    case 'eq':
      return evalEq(taskVal, value);
    case 'in':
      return evalIn(taskVal, value);
    case 'between':
      return evalBetween(taskVal, value);
    default:
      return false;
  }
};

/**
 * Evaluate a full filter (array of clauses, AND-combined) against a task.
 * `task` may be a Mongoose doc or a `.lean()` POJO — only `task.columnValues`
 * is read. An empty / non-array filter matches everything.
 */
const matchesFilter = (task, filter) => {
  if (!Array.isArray(filter) || filter.length === 0) return true;
  const columnValues = task ? task.columnValues : undefined;
  for (const clause of filter) {
    if (!evaluateClause(columnValues, clause)) return false;
  }
  return true;
};

module.exports = {
  matchesFilter,
  evaluateClause,
  getColumnValue,
  VALID_OPS,
};
