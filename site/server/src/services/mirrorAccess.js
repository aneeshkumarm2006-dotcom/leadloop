/**
 * mirrorAccess.js — cross-workspace mirror visibility (Phase 1, F3).
 *
 * F2 computes a mirror's value by aggregating over the rows its sibling
 * `connect_boards` column points at. F3 makes those links legal across
 * workspaces (when a grant exists), which raises a visibility question: a user
 * who can see the SOURCE board but has no grant on a cross-workspace TARGET
 * board must not have that target's data leak through the mirror.
 *
 * The mirror value cache is workspace-agnostic (shared across users), so the
 * restriction is applied per-request at read time: if a mirror reads from any
 * linked target row in a DIFFERENT workspace and the requesting user lacks an
 * active grant to that target board, the value is replaced with "Restricted"
 * (phase-1-TODO §F3.7). Same-workspace mirrors are never restricted.
 */

const Board = require('../models/Board');
const { grantedBoardAccessForUser } = require('../middleware/roleCheck');
const { readLinks } = require('./mirrorRefresh');

const RESTRICTED = 'Restricted';

/**
 * Resolve `boardId -> workspaceId` for the given board ids, memoised in `cache`.
 * Boards that no longer exist are recorded as `null` so we never requery them.
 */
const loadBoardWorkspaces = async (boardIds, cache) => {
  const missing = boardIds.filter((id) => !cache.has(id));
  if (missing.length) {
    const boards = await Board.find({ _id: { $in: missing } }).select('organisation').lean();
    for (const b of boards) {
      cache.set(b._id.toString(), b.organisation ? b.organisation.toString() : null);
    }
    for (const id of missing) if (!cache.has(id)) cache.set(id, null);
  }
  return cache;
};

/**
 * Does this mirror read from a cross-workspace target the user can't reach?
 * `grantedAccess` is the user's `Map<boardId, role>` from grants; `wsCache`
 * memoises board→workspace lookups across calls.
 */
const mirrorIsRestricted = async (task, board, mirrorColumn, grantedAccess, wsCache) => {
  const settings = mirrorColumn.settings || {};
  const connectColId = settings.sourceConnectColumnId
    ? settings.sourceConnectColumnId.toString()
    : null;
  if (!connectColId) return false;

  const links = readLinks(task, connectColId);
  if (links.length === 0) return false;

  const sourceWs = board.organisation ? board.organisation.toString() : null;
  if (!sourceWs) return false;

  const targetBoardIds = [...new Set(links.map((l) => l.boardId).filter(Boolean))];
  await loadBoardWorkspaces(targetBoardIds, wsCache);

  for (const bid of targetBoardIds) {
    const ws = wsCache.get(bid);
    // Cross-workspace target with no active grant on the target board → hide.
    if (ws && ws !== sourceWs && !grantedAccess.has(bid)) return true;
  }
  return false;
};

/**
 * Mutate a list of `.lean()` tasks (whose mirror columns already hold bare
 * embedded values via `embedMirrorValues`) so any restricted mirror reads
 * "Restricted". No-op when the board has no mirror columns.
 */
const restrictEmbeddedMirrors = async (tasks, board, userId) => {
  const mirrorCols = (board && Array.isArray(board.columns) ? board.columns : []).filter(
    (c) => c.type === 'mirror'
  );
  if (mirrorCols.length === 0 || !Array.isArray(tasks) || tasks.length === 0) return tasks;

  const grantedAccess = await grantedBoardAccessForUser(userId);
  const wsCache = new Map();

  for (const task of tasks) {
    for (const mc of mirrorCols) {
      // eslint-disable-next-line no-await-in-loop
      const restricted = await mirrorIsRestricted(task, board, mc, grantedAccess, wsCache);
      if (restricted) {
        if (!task.columnValues || typeof task.columnValues !== 'object') task.columnValues = {};
        task.columnValues[mc._id.toString()] = RESTRICTED;
      }
    }
  }
  return tasks;
};

/**
 * Single-mirror variant for `GET /api/tasks/:id/mirror/:columnId`. Returns the
 * computed `value`, or "Restricted" when the user can't see a cross-workspace
 * source.
 */
const restrictSingleMirror = async (task, board, mirrorColumn, userId, value) => {
  const grantedAccess = await grantedBoardAccessForUser(userId);
  const wsCache = new Map();
  const restricted = await mirrorIsRestricted(task, board, mirrorColumn, grantedAccess, wsCache);
  return restricted ? RESTRICTED : value;
};

module.exports = {
  RESTRICTED,
  restrictEmbeddedMirrors,
  restrictSingleMirror,
  mirrorIsRestricted,
};
