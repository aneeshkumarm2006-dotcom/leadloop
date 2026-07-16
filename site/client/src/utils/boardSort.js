/**
 * boardSort — type-aware comparator for sorting a board's tasks by a column.
 *
 * Used by BoardDetailPage's "Sort" toolbar control. Empty values always sort to
 * the bottom regardless of direction; everything else flips with `dir`.
 */

const readVal = (task, col) => {
  if (!task || !col) return null;
  if (col.isPrimary) return task.name || '';
  const cv = task.columnValues;
  if (!cv) return null;
  const id = col._id.toString();
  return typeof cv.get === 'function' ? cv.get(id) : cv[id];
};

const isEmpty = (v) =>
  v == null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

const toTime = (v) => {
  const raw = v && typeof v === 'object' ? v.start || v.date || v.value : v;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

/**
 * compareByColumn(a, b, col, dir) → number (Array.sort comparator).
 */
export const compareByColumn = (a, b, col, dir = 'asc') => {
  const mul = dir === 'desc' ? -1 : 1;
  const va = readVal(a, col);
  const vb = readVal(b, col);

  const ea = isEmpty(va);
  const eb = isEmpty(vb);
  if (ea && eb) return 0;
  if (ea) return 1; // empties always last
  if (eb) return -1;

  let res = 0;
  switch (col.type) {
    case 'number':
    case 'rating':
      res = (Number(va) || 0) - (Number(vb) || 0);
      break;
    case 'date':
    case 'timeline':
      res = toTime(va) - toTime(vb);
      break;
    case 'checkbox':
      res = (va === true ? 1 : 0) - (vb === true ? 1 : 0);
      break;
    case 'status':
    case 'dropdown': {
      const opts = col.settings?.options || [];
      const idx = (id) => {
        const i = opts.findIndex(
          (o) => o.id === id || (o._id && o._id.toString() === String(id))
        );
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      res = idx(va) - idx(vb);
      break;
    }
    default:
      res = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
  }
  return res * mul;
};

export default compareByColumn;
