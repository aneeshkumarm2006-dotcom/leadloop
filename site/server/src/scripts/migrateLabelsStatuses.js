/**
 * migrateLabelsStatuses.js
 *
 * One-time migration that backfills the per-board `statuses` (and empty
 * `labels`) arrays introduced in Phase 2 — Change 3, and rewrites every
 * existing Task's enum-string `status` to the matching ObjectId reference.
 *
 * Run from the server directory:
 *     node src/scripts/migrateLabelsStatuses.js
 *
 * Safe to re-run: boards that already have a non-empty `statuses` array
 * are skipped; tasks whose `status` is already an ObjectId are skipped.
 *
 * Default seed (mirrors the legacy enum + colors from
 * client/src/utils/priorityColors.js):
 *   key            name             color     isDefault
 *   not_started    Not Started      #6B7280   true
 *   working_on_it  Working on it    #D97706   false
 *   done           Done             #16A34A   false
 *   stuck          Stuck            #DC2626   false
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
require('../models'); // register all schemas

const Board = require('../models/Board');
const Task = require('../models/Task');

const DEFAULT_STATUSES = [
  { key: 'not_started',   name: 'Not Started',   color: '#6B7280', order: 0, isDefault: true  },
  { key: 'working_on_it', name: 'Working on it', color: '#D97706', order: 1, isDefault: false },
  { key: 'done',          name: 'Done',          color: '#16A34A', order: 2, isDefault: false },
  { key: 'stuck',         name: 'Stuck',         color: '#DC2626', order: 3, isDefault: false },
];

const run = async () => {
  await connectDB();
  console.log('— migrateLabelsStatuses started');

  const boards = await Board.find({});
  let boardsSeeded = 0;
  let boardsSkipped = 0;

  for (const board of boards) {
    if (Array.isArray(board.statuses) && board.statuses.length > 0) {
      boardsSkipped += 1;
      continue;
    }
    board.statuses = DEFAULT_STATUSES.map((s) => ({ ...s }));
    if (!Array.isArray(board.labels)) board.labels = [];
    await board.save();
    boardsSeeded += 1;
  }
  console.log(`  boards: ${boardsSeeded} seeded, ${boardsSkipped} already had statuses`);

  // Re-fetch with the freshly-saved statuses so we can map enum → ObjectId.
  const allBoards = await Board.find({}).lean();
  const statusIdByBoardAndKey = new Map();
  for (const b of allBoards) {
    const inner = new Map();
    for (const s of b.statuses || []) {
      if (s.key) inner.set(s.key, s._id);
    }
    statusIdByBoardAndKey.set(b._id.toString(), inner);
  }

  let tasksMigrated = 0;
  let tasksSkipped = 0;
  let tasksOrphaned = 0;

  const tasks = await Task.find({ isPersonal: { $ne: true } });
  for (const task of tasks) {
    // Already an ObjectId? Skip.
    if (task.status && mongoose.Types.ObjectId.isValid(task.status) && typeof task.status !== 'string') {
      tasksSkipped += 1;
      continue;
    }
    const statusStr = typeof task.status === 'string' ? task.status : 'not_started';
    const boardId = task.board ? task.board.toString() : null;
    const inner = boardId ? statusIdByBoardAndKey.get(boardId) : null;
    const mapped = inner ? inner.get(statusStr) || inner.get('not_started') : null;
    if (!mapped) {
      // Task references a board that no longer exists — leave the string in
      // place; the UI will fall back to the legacy STATUS_COLORS palette.
      tasksOrphaned += 1;
      continue;
    }
    task.status = mapped;
    if (!Array.isArray(task.labels)) task.labels = [];
    await task.save();
    tasksMigrated += 1;
  }
  console.log(
    `  tasks: ${tasksMigrated} migrated, ${tasksSkipped} already ObjectId, ${tasksOrphaned} orphaned (no board)`
  );

  console.log('— migrateLabelsStatuses done');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('migrateLabelsStatuses failed:', err);
  process.exit(1);
});
