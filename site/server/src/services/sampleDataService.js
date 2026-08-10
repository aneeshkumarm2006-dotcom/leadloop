/**
 * sampleDataService.js — "Show me how it works".
 *
 * An empty CRM teaches nothing: a new user opens a board, sees a blank table,
 * and has no idea what a working pipeline looks like. This seeds a handful of
 * realistic leads spread across the pipeline so the board explains itself, then
 * removes them all in one click.
 *
 * Two design rules:
 *   1. Sample rows are REAL tasks created through `createTaskWithColumnValues`,
 *      not a special render mode — so dragging, editing and automations behave
 *      exactly as they will with live data. They are only marked `isSample`.
 *   2. Field mapping is defensive. Boards differ by template (and users add
 *      their own columns), so each demo value is matched onto a column by key
 *      first, then by type — and silently skipped when the board has no home
 *      for it. Seeding must never fail because a column is missing.
 */

const Board = require('../models/Board');
const Task = require('../models/Task');
const TaskGroup = require('../models/TaskGroup');
const { createTaskWithColumnValues } = require('./taskCreation');

/**
 * The demo leads. Deliberately mundane and clearly fictional — real enough to
 * show a pipeline working, obvious enough that nobody mistakes them for data.
 * `stageIndex` spreads them across the pipeline so the board looks alive.
 */
const SAMPLE_LEADS = [
  { name: 'Dana Whitfield', email: 'dana.whitfield@example.com', phone: '+1 514 555 0142', budget: 740000, source: 'Website', notes: 'Pre-approved. Wants a second viewing this weekend.', stageIndex: 0 },
  { name: 'Priya Raman', email: 'priya.raman@example.com', phone: '+1 438 555 0119', budget: 2100, source: 'Zillow', notes: 'Looking for a 2-bedroom, move-in next month.', stageIndex: 1 },
  { name: 'Owen Clarke', email: 'owen.clarke@example.com', phone: '+1 514 555 0177', budget: 615000, source: 'Facebook', notes: 'Selling a condo, comparing agents.', stageIndex: 1 },
  { name: 'Marie-Claude Roy', email: 'mc.roy@example.com', phone: '+1 450 555 0163', budget: 890000, source: 'Referral', notes: 'Referred by a past client. Prefers French.', stageIndex: 2 },
  { name: 'Samuel Osei', email: 'samuel.osei@example.com', phone: '+1 613 555 0188', budget: 1850, source: 'Google Ads', notes: 'Relocating for work in six weeks.', stageIndex: 3 },
  { name: 'Elena Petrova', email: 'elena.petrova@example.com', phone: '+1 514 555 0155', budget: 1250000, source: 'Walk-in', notes: 'Cash buyer. Wants waterfront only.', stageIndex: 4 },
];

/** Key patterns we try before falling back to a column's type. */
const KEY_HINTS = {
  email: [/^email$/i, /e.?mail/i],
  phone: [/^phone$/i, /mobile|cell|tel/i],
  budget: [/budget|price|amount|value/i],
  source: [/source|channel|origin/i],
  notes: [/note|comment|detail|description/i],
};

const TYPE_FOR = { email: 'email', phone: 'phone', budget: 'number', source: 'text', notes: 'long_text' };

/**
 * Find the best column for a demo field: an explicit key match wins, then the
 * first unused column of the right type. Returns null when there's no home.
 */
const pickColumn = (columns, field, taken) => {
  const hints = KEY_HINTS[field] || [];
  const byKey = columns.find(
    (c) => !taken.has(String(c._id)) && hints.some((re) => re.test(c.key || '') || re.test(c.name || ''))
  );
  if (byKey) return byKey;
  const wantType = TYPE_FOR[field];
  // `source` is plain text, and matching the first text column would hijack the
  // primary name column — only accept a type match for the distinctive types.
  if (!wantType || wantType === 'text') return null;
  return columns.find((c) => !taken.has(String(c._id)) && c.type === wantType) || null;
};

/**
 * Seed sample leads onto a board.
 * @returns {Promise<{ created: number }>}
 */
const seedSampleLeads = async (boardId, userId) => {
  const board = await Board.findById(boardId).select(
    'statuses columns useFlexibleColumns organisation createdBy name'
  );
  if (!board) throw new Error('Board not found');

  const groups = await TaskGroup.find({ board: board._id }).sort({ order: 1, createdAt: 1 }).select('_id').lean();
  if (groups.length === 0) throw new Error('This board has no stages yet');

  const columns = (board.columns || []).filter((c) => !c.isPrimary);
  const createdIds = [];

  for (const lead of SAMPLE_LEADS) {
    const taken = new Set();
    const columnValues = {};
    for (const field of ['email', 'phone', 'budget', 'source', 'notes']) {
      const col = pickColumn(columns, field, taken);
      if (!col) continue;
      taken.add(String(col._id));
      columnValues[String(col._id)] = lead[field];
    }

    // Spread across whatever stages exist — a 3-stage board still looks sensible.
    const group = groups[Math.min(lead.stageIndex, groups.length - 1)];

    try {
      const { task } = await createTaskWithColumnValues({
        board,
        groupId: group._id,
        columnValues,
        name: lead.name,
        createdBy: userId || board.createdBy,
      });
      createdIds.push(task._id);
    } catch (err) {
      // One unmappable lead must not abort the whole demo.
      console.warn('sample lead skipped:', err.message);
    }
  }

  if (createdIds.length) {
    await Task.updateMany({ _id: { $in: createdIds } }, { $set: { isSample: true } });
  }
  return { created: createdIds.length };
};

/** Remove every sample lead across a workspace's boards. */
const removeSampleLeads = async (orgId) => {
  const boards = await Board.find({ organisation: orgId }).select('_id').lean();
  if (!boards.length) return { removed: 0 };
  const res = await Task.deleteMany({
    board: { $in: boards.map((b) => b._id) },
    isSample: true,
  });
  return { removed: res.deletedCount || 0 };
};

/** How many sample leads a workspace currently has (drives the banner). */
const countSampleLeads = async (orgId) => {
  const boards = await Board.find({ organisation: orgId }).select('_id').lean();
  if (!boards.length) return 0;
  return Task.countDocuments({ board: { $in: boards.map((b) => b._id) }, isSample: true });
};

module.exports = {
  SAMPLE_LEADS,
  pickColumn,
  seedSampleLeads,
  removeSampleLeads,
  countSampleLeads,
};
