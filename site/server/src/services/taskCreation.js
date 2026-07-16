/**
 * taskCreation.js — shared programmatic task creation (Phase 3, F7.3).
 *
 * The HTTP `taskController.createTask` handler validates request bodies and
 * speaks res/req; non-HTTP producers (the F7 inbound webhook resolver now, F13
 * form intake later) need the same "create a board task with column values"
 * primitive without the Express plumbing. This is that single shared path so the
 * two don't drift — it resolves the default status, picks a landing group,
 * validates each column value through the `columnTypes` registry, assigns the
 * next order, and persists the task.
 *
 * It deliberately does NOT emit events or send notifications — the caller owns
 * the domain semantics (the resolver emits `item.created` / `webhook.received` /
 * `lead.intake`; a form intake will emit `form.submitted`).
 */

const Board = require('../models/Board');
const Task = require('../models/Task');
const TaskGroup = require('../models/TaskGroup');
const { getColumnType } = require('../utils/columnTypes');

const asId = (v) => (v == null ? '' : v.toString());

/** Default-status id for a board (mirrors taskController.resolveDefaultStatus). */
const resolveDefaultStatus = (board) => {
  if (!board || !Array.isArray(board.statuses) || board.statuses.length === 0) {
    return 'not_started';
  }
  const fav = board.statuses.find((s) => s.isDefault);
  return (fav || board.statuses[0])._id;
};

/**
 * Validate + serialise a `{ [columnId]: rawValue }` patch against the board's
 * columns. Returns `{ columnValues: Map, name, warnings }`. Unknown columns and
 * values that fail their type's `validate` are collected into `warnings` and
 * skipped (the caller decides whether that's fatal — for inbound webhooks it is
 * not: a bad/missing field leaves the column unset, AC5).
 */
const buildColumnValues = (board, rawValues) => {
  const columnsById = new Map(
    (board && Array.isArray(board.columns) ? board.columns : []).map((c) => [asId(c._id), c])
  );
  const columnValues = new Map();
  const warnings = [];
  let name = null;

  for (const [cidRaw, rawValue] of Object.entries(rawValues || {})) {
    const cid = asId(cidRaw);
    const col = columnsById.get(cid);
    if (!col) {
      warnings.push({ columnId: cid, reason: 'unknown_column' });
      continue;
    }
    const entry = getColumnType(col.type);
    if (!entry) {
      warnings.push({ columnId: cid, reason: `unknown_type:${col.type}` });
      continue;
    }
    try {
      entry.validate(rawValue, col.settings || {});
    } catch (err) {
      warnings.push({ columnId: cid, reason: 'invalid_value', message: err.message });
      continue;
    }
    const serialized = entry.serialize ? entry.serialize(rawValue) : rawValue;
    columnValues.set(cid, serialized);
    // The primary column doubles as the row title — mirror it into `name`.
    if (col.isPrimary && (typeof rawValue === 'string' || typeof rawValue === 'number')) {
      const asName = String(rawValue).trim();
      if (asName) name = asName;
    }
  }

  return { columnValues, name, warnings };
};

/**
 * Create a board task with column values.
 *
 * @param {Object} args
 * @param {Object} args.board                - loaded Board doc (statuses+columns)
 * @param {string|ObjectId} [args.groupId]   - landing group; defaults to the
 *                                              board's first group by order
 * @param {Object} [args.columnValues]       - `{ [columnId]: rawValue }`
 * @param {string} [args.name]               - explicit title (overrides primary)
 * @param {string|ObjectId} [args.createdBy] - user id stamped as creator
 * @param {boolean} [args.createdByAutomation=false]
 * @returns {Promise<{ task, warnings }>}
 */
const createTaskWithColumnValues = async ({
  board,
  groupId,
  columnValues = {},
  name,
  createdBy,
  createdByAutomation = false,
}) => {
  if (!board || !board._id) throw new Error('createTaskWithColumnValues requires a board');

  // Resolve the landing group: explicit → first group on the board.
  let group = groupId || null;
  if (!group) {
    const first = await TaskGroup.findOne({ board: board._id }).sort({ order: 1, createdAt: 1 }).select('_id');
    group = first ? first._id : null;
  }
  if (!group) throw new Error('Board has no group to create the task in');

  const built = buildColumnValues(board, columnValues);
  const resolvedName = (name && String(name).trim()) || built.name || 'Untitled item';

  // Append to the end of the target group.
  const lastSibling = await Task.findOne({ group, parent: null })
    .sort({ order: -1 })
    .select('order')
    .lean();
  const order = (lastSibling?.order ?? -1) + 1;

  const task = await Task.create({
    name: resolvedName,
    board: board._id,
    group,
    priority: 'medium',
    status: resolveDefaultStatus(board),
    columnValues: built.columnValues,
    isPersonal: false,
    parent: null,
    order,
    createdBy: createdBy || board.createdBy,
    createdByAutomation,
  });

  await Board.updateOne({ _id: board._id }, { $set: { updatedAt: new Date() } });

  return { task, warnings: built.warnings };
};

module.exports = {
  createTaskWithColumnValues,
  buildColumnValues,
  resolveDefaultStatus,
};
