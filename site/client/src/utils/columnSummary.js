/**
 * columnSummary.js — per-group column aggregations for the board summary footer
 * (Phase 1.6). Numeric columns get SUM/AVG/COUNT/MIN/MAX; status & dropdown
 * columns get a distribution ("battery") of their options.
 *
 * Operates on a task's stored `columnValues` (Mongoose Map or plain object).
 */

const readVal = (task, colId) => {
  const cv = task && task.columnValues;
  if (!cv) return undefined;
  const key = colId == null ? '' : colId.toString();
  return typeof cv.get === 'function' ? cv.get(key) : cv[key];
};

/** Aggregation modes a numeric column footer cycles through, in order. */
export const AGG_CYCLE = ['sum', 'avg', 'count', 'min', 'max'];

/** Summarise a numeric column across the group's tasks. */
export const summarizeNumber = (tasks, colId, agg = 'sum') => {
  const nums = [];
  for (const task of tasks || []) {
    const v = readVal(task, colId);
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (nums.length === 0) return { agg, value: null, count: 0 };
  let value;
  switch (agg) {
    case 'avg':
      value = nums.reduce((a, b) => a + b, 0) / nums.length;
      break;
    case 'count':
      value = nums.length;
      break;
    case 'min':
      value = Math.min(...nums);
      break;
    case 'max':
      value = Math.max(...nums);
      break;
    default:
      value = nums.reduce((a, b) => a + b, 0);
  }
  return { agg, value, count: nums.length };
};

/**
 * Distribution of a status / dropdown column's option values across the group.
 * Returns the non-empty segments (with colors) + totals for a battery bar.
 */
export const summarizeStatus = (tasks, column) => {
  const opts = Array.isArray(column?.settings?.options) ? column.settings.options : [];
  const byId = new Map(
    opts.map((o) => [
      String(o.id),
      { id: String(o.id), label: o.label, color: o.color, count: 0 },
    ])
  );
  let filled = 0;
  let blank = 0;
  for (const task of tasks || []) {
    const v = readVal(task, column._id);
    const id =
      v == null ? null : typeof v === 'object' ? (v.id != null ? v.id : v._id) : v;
    if (id == null || id === '') {
      blank += 1;
      continue;
    }
    const seg = byId.get(String(id));
    if (seg) {
      seg.count += 1;
      filled += 1;
    } else {
      blank += 1;
    }
  }
  const segments = Array.from(byId.values()).filter((s) => s.count > 0);
  return { segments, filled, blank, total: filled + blank };
};

/** Locale-format an aggregate value (whole numbers grouped; averages to 1 dp). */
export const formatAgg = (value, agg, lng) => {
  if (value == null) return '—';
  if (agg === 'avg') {
    return value.toLocaleString(lng || undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
  }
  return value.toLocaleString(lng || undefined);
};

/** Does any column on the board produce a summary worth rendering a footer for? */
export const hasSummarisableColumn = (columns) =>
  (columns || []).some(
    (c) => c.type === 'number' || c.type === 'status' || c.type === 'dropdown'
  );
