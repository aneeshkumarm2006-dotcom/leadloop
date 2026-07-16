/**
 * Task filtering helpers for the board filter bar.
 *
 * Filters operate on the standard task fields (name, status, priority,
 * labels, dueDate, assignedTo). Those fields stay populated even on
 * flexible-column boards because Task.js syncs `columnValues` back onto them,
 * so a single filter path covers both the legacy TaskTable and the DataGrid.
 *
 * Semantics: a task must satisfy EVERY active category (AND); within a single
 * category, matching ANY selected value is enough (OR). An empty category
 * imposes no constraint.
 */

import {
  taskMatchesColumnFilter,
  countColumnClauses,
  evaluateTree,
  countTreeConditions,
} from './columnFilter';

export const EMPTY_FILTERS = {
  search: '',
  statuses: [],   // status _id strings (or legacy enum keys)
  priorities: [], // 'critical' | 'high' | 'medium' | 'low'
  labels: [],     // label _id strings
  due: [],        // DUE_BUCKETS keys
  assignees: [],  // user _id strings, plus the synthetic 'unassigned'
  // Column-aware clauses for flexible boards (Quick filter): [{ columnId, op:'in', value:[] }].
  clauses: [],
  // Advanced filter builder tree (Phase 1.5): { conjunction, rules:[...] } | null.
  tree: null,
  // 'quick' | 'advanced' — which filter UI the board shows.
  mode: 'quick',
};

/**
 * Due-date buckets offered in the filter, in display order.
 */
export const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Due this week' },
  { key: 'month', label: 'Due this month' },
  { key: 'none', label: 'No due date' },
];

const MS_IN_DAY = 24 * 60 * 60 * 1000;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const matchesDueBucket = (dueInput, bucket, now) => {
  if (bucket === 'none') return !dueInput;
  if (!dueInput) return false;
  const due = new Date(dueInput);
  if (Number.isNaN(due.getTime())) return false;
  const dueDay = startOfDay(due).getTime();
  const today = startOfDay(now).getTime();
  switch (bucket) {
    case 'overdue':
      return dueDay < today;
    case 'today':
      return dueDay === today;
    case 'week':
      // From today through the next 7 days (inclusive), not past.
      return dueDay >= today && dueDay <= today + 7 * MS_IN_DAY;
    case 'month':
      // From today through the next 30 days (inclusive), not past.
      return dueDay >= today && dueDay <= today + 30 * MS_IN_DAY;
    default:
      return false;
  }
};

/**
 * Add `value` to `list` if absent, remove it if present. Returns a new array.
 * Convenience for toggling a checkbox option in a filter category.
 */
export const toggleValue = (list, value) => {
  const arr = Array.isArray(list) ? list : [];
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
};

/**
 * Count how many filter categories are currently constraining the view.
 * Used to badge the affordance and to toggle the "Clear all" button.
 */
export const countActiveFilters = (filters) => {
  if (!filters) return 0;
  let n = 0;
  if (filters.search && filters.search.trim()) n += 1;
  if (filters.statuses?.length) n += 1;
  if (filters.priorities?.length) n += 1;
  if (filters.labels?.length) n += 1;
  if (filters.due?.length) n += 1;
  if (filters.assignees?.length) n += 1;
  // Quick and Advanced are a toggle — only the active mode's filter counts.
  if (filters.mode === 'advanced') {
    if (filters.tree) n += countTreeConditions(filters.tree);
  } else {
    n += countColumnClauses(filters.clauses);
  }
  return n;
};

export const hasActiveFilters = (filters) => countActiveFilters(filters) > 0;

/**
 * Does a single task satisfy the active filters?
 * `now` defaults to the current time; injectable for deterministic tests.
 */
export const taskMatchesFilters = (task, filters, now = new Date(), colsById = null) => {
  if (!filters || !task) return true;

  // Name search
  const q = (filters.search || '').trim().toLowerCase();
  if (q && !(task.name || '').toLowerCase().includes(q)) return false;

  // Status — compare as strings to tolerate ObjectId vs legacy enum shapes
  if (filters.statuses?.length) {
    const s = task.status != null ? task.status.toString() : null;
    if (!s || !filters.statuses.includes(s)) return false;
  }

  // Priority
  if (filters.priorities?.length) {
    if (!task.priority || !filters.priorities.includes(task.priority)) return false;
  }

  // Labels — task matches if it carries ANY selected label
  if (filters.labels?.length) {
    const taskLabels = (task.labels || []).map((id) => id.toString());
    if (!filters.labels.some((id) => taskLabels.includes(id))) return false;
  }

  // Due date — match ANY selected bucket
  if (filters.due?.length) {
    if (!filters.due.some((b) => matchesDueBucket(task.dueDate, b, now))) return false;
  }

  // Assignees — match ANY selected member, plus the synthetic "unassigned"
  if (filters.assignees?.length) {
    const ids = (task.assignedTo || []).map((a) =>
      (a && a._id ? a._id : a).toString()
    );
    const wantsUnassigned = filters.assignees.includes('unassigned');
    const matchesUnassigned = wantsUnassigned && ids.length === 0;
    const matchesMember = filters.assignees.some(
      (id) => id !== 'unassigned' && ids.includes(id)
    );
    if (!matchesUnassigned && !matchesMember) return false;
  }

  // Quick vs Advanced are a toggle (filters.mode) — evaluate only the active one.
  if (filters.mode === 'advanced') {
    if (filters.tree && !evaluateTree(task, filters.tree, colsById)) return false;
  } else if (filters.clauses?.length && !taskMatchesColumnFilter(task, filters.clauses)) {
    return false;
  }

  return true;
};

export default taskMatchesFilters;
