/**
 * columnFilter.js — client mirror of the canonical filter shape
 * `[{ columnId, op: 'eq'|'in'|'between', value }]` (see
 * server/src/utils/columnFilter.js and the TableView evaluator).
 *
 * Used by the Board view's column-aware filter bar so a flexible board filters
 * by its OWN columns (Lead Status, Assigned To, …) instead of the fixed legacy
 * task fields. Operates purely on a task's stored `columnValues`.
 */

const readVal = (task, colId) =>
  task && task.columnValues ? task.columnValues[colId?.toString()] : undefined;

const toStr = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v._id != null ? String(v._id) : null;
  return String(v);
};

const toArr = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(toStr).filter((s) => s != null);
  const s = toStr(v);
  return s == null ? [] : [s];
};

/** Evaluate one clause against a task. Mirrors TableView/clauseMatch. */
export const clauseMatch = (task, clause) => {
  if (!clause || !clause.columnId) return true;
  const v = readVal(task, clause.columnId);
  if (clause.op === 'in') {
    const list = Array.isArray(clause.value)
      ? clause.value
      : String(clause.value || '').split(',');
    const allowed = new Set(list.map((s) => String(s).trim()).filter(Boolean));
    if (allowed.size === 0) return true; // empty selection imposes no constraint
    // 'unassigned' (empty person/value) is a synthetic option.
    const vals = toArr(v);
    if (allowed.has('__empty__') && vals.length === 0) return true;
    return vals.some((x) => allowed.has(x));
  }
  if (clause.op === 'eq') {
    const want = toStr(clause.value);
    if (want == null) return true;
    return Array.isArray(v) ? toArr(v).includes(want) : toStr(v) === want;
  }
  return true;
};

/** AND across all clauses; an empty/absent filter matches everything. */
export const taskMatchesColumnFilter = (task, clauses) =>
  !Array.isArray(clauses) ||
  clauses.length === 0 ||
  clauses.every((c) => clauseMatch(task, c));

// Column types that make sense as discrete multi-select filter chips.
export const FILTERABLE_COLUMN_TYPES = ['status', 'dropdown', 'tags', 'person', 'checkbox'];

/** The board's columns that should appear as filter chips (in column order). */
export const filterableColumns = (board) => {
  const cols = Array.isArray(board?.columns) ? board.columns : [];
  return cols
    .filter((c) => !c.isPrimary && FILTERABLE_COLUMN_TYPES.includes(c.type))
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
};

/**
 * Selectable options for a column's filter popover.
 *   status/dropdown/tags → from the column's own options (with colors)
 *   person               → derived from the values present across `allTasks`
 *   checkbox             → Checked / Unchecked
 * `labels` lets the caller localise the synthetic checkbox / unassigned rows.
 */
export const optionsForColumn = (column, allTasks = [], labels = {}) => {
  if (!column) return [];
  if (column.type === 'checkbox') {
    return [
      { id: 'true', label: labels.checked || 'Checked' },
      { id: 'false', label: labels.unchecked || 'Unchecked' },
    ];
  }
  if (column.type === 'person') {
    const byId = new Map();
    for (const task of allTasks) {
      const raw = task?.columnValues?.[column._id?.toString()];
      const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
      for (const p of arr) {
        const id = p && p._id ? String(p._id) : toStr(p);
        if (!id) continue;
        const name = (p && p.name) || '';
        if (!byId.has(id) || (!byId.get(id).label && name)) {
          byId.set(id, { id, label: name || id, profilePic: p?.profilePic });
        }
      }
    }
    const people = Array.from(byId.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    return [{ id: '__empty__', label: labels.unassigned || 'Unassigned', italic: true }, ...people];
  }
  // status / dropdown / tags — from the column's configured options.
  const opts = Array.isArray(column.settings?.options) ? column.settings.options : [];
  return opts
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((o) => ({ id: String(o.id), label: o.label, color: o.color }));
};

/** The selected option-ids for a column, read out of the clause array. */
export const selectionForColumn = (clauses, columnId) => {
  const id = columnId?.toString();
  const clause = (clauses || []).find((c) => c.columnId === id);
  if (!clause) return [];
  return Array.isArray(clause.value) ? clause.value : [];
};

/** Return a new clause array with `columnId`'s selection set to `ids`. */
export const setColumnSelection = (clauses, columnId, ids) => {
  const id = columnId?.toString();
  const rest = (clauses || []).filter((c) => c.columnId !== id);
  if (!ids || ids.length === 0) return rest;
  return [...rest, { columnId: id, op: 'in', value: ids }];
};

/** How many columns currently constrain the view (non-empty selections). */
export const countColumnClauses = (clauses) =>
  (clauses || []).filter((c) => Array.isArray(c.value) && c.value.length > 0).length;

// ===========================================================================
// Advanced filter builder (Phase 1.5) — Monday-style Where/Condition/Value with
// AND/OR groups. The filter is a recursive TREE:
//   group     = { conjunction: 'and'|'or', rules: [ rule ... ] }
//   condition = { id, columnId, op, value }
// A rule is a condition or a nested group (distinguished by a `rules` array).
// ===========================================================================

const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const toEpoch = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && !(v instanceof Date)) return toEpoch(v.start || v.end);
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};
const toText = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => toStr(x) ?? '').join(' ');
  if (typeof v === 'object') return String(v.label ?? v.value ?? toStr(v) ?? '');
  return String(v);
};

// Operators offered per column type, in display order. Keys map to i18n labels
// `filter.op.<key>` and to the evaluator below.
export const OPERATORS_BY_TYPE = {
  status: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  dropdown: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  tags: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  person: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  text: ['contains', 'not_contains', 'is', 'is_not', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  long_text: ['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  email: ['contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  phone: ['contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  link: ['contains', 'is', 'is_empty', 'is_not_empty'],
  location: ['contains', 'is', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'is_empty', 'is_not_empty'],
  rating: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty'],
  date: ['on', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
  timeline: ['on', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
  checkbox: ['is_checked', 'is_unchecked'],
  formula: ['contains', 'is', 'is_empty', 'is_not_empty'],
  mirror: ['contains', 'is', 'is_empty', 'is_not_empty'],
};

/** Which value editor a given operator needs. */
export const OP_INPUT = {
  is_empty: 'none',
  is_not_empty: 'none',
  is_checked: 'none',
  is_unchecked: 'none',
  any_of: 'options',
  none_of: 'options',
  between: 'range',
  on: 'date',
  before: 'date',
  after: 'date',
  // everything else → single text/number input
};

/** Columns that can be filtered in the advanced builder (everything with ops). */
export const advancedFilterableColumns = (board) => {
  const cols = Array.isArray(board?.columns) ? board.columns : [];
  return cols
    .filter((c) => OPERATORS_BY_TYPE[c.type])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
};

const isEmptyVal = (v) =>
  v == null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) &&
    Object.keys(v).length === 0);

/** Evaluate one condition against a task, given the column's type. */
const evalCondition = (task, cond, columnsById) => {
  if (!cond || !cond.columnId || !cond.op) return true;
  const col = columnsById ? columnsById[cond.columnId] : null;
  const type = col?.type || 'text';
  const raw = readVal(task, cond.columnId);
  const op = cond.op;

  if (op === 'is_empty') return isEmptyVal(raw);
  if (op === 'is_not_empty') return !isEmptyVal(raw);
  if (op === 'is_checked') return raw === true || raw === 'true';
  if (op === 'is_unchecked') return !(raw === true || raw === 'true');

  // Option-set ops (status / dropdown / tags / person)
  if (op === 'any_of' || op === 'none_of') {
    const sel = Array.isArray(cond.value) ? cond.value.map(String) : [];
    if (sel.length === 0) return true;
    const vals = toArr(raw);
    const hit = sel.includes('__empty__') ? vals.length === 0 : false;
    const intersect = vals.some((x) => sel.includes(x));
    const matched = hit || intersect;
    return op === 'any_of' ? matched : !matched;
  }

  // Numeric ops
  if (['eq', 'neq', 'gt', 'lt', 'gte', 'lte'].includes(op)) {
    if (type === 'date' || type === 'timeline') {
      const a = toEpoch(raw);
      const b = toEpoch(cond.value);
      if (a == null || b == null) return false;
      return numCompare(op, a, b);
    }
    const a = toNum(raw);
    const b = toNum(cond.value);
    if (a == null || b == null) return false;
    return numCompare(op, a, b);
  }
  if (op === 'between') {
    const arr = Array.isArray(cond.value) ? cond.value : [];
    const lo = type === 'date' || type === 'timeline' ? toEpoch(arr[0]) : toNum(arr[0]);
    const hi = type === 'date' || type === 'timeline' ? toEpoch(arr[1]) : toNum(arr[1]);
    const a = type === 'date' || type === 'timeline' ? toEpoch(raw) : toNum(raw);
    if (a == null) return false;
    if (lo != null && a < lo) return false;
    if (hi != null && a > hi) return false;
    return lo != null || hi != null;
  }

  // Date single-bound ops
  if (op === 'on' || op === 'before' || op === 'after') {
    const a = toEpoch(raw);
    const b = toEpoch(cond.value);
    if (a == null || b == null) return false;
    if (op === 'before') return a < b;
    if (op === 'after') return a > b;
    // 'on' → same calendar day
    const da = new Date(a); const db = new Date(b);
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
  }

  // Text ops
  const hay = toText(raw).toLowerCase();
  const needle = toText(cond.value).toLowerCase();
  switch (op) {
    case 'contains': return needle === '' || hay.includes(needle);
    case 'not_contains': return needle === '' || !hay.includes(needle);
    case 'is': return hay === needle;
    case 'is_not': return hay !== needle;
    case 'starts_with': return hay.startsWith(needle);
    case 'ends_with': return hay.endsWith(needle);
    default: return true;
  }
};

const numCompare = (op, a, b) => {
  switch (op) {
    case 'eq': return a === b;
    case 'neq': return a !== b;
    case 'gt': return a > b;
    case 'lt': return a < b;
    case 'gte': return a >= b;
    case 'lte': return a <= b;
    default: return true;
  }
};

const isGroup = (node) => node && Array.isArray(node.rules);

/** Recursively evaluate the filter tree against a task. Empty tree → match. */
export const evaluateTree = (task, node, columnsById) => {
  if (!node) return true;
  if (isGroup(node)) {
    const rules = node.rules || [];
    if (rules.length === 0) return true;
    const results = rules.map((r) => evaluateTree(task, r, columnsById));
    return node.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
  }
  return evalCondition(task, node, columnsById);
};

/** Count the conditions (leaf rules) in a tree. */
export const countTreeConditions = (node) => {
  if (!node) return 0;
  if (isGroup(node)) return (node.rules || []).reduce((n, r) => n + countTreeConditions(r), 0);
  return node.columnId && node.op ? 1 : 0;
};

/** A fresh empty top-level group. */
export const emptyTree = () => ({ conjunction: 'and', rules: [] });

/** `columns` array → { [id]: column } for the evaluator. */
export const columnsById = (board) => {
  const map = {};
  for (const c of board?.columns || []) map[c._id?.toString()] = c;
  return map;
};
