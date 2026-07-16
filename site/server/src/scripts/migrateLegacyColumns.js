/**
 * migrateLegacyColumns.js
 *
 * Phase 1 / F1 migration. For every board (optionally scoped to a single
 * workspace via `--workspace <id>`):
 *   1. Synthesize `Stage` (status) from Board.statuses[].
 *   2. Synthesize `Tags` (tags) from Board.labels[].
 *   3. Add fixed columns: Priority (dropdown), Assignees (person), Due Date
 *      (date), Note (long_text), Lead Name (text, primary).
 *   4. Backfill task.columnValues from the corresponding legacy fields.
 *   5. Flip board.useFlexibleColumns = true.
 *
 * Idempotent — boards with `useFlexibleColumns: true` (or already-populated
 * columns) are skipped. Per-workspace scoping lets the rollout proceed one
 * organisation at a time (Risks §Migration ordering).
 *
 * Run from the server directory:
 *     node src/scripts/migrateLegacyColumns.js [--workspace <orgId>] [--dry-run]
 *
 * Pattern reference: migrateLabelsStatuses.js (same connect → for-each →
 * log → idempotent shape).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
require('../models'); // register all schemas

const Board = require('../models/Board');
const Task = require('../models/Task');

// Parse CLI flags. Keep it minimal — `--workspace` and `--dry-run` only.
const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { workspace: null, dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--workspace' || a === '-w') {
      out.workspace = args[i + 1] || null;
      i += 1;
    } else if (a === '--dry-run' || a === '-n') {
      out.dryRun = true;
    }
  }
  return out;
};

const COLOR = {
  gray: '#6B7280',
  red: '#DC2626',
  orange: '#D97706',
  yellow: '#CA8A04',
};

const PRIORITY_OPTIONS = [
  { id: 'critical', label: 'Critical', color: COLOR.red, order: 0 },
  { id: 'high', label: 'High', color: COLOR.orange, order: 1 },
  { id: 'medium', label: 'Medium', color: COLOR.yellow, order: 2, isDefault: true },
  { id: 'low', label: 'Low', color: COLOR.gray, order: 3 },
];

/**
 * Build the canonical `columns` array for an existing board. Order:
 *   Lead Name (text, primary) → Stage (status) → Priority (dropdown)
 *   → Assignees (person) → Due Date (date) → Tags (tags) → Note (long_text)
 *
 * The stage / tags option lists carry the ORIGINAL legacy ObjectId as `id`
 * so backfill can map `task.status` and `task.labels` straight onto option
 * ids without a lookup table.
 */
const synthesizeColumns = (board) => {
  const stageOptions = (board.statuses || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((s, i) => ({
      id: s._id.toString(),
      label: s.name || `Status ${i + 1}`,
      color: s.color || COLOR.gray,
      order: i,
      isDefault: !!s.isDefault,
      legacyKey: s.key || null,
    }));

  const tagOptions = (board.labels || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((l, i) => ({
      id: l._id.toString(),
      label: l.name || `Tag ${i + 1}`,
      color: l.color || COLOR.gray,
      order: i,
    }));

  return [
    {
      key: 'lead_name',
      name: 'Name',
      type: 'text',
      settings: {},
      order: 0,
      width: 240,
      isPrimary: true,
    },
    {
      key: 'status',
      name: 'Stage',
      type: 'status',
      settings: { options: stageOptions },
      order: 1,
      width: 160,
      isPrimary: false,
    },
    {
      key: 'priority',
      name: 'Priority',
      type: 'dropdown',
      settings: { options: PRIORITY_OPTIONS },
      order: 2,
      width: 140,
      isPrimary: false,
    },
    {
      key: 'assignees',
      name: 'Assignees',
      type: 'person',
      settings: {},
      order: 3,
      width: 160,
      isPrimary: false,
    },
    {
      key: 'due_date',
      name: 'Due Date',
      type: 'date',
      settings: {},
      order: 4,
      width: 140,
      isPrimary: false,
    },
    {
      key: 'tags',
      name: 'Tags',
      type: 'tags',
      settings: { options: tagOptions },
      order: 5,
      width: 200,
      isPrimary: false,
    },
    {
      key: 'note',
      name: 'Note',
      type: 'long_text',
      settings: {},
      order: 6,
      width: 240,
      isPrimary: false,
    },
  ];
};

/**
 * Index a board's freshly-synthesized columns by `key` → `_id`. Used by
 * the task backfill so we can write `columnValues[<colId>]` without
 * scanning the columns array per task.
 */
const indexColumnsByKey = (board) => {
  const map = new Map();
  for (const col of board.columns || []) {
    map.set(col.key, col._id.toString());
  }
  return map;
};

const run = async () => {
  const args = parseArgs();
  await connectDB();
  console.log('— migrateLegacyColumns started', args);

  const boardFilter = {};
  if (args.workspace) {
    if (!mongoose.Types.ObjectId.isValid(args.workspace)) {
      console.error(`--workspace ${args.workspace} is not a valid ObjectId`);
      process.exit(1);
    }
    boardFilter.organisation = args.workspace;
  }

  const boards = await Board.find(boardFilter);
  let boardsMigrated = 0;
  let boardsSkipped = 0;
  let tasksBackfilled = 0;
  let tasksSkipped = 0;

  for (const board of boards) {
    if (board.useFlexibleColumns && Array.isArray(board.columns) && board.columns.length > 0) {
      boardsSkipped += 1;
      continue;
    }

    const columns = synthesizeColumns(board);

    if (args.dryRun) {
      console.log(
        `  [dry-run] board ${board._id} (${board.name}): would seed ${columns.length} columns`
      );
      boardsMigrated += 1;
      continue;
    }

    board.columns = columns;
    board.useFlexibleColumns = true;
    await board.save();
    boardsMigrated += 1;

    // Backfill tasks on this board. Personal tasks (no board) are excluded
    // by the filter, but we double-check inside the loop for safety.
    const colIds = indexColumnsByKey(board);
    const tasks = await Task.find({ board: board._id });
    for (const task of tasks) {
      if (task.isPersonal || !task.board) {
        tasksSkipped += 1;
        continue;
      }
      // Idempotency: if columnValues already has any of the F1 keys mapped,
      // skip this task to avoid clobbering a re-run.
      const alreadyMigrated = colIds.size > 0 && [...colIds.values()].some((cid) =>
        task.columnValues && task.columnValues.has && task.columnValues.has(cid)
      );
      if (alreadyMigrated) {
        tasksSkipped += 1;
        continue;
      }

      const writeValue = (key, value) => {
        const cid = colIds.get(key);
        if (!cid) return;
        task.columnValues.set(cid, value);
      };

      // Lead name → primary text column.
      writeValue('lead_name', task.name || '');

      // Status: task.status is either an ObjectId (post migrateLabelsStatuses)
      // or a legacy enum string. The synthesized options' `id` field carries
      // the original status ObjectId, so a stringified task.status maps
      // directly. For legacy strings (orphan tasks), fall back to matching
      // by `legacyKey` on the options.
      if (task.status != null) {
        const statusStr = task.status.toString();
        const opts = (columns.find((c) => c.key === 'status')?.settings?.options) || [];
        const direct = opts.find((o) => o.id === statusStr);
        const byLegacyKey = direct || opts.find((o) => o.legacyKey === statusStr);
        if (byLegacyKey) writeValue('status', byLegacyKey.id);
      }

      writeValue('priority', task.priority || 'medium');
      writeValue('assignees', (task.assignedTo || []).map((u) => u.toString()));
      writeValue('due_date', task.dueDate ? new Date(task.dueDate).toISOString() : null);
      writeValue('tags', (task.labels || []).map((l) => l.toString()));
      writeValue('note', task.note || '');

      await task.save();
      tasksBackfilled += 1;
    }
    console.log(
      `  board ${board._id} (${board.name}): seeded ${columns.length} columns, ${tasks.length} tasks visited`
    );
  }

  console.log(
    `— migrateLegacyColumns done — boards: ${boardsMigrated} migrated, ${boardsSkipped} skipped; tasks: ${tasksBackfilled} backfilled, ${tasksSkipped} skipped`
  );
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('migrateLegacyColumns failed:', err);
  process.exit(1);
});
