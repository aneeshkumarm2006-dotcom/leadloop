/**
 * conditionTree.js — server-side evaluator + sanitizer for automation
 * conditions expressed as an AND/OR tree of column comparisons (Phase 1b §1b.3).
 *
 * This is the SERVER mirror of the client advanced-filter tree
 * (`client/src/utils/columnFilter.js` → `evaluateTree` / `evalCondition`). The
 * two MUST stay in sync so a condition previews the same in the builder as it
 * fires at run time.
 *
 *   group     = { conjunction: 'and'|'or', rules: [ rule ... ] }
 *   condition = { columnId, op, value }
 * A rule is a condition or a nested group (distinguished by a `rules` array).
 *
 * The evaluator operates on a task's stored `columnValues` (Mongoose Map or a
 * `.lean()` object) plus the board's column metadata (for per-type op
 * semantics). A condition referencing a deleted column resolves to "no match"
 * rather than throwing.
 */

const { getColumnValue } = require('./columnFilter');

// ---- value coercion (mirrors the client helpers) --------------------------
const toComparableString = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v._id != null) return v._id.toString();
    if (typeof v.toString === 'function') {
      const s = v.toString();
      return s === '[object Object]' ? null : s;
    }
    return null;
  }
  return v.toString();
};

const toArr = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(toComparableString).filter((s) => s != null);
  const s = toComparableString(v);
  return s == null ? [] : [s];
};

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
  if (Array.isArray(v)) return v.map((x) => (toComparableString(x) ?? '')).join(' ');
  if (typeof v === 'object') return String(v.label ?? v.value ?? toComparableString(v) ?? '');
  return String(v);
};

const isEmptyVal = (v) =>
  v == null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && Object.keys(v).length === 0);

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

// Operators offered per column type (mirror of the client OPERATORS_BY_TYPE).
const OPERATORS_BY_TYPE = {
  status: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  dropdown: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  tags: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  person: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  checkbox: ['is_checked', 'is_unchecked'],
  text: ['contains', 'not_contains', 'is', 'is_not', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  long_text: ['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  email: ['contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  phone: ['contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  link: ['contains', 'is', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'is_empty', 'is_not_empty'],
  rating: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty'],
  date: ['on', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
  timeline: ['on', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
};

const columnTypeOf = (board, columnId) => {
  const cols = board && Array.isArray(board.columns) ? board.columns : [];
  const target = columnId == null ? '' : columnId.toString();
  const col = cols.find((c) => (c._id != null ? c._id.toString() : '') === target);
  return col ? col.type : null;
};

/** Evaluate a single leaf condition against a task. */
const evalCondition = (task, cond, board) => {
  if (!cond || !cond.columnId || !cond.op) return true;
  const type = columnTypeOf(board, cond.columnId) || 'text';
  const raw = getColumnValue(task && task.columnValues, cond.columnId);
  const op = cond.op;

  if (op === 'is_empty') return isEmptyVal(raw);
  if (op === 'is_not_empty') return !isEmptyVal(raw);
  if (op === 'is_checked') return raw === true || raw === 'true';
  if (op === 'is_unchecked') return !(raw === true || raw === 'true');

  if (op === 'any_of' || op === 'none_of') {
    const sel = Array.isArray(cond.value) ? cond.value.map(String) : [];
    if (sel.length === 0) return true;
    const vals = toArr(raw);
    const hit = sel.includes('__empty__') ? vals.length === 0 : false;
    const intersect = vals.some((x) => sel.includes(x));
    const matched = hit || intersect;
    return op === 'any_of' ? matched : !matched;
  }

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
    const dateLike = type === 'date' || type === 'timeline';
    const lo = dateLike ? toEpoch(arr[0]) : toNum(arr[0]);
    const hi = dateLike ? toEpoch(arr[1]) : toNum(arr[1]);
    const a = dateLike ? toEpoch(raw) : toNum(raw);
    if (a == null) return false;
    if (lo != null && a < lo) return false;
    if (hi != null && a > hi) return false;
    return lo != null || hi != null;
  }

  if (op === 'on' || op === 'before' || op === 'after') {
    const a = toEpoch(raw);
    const b = toEpoch(cond.value);
    if (a == null || b == null) return false;
    if (op === 'before') return a < b;
    if (op === 'after') return a > b;
    const da = new Date(a);
    const db = new Date(b);
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
  }

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

const isGroup = (node) => node && Array.isArray(node.rules);

/**
 * Recursively evaluate the condition tree against a task. An empty tree (or
 * empty group) matches — consistent with "no conditions = fire on everything".
 */
const evaluateConditionTree = (task, node, board) => {
  if (!node) return true;
  if (isGroup(node)) {
    const rules = node.rules || [];
    if (rules.length === 0) return true;
    const results = rules.map((r) => evaluateConditionTree(task, r, board));
    return node.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
  }
  return evalCondition(task, node, board);
};

/** Count the leaf conditions in a tree. */
const countTreeConditions = (node) => {
  if (!node) return 0;
  if (isGroup(node)) return (node.rules || []).reduce((n, r) => n + countTreeConditions(r), 0);
  return node.columnId && node.op ? 1 : 0;
};

/** True when the tree carries at least one usable leaf condition. */
const treeHasConditions = (node) => countTreeConditions(node) > 0;

// ---- sanitizer ------------------------------------------------------------
const MAX_DEPTH = 5;
const MAX_CONDITIONS = 50;

/**
 * Validate + normalise a condition tree against a board. Returns
 * `{ tree }` on success or `{ error }` on failure. Drops malformed/empty
 * leaves; rejects unknown columns, ops illegal for the column type, excessive
 * depth, or too many conditions.
 */
const sanitizeConditionTree = (rawTree, board) => {
  if (rawTree == null) return { tree: null };
  let count = 0;

  const walk = (node, depth) => {
    if (depth > MAX_DEPTH) throw new Error('Condition tree is nested too deeply');
    if (!node || typeof node !== 'object') return null;

    if (Array.isArray(node.rules)) {
      const conjunction = node.conjunction === 'or' ? 'or' : 'and';
      const rules = [];
      for (const r of node.rules) {
        const cleaned = walk(r, depth + 1);
        if (cleaned) rules.push(cleaned);
      }
      return { conjunction, rules };
    }

    // Leaf condition.
    const columnId = node.columnId == null ? '' : node.columnId.toString();
    const op = node.op;
    if (!columnId || !op) return null; // incomplete leaf → dropped
    const type = columnTypeOf(board, columnId);
    if (!type) throw new Error('Condition references a column not on this board');
    const allowed = OPERATORS_BY_TYPE[type];
    if (!allowed || !allowed.includes(op)) {
      throw new Error(`Operator "${op}" is not valid for a ${type} column`);
    }
    count += 1;
    if (count > MAX_CONDITIONS) throw new Error('Too many conditions');
    const leaf = { columnId, op };
    if (node.value !== undefined) leaf.value = node.value;
    return leaf;
  };

  try {
    const tree = walk(rawTree, 0);
    // Normalise to null when there are no real conditions.
    if (!tree || !treeHasConditions(tree)) return { tree: null };
    return { tree };
  } catch (err) {
    return { error: err.message };
  }
};

module.exports = {
  evaluateConditionTree,
  countTreeConditions,
  treeHasConditions,
  sanitizeConditionTree,
  OPERATORS_BY_TYPE,
  // exported for tests
  evalCondition,
};
