/**
 * duplicateDetection.js — wiring the pure matcher (dedupeService) to real
 * board data.
 *
 * Responsibilities:
 *   1. pull a comparable { name, email, phone } out of a Task's columnValues,
 *      whatever the board's column layout happens to be;
 *   2. compare a newly-created lead against the board's existing leads;
 *   3. record a DuplicateCandidate for a human to confirm.
 *
 * Called from the lead-ingest path. It is deliberately FAIL-SAFE: detection
 * running into trouble must never stop a lead being captured. Losing a lead is
 * a lost commission; a missed duplicate flag is a minor annoyance.
 */

const Task = require('../models/Task');
const DuplicateCandidate = require('../models/DuplicateCandidate');
const { findBestMatch } = require('./dedupeService');

// How many recent leads on the board to compare against. Scanning an entire
// 50k-lead board on every ingest would be pathological; duplicates from ad and
// portal sources arrive within days of each other, so a recent window catches
// essentially all of them.
const SCAN_LIMIT = 400;

const KEY_HINTS = {
  email: [/^email$/i, /e.?mail/i],
  phone: [/^phone$/i, /mobile|cell|tel/i],
};
const TYPE_FOR = { email: 'email', phone: 'phone' };

/**
 * Resolve which board columns hold the email and phone, by key/name first and
 * column type second. Returns `{ email: columnId|null, phone: columnId|null }`.
 */
const resolveContactColumns = (board) => {
  const columns = (board?.columns || []).filter((c) => !c.isPrimary);
  const out = { email: null, phone: null };
  for (const field of ['email', 'phone']) {
    const hints = KEY_HINTS[field];
    const byKey = columns.find((c) => hints.some((re) => re.test(c.key || '') || re.test(c.name || '')));
    const col = byKey || columns.find((c) => c.type === TYPE_FOR[field]);
    out[field] = col ? String(col._id) : null;
  }
  return out;
};

/** Read a Map-or-object columnValues entry safely. */
const readValue = (columnValues, id) => {
  if (!columnValues || !id) return null;
  const v = typeof columnValues.get === 'function' ? columnValues.get(id) : columnValues[id];
  return v == null || v === '' ? null : String(v);
};

/** Flatten a Task into the shape dedupeService compares. */
const toComparable = (task, cols) => ({
  id: String(task._id),
  name: task.name || '',
  email: readValue(task.columnValues, cols.email),
  phone: readValue(task.columnValues, cols.phone),
  createdAt: task.createdAt,
});

/**
 * Look for an existing lead that matches `task` and, if found, record a pending
 * DuplicateCandidate.
 *
 * @returns {Promise<Object|null>} the candidate doc, or null when nothing matched
 */
const detectForTask = async (task, board) => {
  if (!task || !board) return null;
  const cols = resolveContactColumns(board);
  // Nothing to compare on → nothing to say. Never guess from names alone.
  if (!cols.email && !cols.phone) return null;

  const incoming = toComparable(task, cols);
  if (!incoming.email && !incoming.phone) return null;

  const existing = await Task.find({
    board: board._id,
    parent: null,
    isPersonal: { $ne: true },
    isSample: { $ne: true }, // demo rows must never create duplicate noise
    _id: { $ne: task._id },
  })
    .select('name columnValues createdAt')
    .sort({ createdAt: -1 })
    .limit(SCAN_LIMIT)
    .lean();

  const best = findBestMatch(incoming, existing.map((t) => toComparable(t, cols)));
  if (!best) return null;

  // A pair a human already dismissed must never come back.
  const pairFilter = {
    $or: [
      { task: task._id, duplicateOf: best.match.id },
      { task: best.match.id, duplicateOf: task._id },
    ],
  };
  const seen = await DuplicateCandidate.findOne(pairFilter).lean();
  if (seen) return null;

  return DuplicateCandidate.create({
    organisation: board.organisation,
    board: board._id,
    task: task._id,
    duplicateOf: best.match.id,
    score: best.score,
    reasons: best.reasons,
  });
};

/**
 * Fire-and-forget wrapper for the ingest path. Swallows every error on purpose:
 * a lead must be captured even if duplicate detection is broken.
 */
const detectSafely = async (task, board) => {
  try {
    return await detectForTask(task, board);
  } catch (err) {
    console.warn('duplicate detection skipped:', err.message);
    return null;
  }
};

module.exports = {
  SCAN_LIMIT,
  resolveContactColumns,
  toComparable,
  detectForTask,
  detectSafely,
};
