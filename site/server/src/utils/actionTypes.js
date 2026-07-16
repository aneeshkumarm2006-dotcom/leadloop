/**
 * actionTypes.js — registry of automation action types (Phase 2, F5.1).
 *
 * Mirrors `columnTypes.js`: a single object keyed by action `type`, each entry
 * exposing a self-contained contract so the controller, dispatcher, date runner
 * and the action-catalog endpoint all speak through one surface.
 *
 * Each entry exposes:
 *   - requires      : 'F7'|'F8'|'F9'|'F10'|'F11'|'CALENDAR'|null — the phase that
 *                     must ship before the action can actually execute.
 *   - disabled      : derived — true while `requires` names an un-shipped phase.
 *                     Disabled actions still `validate`/`describe` (so they can be
 *                     saved on an automation / recipe), but their `execute` writes
 *                     a `skipped` outcome with reason "Available after Phase 3".
 *   - configSchema  : { fields: [...] } — drives the dynamic action form on the FE.
 *   - validate(config, ctx)  : throws ValidationError on invalid; returns the
 *                              normalised config on success. ctx = { board, groups,
 *                              memberIds }.
 *   - describe(config, ctx)  : short human label for list/summary UI.
 *   - execute(context)       : performs the side effect. Returns
 *                              { status:'ok'|'failed'|'skipped', error?, payloadSummary?, task? }.
 *                              May throw — the action runner catches and records a
 *                              `failed` outcome with the message (F5.8 AC4).
 *                              context = { task, board, automation, action, config,
 *                              prior, actorId, originAutomationId, cascadeDepth }.
 *
 * Side-effecting actions (CREATE_TASK / SET_COLUMN_VALUE / …) require the Mongoose
 * models + leaf services directly; none of those require this module back, so the
 * registry stays cycle-free w.r.t. the controller/dispatcher that import it.
 */

const mongoose = require('mongoose');
const Task = require('../models/Task');
const Board = require('../models/Board');
const User = require('../models/User');
const eventBus = require('../services/eventBus');
const { getColumnType, ValidationError } = require('./columnTypes');
const {
  createNotificationsForUsers,
} = require('../services/notificationService');
const {
  sendTaskAssignmentEmail,
  sendAutomationDigestEmail,
} = require('../services/emailService');
const { interpolate } = require('./templateInterpolate');

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

// Cross-phase markers whose features have shipped. Empty in Phase 2 — every
// channel-backed action below is a contract until F7/F8/F9/F10/F11 land, at
// which point their marker is added here and the action auto-enables.
const SHIPPED_PHASES = new Set(['F7', 'F8', 'F9', 'F10', 'F11']);
const DISABLED_REASON = 'Available after Phase 3';

const asId = (v) => (v == null ? '' : v.toString());
const isObjectId = (v) => v != null && mongoose.Types.ObjectId.isValid(asId(v));

const findColumn = (board, columnId) => {
  if (!board || !Array.isArray(board.columns)) return null;
  const target = asId(columnId);
  if (!target) return null;
  return board.columns.find((c) => asId(c._id) === target) || null;
};

const optionLabel = (col, id) => {
  const opts = col?.settings?.options;
  if (!Array.isArray(opts)) return asId(id);
  const match = opts.find((o) => o && asId(o.id) === asId(id));
  return match ? match.label || asId(id) : asId(id);
};

/**
 * Resolve the board's default status id (mirrors the controller helper). Used by
 * CREATE_TASK / CREATE_SUBITEM when no explicit status override is configured.
 */
const resolveDefaultStatusId = (board) => {
  if (!board || !Array.isArray(board.statuses) || board.statuses.length === 0) {
    return 'not_started';
  }
  const def =
    board.statuses.find((s) => s.isDefault) ||
    board.statuses.find((s) => s.key === 'not_started') ||
    board.statuses[0];
  return def ? def._id : 'not_started';
};

/**
 * Net-added user ids for a person-column change (ids in `toValue` not in
 * `fromValue`). Mirrors taskController.diffAddedUserIds so SET_COLUMN_VALUE
 * writes to a person column emit the same `task.person_assigned` shape.
 */
const diffAddedUserIds = (fromValue, toValue) => {
  const fromIds = new Set((Array.isArray(fromValue) ? fromValue : []).map(asId));
  const seen = new Set();
  const added = [];
  for (const v of Array.isArray(toValue) ? toValue : []) {
    const id = asId(v);
    if (!id || fromIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    added.push(id);
  }
  return added;
};

/**
 * Send assignee notifications + emails after an automation-created task is
 * saved (mirrors the controller's `notifyAssignees`). Exported so the
 * controller's legacy SCHEDULE / GROUP_CREATED spawn paths share one copy.
 */
const notifyAssignees = async (task, boardId, assigneeIds, orgId) => {
  if (!assigneeIds.length) return;
  await createNotificationsForUsers({
    userIds: assigneeIds,
    type: 'assigned',
    message: `You were assigned to "${task.name}"`,
    taskId: task._id,
    orgId,
  });

  const taskLink = `${process.env.CLIENT_URL}/boards/${boardId}`;
  const assigneeUsers = await User.find({ _id: { $in: assigneeIds } })
    .select('email')
    .lean();
  const emailResults = await Promise.allSettled(
    assigneeUsers
      .filter((u) => u.email)
      .map((u) =>
        sendTaskAssignmentEmail({
          to: u.email,
          taskName: task.name,
          priority: task.priority,
          dueDate: task.dueDate,
          taskLink,
        })
      )
  );
  emailResults.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `[automation/email] Failed to send to ${assigneeUsers[i]?.email}:`,
        result.reason?.message || result.reason
      );
    }
  });
};

/**
 * Emit the F1 column events for a single SET_COLUMN_VALUE write, tagged with the
 * loop-guard fields so the dispatcher can (a) suppress same-automation re-entry
 * and (b) cap cross-automation cascade depth. Mirrors
 * taskController.emitColumnChangeEvents but adds `_originAutomationId` and
 * `_cascadeDepth` to every payload.
 */
const emitColumnWriteEvents = (task, boardId, col, fromValue, toValue, meta) => {
  const base = {
    taskId: task._id,
    boardId,
    columnId: col._id,
    fromValue,
    toValue,
    actorId: meta.actorId || null,
    _originAutomationId: meta.originAutomationId || null,
    _cascadeDepth: (Number(meta.cascadeDepth) || 0) + 1,
  };
  eventBus.emit('task.column_changed', base);
  if (col.type === 'status') {
    eventBus.emit('task.status_became', base);
  }
  if (col.type === 'person') {
    const addedUserIds = diffAddedUserIds(fromValue, toValue);
    if (addedUserIds.length > 0) {
      eventBus.emit('task.person_assigned', {
        taskId: task._id,
        boardId,
        columnId: col._id,
        addedUserIds,
        actorId: meta.actorId || null,
        _originAutomationId: meta.originAutomationId || null,
        _cascadeDepth: (Number(meta.cascadeDepth) || 0) + 1,
      });
    }
  }
};

/**
 * Spawn one task from a CREATE_TASK / CREATE_SUBITEM action config. Ported from
 * the controller's `runActionOnce` so the registry owns task creation; always
 * tagged `createdByAutomation: true` so the ITEM_CREATED dispatcher won't
 * recurse on it.
 */
const spawnTask = async (action, automation, board, triggeringTask) => {
  const cfg = action.config || {};
  const assigneeIds = (cfg.assignedTo || []).map(asId);

  let group;
  let parent = null;
  if (action.type === 'CREATE_SUBITEM') {
    if (!triggeringTask) return null;
    group = triggeringTask.group;
    parent = triggeringTask._id;
  } else {
    group = cfg.group;
  }
  if (!group) return null;

  let status = resolveDefaultStatusId(board);
  if (cfg.status) {
    const match = (board?.statuses || []).find((s) => asId(s._id) === asId(cfg.status));
    if (match) status = match._id;
  }

  const due =
    Number.isFinite(cfg.dueInDays) && cfg.dueInDays !== null
      ? new Date(Date.now() + cfg.dueInDays * DAY_MS)
      : undefined;

  const task = await Task.create({
    name: cfg.name,
    board: automation.board,
    group,
    parent,
    priority: cfg.priority || 'medium',
    status,
    assignedTo: assigneeIds,
    dueDate: due,
    note: cfg.note || undefined,
    isPersonal: false,
    createdBy: automation.createdBy,
    createdByAutomation: true,
  });

  await Board.updateOne(
    { _id: automation.board },
    { $set: { updatedAt: new Date() } }
  );
  await notifyAssignees(task, automation.board, assigneeIds, automation.organisation);
  return task;
};

// ---------------------------------------------------------------------------
// Shared config validators
// ---------------------------------------------------------------------------
const requireNonEmptyString = (value, field) => {
  if (value == null || !String(value).trim()) {
    throw ValidationError(`${field} is required`);
  }
  return String(value).trim();
};

const normalisePriority = (value) => {
  if (value == null || value === '') return 'medium';
  if (!VALID_PRIORITIES.includes(value)) {
    throw ValidationError('priority must be critical, high, medium or low');
  }
  return value;
};

const normaliseAssignees = (value, ctx) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw ValidationError('assignedTo must be an array of user ids');
  const memberIds = ctx && ctx.memberIds instanceof Set ? ctx.memberIds : null;
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (!raw) continue;
    const id = asId(raw);
    if (!isObjectId(id)) throw ValidationError('assignedTo contains an invalid user id');
    if (memberIds && !memberIds.has(id)) {
      throw ValidationError('assignedTo contains a non-member');
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const normaliseTaskConfig = (config, ctx, { requireGroup }) => {
  const cfg = config || {};
  const out = { name: requireNonEmptyString(cfg.name, 'Task name') };

  if (requireGroup) {
    if (!isObjectId(cfg.group)) throw ValidationError('CREATE_TASK requires a group');
    const groups = ctx && Array.isArray(ctx.groups) ? ctx.groups : null;
    if (groups && !groups.some((g) => asId(g._id) === asId(cfg.group))) {
      throw ValidationError('Action group does not belong to board');
    }
    out.group = asId(cfg.group);
  }

  out.priority = normalisePriority(cfg.priority);
  out.assignedTo = normaliseAssignees(cfg.assignedTo, ctx);

  if (cfg.status != null && cfg.status !== '') {
    if (!isObjectId(cfg.status)) throw ValidationError('Invalid action status');
    const statuses = ctx && ctx.board && Array.isArray(ctx.board.statuses) ? ctx.board.statuses : null;
    if (statuses && !statuses.some((s) => asId(s._id) === asId(cfg.status))) {
      throw ValidationError('Action status does not belong to board');
    }
    out.status = asId(cfg.status);
  }
  if (cfg.note) out.note = String(cfg.note);
  if (cfg.dueInDays != null && cfg.dueInDays !== '') {
    const n = Number(cfg.dueInDays);
    if (!Number.isFinite(n) || n < 0) throw ValidationError('dueInDays must be a non-negative number');
    out.dueInDays = n;
  }
  return out;
};

/**
 * Resolve a `userIdOrColumnRef` / `to` ref to a list of user ids against the
 * triggering task. Supports a direct user id, or a person-column id whose value
 * is read off the task at run time.
 */
const resolveRecipientIds = (ref, task, board) => {
  const id = asId(ref);
  if (!id) return [];
  const col = findColumn(board, id);
  if (col && col.type === 'person') {
    const cv = task && task.columnValues;
    const raw = cv ? (typeof cv.get === 'function' ? cv.get(id) : cv[id]) : null;
    return (Array.isArray(raw) ? raw : []).map(asId).filter(Boolean);
  }
  // Otherwise treat as a direct user id.
  return isObjectId(id) ? [id] : [];
};

const truncate = (str, n = 240) => {
  const s = str == null ? '' : String(str);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Resolve a SEND_EMAIL `to` ref to a list of email addresses (F8). Supports an
 * `email`-type column (the lead's address), a `person` column / direct user id
 * (their account email), or a literal address string.
 */
const resolveEmailRecipients = async (ref, task, board) => {
  const id = asId(ref);
  if (!id) return [];
  const col = findColumn(board, id);
  if (col && col.type === 'email') {
    const cv = task && task.columnValues;
    const raw = cv ? (typeof cv.get === 'function' ? cv.get(id) : cv[id]) : null;
    const val = raw && typeof raw === 'object' ? raw.email || raw.value : raw;
    return val && EMAIL_RE.test(String(val).trim()) ? [String(val).trim()] : [];
  }
  if (col && col.type === 'person') {
    const ids = resolveRecipientIds(ref, task, board);
    if (!ids.length) return [];
    const users = await User.find({ _id: { $in: ids } }).select('email').lean();
    return users.map((u) => u.email).filter(Boolean);
  }
  if (isObjectId(id)) {
    const u = await User.findById(id).select('email').lean();
    return u && u.email ? [u.email] : [];
  }
  return EMAIL_RE.test(id) ? [id] : [];
};

/**
 * Resolve a SEND_SMS `to` ref to a phone number string (F10). The chosen
 * `phone`-type column is authoritative — its value is returned (even '', so the
 * action skips rather than texting a different number). Only when the ref does
 * NOT point at a phone column (e.g. a legacy config) does it fall back to the
 * first phone column on the board that holds a value. Returns the raw stored
 * value — `smsService` normalises it to E.164 and validates.
 */
const resolvePhoneRecipient = (ref, task, board) => {
  const cv = task && task.columnValues;
  const read = (id) =>
    cv ? (typeof cv.get === 'function' ? cv.get(id) : cv[id]) : undefined;
  const valueOf = (col) => {
    const v = read(asId(col._id));
    return v == null ? '' : String(v).trim();
  };

  const id = asId(ref);
  if (id) {
    const col = findColumn(board, id);
    if (col && col.type === 'phone') {
      // Authoritative: the admin picked this column. Don't fall through to a
      // different number when it's empty — skip instead.
      return valueOf(col);
    }
  }
  if (board && Array.isArray(board.columns)) {
    for (const col of board.columns) {
      if (col && col.type === 'phone') {
        const s = valueOf(col);
        if (s) return s;
      }
    }
  }
  return '';
};

const skippedOutcome = (payloadSummary) => ({
  status: 'skipped',
  error: DISABLED_REASON,
  payloadSummary,
});

// ===========================================================================
// Registry
// ===========================================================================
const actionTypes = {
  // ----- CREATE_TASK -------------------------------------------------------
  CREATE_TASK: {
    requires: null,
    configSchema: {
      fields: [
        { key: 'name', label: 'Task name', type: 'text', required: true, template: true },
        { key: 'group', label: 'Group', type: 'group', required: true },
        { key: 'priority', label: 'Priority', type: 'priority' },
        { key: 'assignedTo', label: 'Assignees', type: 'users' },
        { key: 'note', label: 'Note', type: 'textarea' },
      ],
    },
    validate: (config, ctx) => normaliseTaskConfig(config, ctx, { requireGroup: true }),
    describe: (config) => `Create task "${config?.name || ''}"`,
    execute: async ({ action, automation, board, task }) => {
      const created = await spawnTask(action, automation, board, task);
      if (!created) {
        return { status: 'skipped', error: 'No group resolved for task', payloadSummary: {} };
      }
      return {
        status: 'ok',
        task: created,
        payloadSummary: { name: created.name, group: asId(created.group) },
      };
    },
  },

  // ----- CREATE_SUBITEM ----------------------------------------------------
  CREATE_SUBITEM: {
    requires: null,
    configSchema: {
      fields: [
        { key: 'name', label: 'Subitem name', type: 'text', required: true, template: true },
        { key: 'priority', label: 'Priority', type: 'priority' },
        { key: 'assignedTo', label: 'Assignees', type: 'users' },
        { key: 'note', label: 'Note', type: 'textarea' },
      ],
    },
    validate: (config, ctx) => normaliseTaskConfig(config, ctx, { requireGroup: false }),
    describe: (config) => `Create subitem "${config?.name || ''}"`,
    execute: async ({ action, automation, board, task }) => {
      if (!task) {
        return { status: 'skipped', error: 'No triggering task for subitem', payloadSummary: {} };
      }
      const created = await spawnTask(action, automation, board, task);
      if (!created) {
        // spawnTask returns null when the triggering task has no group to
        // inherit — record a clean skip rather than dereferencing null.
        return { status: 'skipped', error: 'No group resolved for subitem', payloadSummary: {} };
      }
      return {
        status: 'ok',
        task: created,
        payloadSummary: { name: created.name, parent: asId(task._id) },
      };
    },
  },

  // ----- SET_COLUMN_VALUE --------------------------------------------------
  SET_COLUMN_VALUE: {
    requires: null,
    configSchema: {
      fields: [
        { key: 'columnId', label: 'Column', type: 'column', required: true },
        { key: 'value', label: 'Value', type: 'columnValue', required: false },
      ],
    },
    validate: (config, ctx) => {
      const cfg = config || {};
      const board = ctx && ctx.board;
      const col = findColumn(board, cfg.columnId);
      if (!col) throw ValidationError('SET_COLUMN_VALUE requires a valid columnId');
      const entry = getColumnType(col.type);
      if (!entry) throw ValidationError(`Unknown column type: ${col.type}`);
      // Read-only column types (formula / mirror) reject any write — surfaced
      // here so the automation can't be saved pointing at one.
      entry.validate(cfg.value, col.settings || {});
      const value = entry.serialize ? entry.serialize(cfg.value) : cfg.value;
      return { columnId: asId(col._id), value };
    },
    describe: (config, ctx) => {
      const col = findColumn(ctx && ctx.board, config?.columnId);
      const name = col?.name || 'column';
      const rendered =
        col && (col.type === 'status' || col.type === 'dropdown')
          ? optionLabel(col, config?.value)
          : config?.value;
      return `Set ${name} to "${rendered ?? ''}"`;
    },
    execute: async (ctx) => {
      const { task, board, config, automation } = ctx;
      const col = findColumn(board, config.columnId);
      if (!col) return { status: 'failed', error: 'Column no longer exists', payloadSummary: { columnId: config.columnId } };
      if (!task) return { status: 'skipped', error: 'No triggering task', payloadSummary: {} };
      const entry = getColumnType(col.type);
      const value = entry && entry.serialize ? entry.serialize(config.value) : config.value;

      const key = asId(col._id);
      if (!task.columnValues || typeof task.columnValues.get !== 'function') {
        task.columnValues = new Map(Object.entries(task.columnValues || {}));
      }
      const prevValue = task.columnValues.get(key);
      const prev = prevValue == null ? null : prevValue;
      task.columnValues.set(key, value);
      await task.save();

      // Only chain (emit downstream events) when the value actually changed.
      const changed = JSON.stringify(prev) !== JSON.stringify(value);
      if (changed) {
        emitColumnWriteEvents(task, automation.board, col, prev, value, {
          actorId: ctx.actorId,
          originAutomationId: automation._id,
          cascadeDepth: ctx.cascadeDepth,
        });
      }
      return { status: 'ok', task, payloadSummary: { columnId: key, value } };
    },
  },

  // ----- MOVE_TO_GROUP -----------------------------------------------------
  MOVE_TO_GROUP: {
    requires: null,
    configSchema: {
      fields: [{ key: 'groupId', label: 'Group', type: 'group', required: true }],
    },
    validate: (config, ctx) => {
      const cfg = config || {};
      if (!isObjectId(cfg.groupId)) throw ValidationError('MOVE_TO_GROUP requires a groupId');
      const groups = ctx && Array.isArray(ctx.groups) ? ctx.groups : null;
      if (groups && !groups.some((g) => asId(g._id) === asId(cfg.groupId))) {
        throw ValidationError('MOVE_TO_GROUP group does not belong to board');
      }
      return { groupId: asId(cfg.groupId) };
    },
    describe: (config, ctx) => {
      const groups = ctx && Array.isArray(ctx.groups) ? ctx.groups : [];
      const g = groups.find((x) => asId(x._id) === asId(config?.groupId));
      return `Move item to group ${g ? `"${g.name}"` : ''}`.trim();
    },
    execute: async ({ task, config }) => {
      if (!task) return { status: 'skipped', error: 'No triggering task', payloadSummary: {} };
      task.group = config.groupId;
      await task.save();
      return { status: 'ok', task, payloadSummary: { groupId: config.groupId } };
    },
  },

  // ----- CLEAR_COLUMN ------------------------------------------------------
  CLEAR_COLUMN: {
    requires: null,
    configSchema: {
      fields: [{ key: 'columnId', label: 'Column', type: 'column', required: true }],
    },
    validate: (config, ctx) => {
      const cfg = config || {};
      const col = findColumn(ctx && ctx.board, cfg.columnId);
      if (!col) throw ValidationError('CLEAR_COLUMN requires a valid columnId');
      if (col.type === 'formula' || col.type === 'mirror') {
        throw ValidationError('CLEAR_COLUMN cannot clear a read-only column');
      }
      return { columnId: asId(col._id) };
    },
    describe: (config, ctx) => {
      const col = findColumn(ctx && ctx.board, config?.columnId);
      return `Clear ${col?.name || 'column'}`;
    },
    execute: async (ctx) => {
      const { task, board, config, automation } = ctx;
      if (!task) return { status: 'skipped', error: 'No triggering task', payloadSummary: {} };
      const col = findColumn(board, config.columnId);
      if (!col) return { status: 'failed', error: 'Column no longer exists', payloadSummary: { columnId: config.columnId } };
      const key = asId(col._id);
      if (!task.columnValues || typeof task.columnValues.get !== 'function') {
        task.columnValues = new Map(Object.entries(task.columnValues || {}));
      }
      const prevValue = task.columnValues.get(key);
      const prev = prevValue == null ? null : prevValue;
      if (prev == null) {
        return { status: 'skipped', error: 'Column already empty', payloadSummary: { columnId: key } };
      }
      task.columnValues.set(key, null);
      await task.save();
      emitColumnWriteEvents(task, automation.board, col, prev, null, {
        actorId: ctx.actorId,
        originAutomationId: automation._id,
        cascadeDepth: ctx.cascadeDepth,
      });
      return { status: 'ok', task, payloadSummary: { columnId: key, cleared: true } };
    },
  },

  // ----- DUPLICATE_ITEM ----------------------------------------------------
  DUPLICATE_ITEM: {
    requires: null,
    configSchema: { fields: [] },
    // No config — clones the triggering item into the same group.
    validate: () => ({}),
    describe: () => 'Duplicate this item',
    execute: async ({ task, automation }) => {
      if (!task) return { status: 'skipped', error: 'No triggering task to duplicate', payloadSummary: {} };
      if (task.parent) return { status: 'skipped', error: 'Subitems cannot be duplicated here', payloadSummary: {} };

      // Deep-copy the columnValues map so the clone is independent.
      let columnValues;
      if (task.columnValues && typeof task.columnValues.entries === 'function') {
        columnValues = new Map(task.columnValues);
      } else if (task.columnValues) {
        columnValues = new Map(Object.entries(task.columnValues));
      } else {
        columnValues = new Map();
      }

      const copy = await Task.create({
        name: `${task.name} (copy)`,
        board: task.board,
        group: task.group,
        parent: null,
        priority: task.priority || 'medium',
        status: task.status,
        assignedTo: Array.isArray(task.assignedTo) ? task.assignedTo : [],
        dueDate: task.dueDate,
        note: task.note,
        columnValues,
        isPersonal: false,
        createdBy: automation.createdBy,
        createdByAutomation: true,
      });
      await Board.updateOne({ _id: task.board }, { $set: { updatedAt: new Date() } });
      return { status: 'ok', payloadSummary: { duplicatedFrom: asId(task._id), newTaskId: asId(copy._id) } };
    },
  },

  // ----- DELETE_ITEM -------------------------------------------------------
  DELETE_ITEM: {
    requires: null,
    configSchema: { fields: [] },
    // No config — permanently deletes the triggering item (and its subitems).
    // Destructive: place it last in a chain. Mirrors taskController.deleteTask's
    // cascade (comments + notifications + subitems) and emits task.deleted.
    validate: () => ({}),
    describe: () => 'Delete this item',
    execute: async ({ task, automation }) => {
      if (!task) return { status: 'skipped', error: 'No triggering task to delete', payloadSummary: {} };
      const Comment = require('../models/Comment');
      const Notification = require('../models/Notification');

      const id = task._id;
      const subitems = await Task.find({ parent: id }).select('_id');
      const subitemIds = subitems.map((s) => s._id);
      const idsToDelete = [id, ...subitemIds];

      await Comment.deleteMany({ task: { $in: idsToDelete } });
      await Notification.deleteMany({ task: { $in: idsToDelete } });
      if (subitemIds.length > 0) await Task.deleteMany({ _id: { $in: subitemIds } });
      await Task.deleteOne({ _id: id });
      await Board.updateOne({ _id: task.board }, { $set: { updatedAt: new Date() } });

      for (const deletedId of idsToDelete) {
        eventBus.emit('task.deleted', { taskId: deletedId, boardId: task.board });
      }
      return { status: 'ok', payloadSummary: { deletedTaskId: asId(id), deletedSubitems: subitemIds.length } };
    },
  },

  // ----- NOTIFY_PERSON -----------------------------------------------------
  NOTIFY_PERSON: {
    requires: null,
    configSchema: {
      fields: [
        { key: 'userIdOrColumnRef', label: 'Notify', type: 'userOrColumn', required: true },
        { key: 'message', label: 'Message', type: 'textarea', required: true, template: true },
        { key: 'sendEmailDigest', label: 'Also send email', type: 'boolean' },
      ],
    },
    validate: (config, ctx) => {
      const cfg = config || {};
      const ref = asId(cfg.userIdOrColumnRef);
      if (!ref) throw ValidationError('NOTIFY_PERSON requires a user or person column');
      const col = findColumn(ctx && ctx.board, ref);
      const refOk = (col && col.type === 'person') || isObjectId(ref);
      if (!refOk) {
        throw ValidationError('NOTIFY_PERSON target must be a user id or a person column');
      }
      const message = requireNonEmptyString(cfg.message, 'Message');
      return {
        userIdOrColumnRef: ref,
        message,
        sendEmailDigest: cfg.sendEmailDigest === true,
      };
    },
    describe: (config) => `Notify person — "${truncate(config?.message, 40)}"`,
    execute: async ({ task, board, automation, config }) => {
      const recipientIds = resolveRecipientIds(config.userIdOrColumnRef, task, board);
      if (recipientIds.length === 0) {
        return { status: 'skipped', error: 'No recipients resolved', payloadSummary: {} };
      }
      const users = await User.find({ _id: { $in: recipientIds } })
        .select('name email')
        .lean();
      const usersById = {};
      users.forEach((u) => { usersById[asId(u._id)] = u; });

      const taskLink = `${process.env.CLIENT_URL}/boards/${asId(automation.board)}`;
      let firstMessage = '';
      for (const u of users) {
        const message = interpolate(config.message, { task, board, user: u, users: usersById });
        if (!firstMessage) firstMessage = message;
        await createNotificationsForUsers({
          userIds: [u._id],
          type: 'automation',
          message,
          taskId: task ? task._id : undefined,
          orgId: automation.organisation,
        });
        if (config.sendEmailDigest && u.email) {
          // Best-effort — the in-app notification is the deliverable; the email
          // digest must never fail the action (mirrors notifyAssignees).
          try {
            await sendAutomationDigestEmail({
              to: u.email,
              subject: `Update on "${task ? task.name : 'your board'}"`,
              message,
              taskLink,
            });
          } catch (err) {
            console.error('[automation/NOTIFY_PERSON] digest email failed:', err?.message || err);
          }
        }
      }
      return {
        status: 'ok',
        payloadSummary: {
          recipientCount: recipientIds.length,
          sendEmailDigest: config.sendEmailDigest === true,
          message: truncate(firstMessage),
        },
      };
    },
  },

  // ----- SEND_EMAIL (contract — F8) ---------------------------------------
  SEND_EMAIL: {
    requires: 'F8',
    configSchema: {
      fields: [
        { key: 'to', label: 'To', type: 'userOrColumn', required: true },
        { key: 'subject', label: 'Subject', type: 'text', template: true },
        { key: 'body', label: 'Body', type: 'textarea', required: true, template: true },
        { key: 'template', label: 'Template id', type: 'text' },
      ],
    },
    validate: (config) => {
      const cfg = config || {};
      if (!asId(cfg.to)) throw ValidationError('SEND_EMAIL requires a "to" recipient');
      if (!String(cfg.body || '').trim() && !String(cfg.template || '').trim()) {
        throw ValidationError('SEND_EMAIL requires a body or a template');
      }
      return {
        to: asId(cfg.to),
        subject: cfg.subject ? String(cfg.subject) : '',
        body: cfg.body ? String(cfg.body) : '',
        template: cfg.template ? String(cfg.template) : '',
      };
    },
    describe: (config) => `Send email to ${config?.to || '…'}`,
    // F8.5: resolve the recipient address(es) + the sending user's connected
    // mailbox, interpolate subject/body, send through `sendUserEmail` (persisting
    // an EmailMessage), or fall back to Resend with a [Sent via CRM] footer when
    // no mailbox is connected (AC5). Lazy require keeps the registry cycle-free.
    execute: async ({ task, board, automation, config, actorId }) => {
      const subject = interpolate(config.subject || '', { task, board });
      const body = interpolate(config.body || '', { task, board });

      if (!task) {
        return { status: 'skipped', error: 'No triggering task for email', payloadSummary: {} };
      }
      const toAddresses = await resolveEmailRecipients(config.to, task, board);
      if (!toAddresses.length) {
        return skippedOutcome({ to: config.to, reason: 'No email recipient resolved', subject: truncate(subject) });
      }
      if (!body.trim()) {
        return { status: 'skipped', error: 'Empty email body', payloadSummary: { to: toAddresses } };
      }

      const { sendEmailForTask, resolveSenderAccount } = require('../services/taskEmail');
      const candidateUserIds = [
        actorId,
        ...(Array.isArray(task.assignedTo) ? task.assignedTo : []),
        automation.createdBy,
      ];
      const account = await resolveSenderAccount({
        workspaceId: automation.organisation,
        candidateUserIds,
      });

      const message = await sendEmailForTask({
        taskId: task._id,
        to: toAddresses,
        subject,
        body,
        account,
        sentBy: actorId || automation.createdBy,
      });

      if (message.status === 'failed') {
        return {
          status: 'failed',
          error: message.sendError || 'Email send failed',
          payloadSummary: { to: toAddresses, via: message.provider, messageId: asId(message._id) },
        };
      }
      return {
        status: 'ok',
        payloadSummary: {
          to: toAddresses,
          subject: truncate(subject),
          via: message.provider,
          fallback: message.provider === 'resend',
          messageId: asId(message._id),
        },
      };
    },
  },

  // ----- ENROLL_IN_SEQUENCE (Phase 4 — email drip cadence) ----------------
  // Enroll the triggering lead into a multi-step email sequence. Always enabled
  // (no channel gate): the sequenceRunner sends each step through the same
  // tracked email path as SEND_EMAIL, degrading to the Resend fallback when no
  // mailbox is connected.
  ENROLL_IN_SEQUENCE: {
    requires: null,
    configSchema: {
      fields: [
        { key: 'sequenceId', label: 'Email sequence', type: 'sequence', required: true },
      ],
    },
    validate: (config) => {
      const cfg = config || {};
      const id = asId(cfg.sequenceId);
      if (!id || !isObjectId(id)) {
        throw ValidationError('ENROLL_IN_SEQUENCE requires a valid sequence');
      }
      return { sequenceId: id };
    },
    describe: (config) => `Enroll lead in sequence ${config?.sequenceId || '…'}`,
    // Idempotent — a lead already active in the sequence is skipped. Lazy
    // require keeps the registry cycle-free.
    execute: async ({ task, config, actorId }) => {
      if (!task) {
        return { status: 'skipped', error: 'No triggering task to enroll', payloadSummary: {} };
      }
      const { enrollById } = require('../services/sequenceService');
      const result = await enrollById({
        sequenceId: config.sequenceId,
        taskId: task._id,
        enrolledBy: actorId || null,
      });
      if (result.ok) {
        return {
          status: 'ok',
          payloadSummary: {
            sequenceId: config.sequenceId,
            enrollmentId: asId(result.enrollment._id),
          },
        };
      }
      return {
        status: 'skipped',
        error: result.reason || 'Enrollment skipped',
        payloadSummary: { sequenceId: config.sequenceId, reason: result.reason },
      };
    },
  },

  // ----- SEND_SMS (F10) ----------------------------------------------------
  SEND_SMS: {
    requires: 'F10',
    // `to` is a PHONE column (not userOrColumn like SEND_EMAIL): SMS can only go
    // to a phone number, and the User model has no phone field, so a person/user
    // ref could never resolve. The FE `column` control filters to phone columns.
    configSchema: {
      fields: [
        { key: 'to', label: 'To (phone column)', type: 'column', columnType: 'phone', required: true },
        { key: 'template', label: 'Message', type: 'textarea', required: true, template: true },
      ],
    },
    validate: (config, ctx) => {
      const cfg = config || {};
      const to = asId(cfg.to);
      if (!to) throw ValidationError('SEND_SMS requires a "to" phone column');
      // When the board context is available, require the ref to be a phone
      // column on the board (so an unusable config can't be saved).
      const board = ctx && ctx.board;
      if (board && Array.isArray(board.columns)) {
        const col = findColumn(board, to);
        if (!col || col.type !== 'phone') {
          throw ValidationError('SEND_SMS "to" must be a phone column on this board');
        }
      }
      requireNonEmptyString(cfg.template, 'SMS message');
      return { to, template: String(cfg.template) };
    },
    describe: (config) => `Send SMS to ${config?.to || '…'}`,
    // F10.3: resolve the lead's phone column, interpolate the body, and send via
    // `smsService` (which decrypts the workspace SmsConfig, blocks opted-out
    // numbers, and appends the opt-out footer). An opted-out / invalid number
    // records a `failed` run-log row (AC); a missing column / config skips
    // cleanly. Lazy require keeps the registry cycle-free.
    execute: async ({ task, board, automation, config }) => {
      const body = interpolate(config.template || '', { task, board });

      if (!task) {
        return { status: 'skipped', error: 'No triggering task for SMS', payloadSummary: {} };
      }
      const phone = resolvePhoneRecipient(config.to, task, board);
      if (!phone) {
        return {
          status: 'skipped',
          error: 'No phone recipient resolved',
          payloadSummary: { to: config.to, reason: 'No phone recipient resolved' },
        };
      }
      if (!body.trim()) {
        return { status: 'skipped', error: 'Empty SMS body', payloadSummary: { to: phone } };
      }

      const { send } = require('../services/smsService');
      const result = await send({
        workspaceId: automation.organisation,
        to: phone,
        body,
        taskId: task._id,
      });

      if (result.ok) {
        return {
          status: 'ok',
          payloadSummary: {
            to: phone,
            message: truncate(body),
            status: result.status,
            sid: (result.message && result.message.twilioSid) || null,
          },
        };
      }

      const REASONS = {
        no_sms_config: 'Workspace has no SMS configuration',
        invalid_number: 'Invalid phone number',
        opted_out: 'Recipient has opted out of SMS',
        send_error: result.error || 'SMS send failed',
      };
      const error = REASONS[result.reason] || 'SMS send failed';
      // A missing/unconfigured workspace SmsConfig is a setup gap → skip; an
      // opted-out / invalid number / provider error is a genuine failure (AC).
      const status = result.reason === 'no_sms_config' ? 'skipped' : 'failed';
      return {
        status,
        error,
        payloadSummary: {
          to: phone,
          reason: result.reason,
          status: (result.message && result.message.status) || null,
        },
      };
    },
  },

  // ----- SEND_WHATSAPP (F11) ----------------------------------------------
  SEND_WHATSAPP: {
    requires: 'F11',
    // `to` is a PHONE column (mirrors the F10 SEND_SMS review fix): WhatsApp can
    // only reach a phone number, and the User model has no phone field, so a
    // person/user ref could never resolve. A `templateId` is required because an
    // automation can fire outside the 24h window, where only an approved
    // template may send (AC1) — picking one keeps the action valid either way.
    configSchema: {
      fields: [
        { key: 'to', label: 'To (phone column)', type: 'column', columnType: 'phone', required: true },
        { key: 'templateId', label: 'Template', type: 'whatsappTemplate', required: true },
        { key: 'variables', label: 'Template variables', type: 'keyValue', template: true },
      ],
    },
    validate: (config, ctx) => {
      const cfg = config || {};
      const to = asId(cfg.to);
      if (!to) throw ValidationError('SEND_WHATSAPP requires a "to" phone column');
      // When the board context is available, require the ref to be a phone
      // column on the board (so an unusable config can't be saved).
      const board = ctx && ctx.board;
      if (board && Array.isArray(board.columns)) {
        const col = findColumn(board, to);
        if (!col || col.type !== 'phone') {
          throw ValidationError('SEND_WHATSAPP "to" must be a phone column on this board');
        }
      }
      requireNonEmptyString(cfg.templateId, 'WhatsApp template');
      const variables =
        cfg.variables && typeof cfg.variables === 'object' && !Array.isArray(cfg.variables)
          ? cfg.variables
          : {};
      return { to, templateId: String(cfg.templateId), variables };
    },
    describe: (config) => `Send WhatsApp template "${config?.templateId || ''}"`,
    // F11.3: resolve the lead's phone column, interpolate the template variables,
    // and send via `whatsappService` (which enforces the 24h window — outside it
    // only an approved template sends — decrypts the WhatsAppConfig, and reuses
    // the F10 opt-out gate). Lazy require keeps the registry cycle-free.
    execute: async ({ task, board, automation, config }) => {
      if (!task) {
        return { status: 'skipped', error: 'No triggering task for WhatsApp', payloadSummary: {} };
      }
      const phone = resolvePhoneRecipient(config.to, task, board);
      if (!phone) {
        return {
          status: 'skipped',
          error: 'No phone recipient resolved',
          payloadSummary: { to: config.to, reason: 'No phone recipient resolved' },
        };
      }

      // Interpolate each template variable value against the task/board so a
      // config like `{ "1": "{{task.name}}" }` resolves at run time.
      const variables = {};
      const rawVars = config.variables && typeof config.variables === 'object' ? config.variables : {};
      for (const [k, v] of Object.entries(rawVars)) {
        variables[k] = interpolate(v == null ? '' : String(v), { task, board });
      }

      const { send } = require('../services/whatsappService');
      const result = await send({
        workspaceId: automation.organisation,
        to: phone,
        templateId: config.templateId,
        variables,
        taskId: task._id,
      });

      if (result.ok) {
        return {
          status: 'ok',
          payloadSummary: {
            to: phone,
            templateId: config.templateId,
            message: truncate((result.message && result.message.body) || ''),
            status: result.status,
            windowOpen: result.windowOpen === true,
            sid: (result.message && result.message.twilioSid) || null,
          },
        };
      }

      const REASONS = {
        no_whatsapp_config: 'Workspace has no WhatsApp configuration',
        invalid_number: 'Invalid phone number',
        opted_out: 'Recipient has opted out',
        template_not_found: 'WhatsApp template not found',
        window_closed: 'Outside the 24h window — an approved template is required',
        template_not_approved: 'Template is not approved for sending outside the 24h window',
        empty_message: 'Empty WhatsApp message',
        send_error: result.error || 'WhatsApp send failed',
      };
      const error = REASONS[result.reason] || 'WhatsApp send failed';
      // A missing/unconfigured workspace WhatsAppConfig is a setup gap → skip;
      // an opted-out / closed-window / unapproved-template / provider error is a
      // genuine failure recorded in the run log (AC1).
      const status = result.reason === 'no_whatsapp_config' ? 'skipped' : 'failed';
      return {
        status,
        error,
        payloadSummary: {
          to: phone,
          templateId: config.templateId,
          reason: result.reason,
          windowOpen: result.windowOpen === true,
          status: (result.message && result.message.status) || null,
        },
      };
    },
  },

  // ----- CREATE_CALENDAR_EVENT (contract — Google Calendar / internal) -----
  CREATE_CALENDAR_EVENT: {
    requires: 'CALENDAR',
    configSchema: {
      fields: [
        {
          key: 'calendarRef',
          label: 'Calendar',
          type: 'select',
          options: [
            { value: 'internal', label: 'Internal calendar' },
            { value: 'agent_google', label: "Agent's Google Calendar" },
          ],
        },
        { key: 'title', label: 'Event title', type: 'text', required: true, template: true },
        { key: 'startsAtColumnRef', label: 'Start date column', type: 'column', columnType: 'date' },
        { key: 'durationMinutes', label: 'Duration (min)', type: 'number' },
      ],
    },
    validate: (config, ctx) => {
      const cfg = config || {};
      const title = requireNonEmptyString(cfg.title, 'Event title');
      const calendarRef = cfg.calendarRef === 'agent_google' ? 'agent_google' : 'internal';
      const out = { calendarRef, title };
      if (cfg.startsAtColumnRef) {
        const col = findColumn(ctx && ctx.board, cfg.startsAtColumnRef);
        if (!col || col.type !== 'date') {
          throw ValidationError('startsAtColumnRef must be a date column');
        }
        out.startsAtColumnRef = asId(col._id);
      }
      if (cfg.durationMinutes != null && cfg.durationMinutes !== '') {
        const n = Number(cfg.durationMinutes);
        if (!Number.isFinite(n) || n <= 0) throw ValidationError('durationMinutes must be positive');
        out.durationMinutes = n;
      }
      return out;
    },
    describe: (config) => `Create calendar event "${config?.title || ''}"`,
    execute: async ({ config }) =>
      skippedOutcome({ calendarRef: config.calendarRef, title: truncate(config.title, 80) }),
  },

  // ----- POST_WEBHOOK (F7) -------------------------------------------------
  POST_WEBHOOK: {
    requires: 'F7',
    configSchema: {
      fields: [{ key: 'endpointId', label: 'Endpoint', type: 'endpoint', required: true }],
    },
    // Endpoint OR url required (the FE picks a saved outbound endpoint; a raw
    // url is accepted too and resolved to its endpoint at run time). Optional
    // `eventTypes` filters which firing events ship the webhook.
    validate: (config) => {
      const cfg = config || {};
      const endpointId = cfg.endpointId ? String(cfg.endpointId).trim() : '';
      const url = cfg.url ? String(cfg.url).trim() : '';
      if (!endpointId && !url) {
        throw ValidationError('POST_WEBHOOK requires a webhook endpoint or url');
      }
      const out = {};
      if (endpointId) out.endpointId = endpointId;
      if (url) out.url = url;
      if (Array.isArray(cfg.eventTypes)) {
        out.eventTypes = cfg.eventTypes.map((e) => String(e)).filter(Boolean);
      }
      return out;
    },
    describe: (config) =>
      `POST webhook to ${config?.url || config?.endpointId || '…'}`,
    // F7.5: resolve the outbound endpoint, build the envelope, dispatch it
    // (signed via webhookDispatcher → X-CRM-Signature). Lazy requires keep the
    // registry cycle-free at module load.
    execute: async ({ task, board, automation, config }) => {
      const WebhookEndpoint = require('../models/WebhookEndpoint');
      const { dispatch } = require('../services/webhookDispatcher');

      let endpoint = null;
      if (config.endpointId) {
        endpoint = await WebhookEndpoint.findById(config.endpointId).catch(() => null);
      }
      if (!endpoint && config.url) {
        endpoint = await WebhookEndpoint.findOne({
          boardId: automation.board,
          direction: 'out',
          url: config.url,
        }).catch(() => null);
      }
      if (!endpoint || endpoint.direction !== 'out' || !endpoint.enabled) {
        return {
          status: 'failed',
          error: 'Outbound webhook endpoint not found or disabled',
          payloadSummary: { endpointId: config.endpointId || null, url: config.url || null },
        };
      }

      // Optional event-type filter: skip when the firing event isn't listed.
      const event = (automation && automation.triggerType) || 'AUTOMATION';
      const filter = Array.isArray(config.eventTypes) ? config.eventTypes : [];
      if (filter.length > 0 && !filter.includes(event)) {
        return {
          status: 'skipped',
          error: `Event ${event} not in endpoint eventTypes`,
          payloadSummary: { endpointId: asId(endpoint._id), event, eventTypes: filter },
        };
      }

      const columnValues =
        task && task.columnValues && typeof task.columnValues.entries === 'function'
          ? Object.fromEntries(task.columnValues)
          : task && task.columnValues
            ? { ...task.columnValues }
            : {};

      const envelope = {
        event,
        taskSnapshot: task
          ? {
              id: asId(task._id),
              name: task.name,
              status: task.status == null ? null : asId(task.status),
              group: asId(task.group),
              columnValues,
            }
          : null,
        board: board ? { id: asId(automation.board), name: board.name } : { id: asId(automation.board) },
        workspace: { id: asId(automation.organisation) },
        timestamp: new Date().toISOString(),
      };

      const delivery = await dispatch(endpoint, envelope);
      // First attempt either delivered or queued a retry (pending). Both mean the
      // action did its job; only an already-exhausted delivery is a hard failure.
      const failed = delivery.status === 'failed';
      return {
        status: failed ? 'failed' : 'ok',
        ...(failed ? { error: 'Webhook delivery failed' } : {}),
        payloadSummary: {
          endpointId: asId(endpoint._id),
          url: endpoint.url,
          event,
          deliveryStatus: delivery.status,
          deliveryId: asId(delivery._id),
        },
      };
    },
  },

  // ----- ASSIGN_LEAD_AGENT (F9) -------------------------------------------
  ASSIGN_LEAD_AGENT: {
    requires: 'F9',
    configSchema: { fields: [] },
    // No config — the F9 assignment policy (round-robin / city → agent / fixed)
    // lives on the board's LeadIntakePolicy.
    validate: () => ({}),
    describe: () => 'Assign lead agent by policy',
    // F9.3: resolve the board's intake policy and run the shared owner-assignment
    // step (`assignOwner`) — the SAME path the `lead.intake` runner uses, so the
    // round-robin cursor advances once and the geo fallback behaves identically.
    // Lazy requires keep the registry cycle-free.
    execute: async ({ task, board, automation }) => {
      if (!task) {
        return { status: 'skipped', error: 'No triggering task for lead assignment', payloadSummary: {} };
      }
      const LeadIntakePolicy = require('../models/LeadIntakePolicy');
      const { assignOwner } = require('../services/leadIntakeRunner');

      const policy = await LeadIntakePolicy.findOne({ boardId: automation.board });
      if (!policy) {
        return { status: 'skipped', error: 'No lead intake policy on this board', payloadSummary: {} };
      }
      if (!policy.enabled) {
        return { status: 'skipped', error: 'Lead intake policy is disabled', payloadSummary: {} };
      }

      const outcome = await assignOwner(policy, task, board);
      const payloadSummary = {
        ownerId: outcome.ownerId || null,
        columnId: outcome.columnId || null,
        strategy: outcome.strategy,
        fallback: !!outcome.fallback,
        reason: outcome.reason || null,
      };
      if (outcome.status === 'ok') {
        return { status: 'ok', task, payloadSummary };
      }
      return {
        status: outcome.status === 'failed' ? 'failed' : 'skipped',
        error: outcome.reason || 'Owner not assigned',
        payloadSummary,
      };
    },
  },
};

// Static human label per action type — exposed as `describe` in the catalog so
// the FE has a server-provided single source of truth (per the F5.3 contract
// `[{ type, configSchema, describe, requires, disabled }]`). The per-entry
// `describe(config, ctx)` method renders an instance-specific summary; this is
// the generic, config-free label for the picker.
const ACTION_DESCRIPTIONS = {
  CREATE_TASK: 'Create a task',
  CREATE_SUBITEM: 'Create a subitem',
  SET_COLUMN_VALUE: 'Set a column value',
  CLEAR_COLUMN: 'Clear a column value',
  MOVE_TO_GROUP: 'Move item to a group',
  DUPLICATE_ITEM: 'Duplicate this item',
  DELETE_ITEM: 'Delete this item',
  NOTIFY_PERSON: 'Notify a person (in-app + optional email)',
  SEND_EMAIL: 'Send an email',
  ENROLL_IN_SEQUENCE: 'Enroll the lead in an email sequence',
  SEND_SMS: 'Send an SMS',
  SEND_WHATSAPP: 'Send a WhatsApp message',
  CREATE_CALENDAR_EVENT: 'Create a calendar event',
  POST_WEBHOOK: 'Post to a webhook',
  ASSIGN_LEAD_AGENT: 'Assign the lead agent by policy',
};

// Derive `disabled` (from the `requires` marker) and attach the static label.
for (const [type, entry] of Object.entries(actionTypes)) {
  entry.disabled = entry.requires ? !SHIPPED_PHASES.has(entry.requires) : false;
  entry.description = ACTION_DESCRIPTIONS[type] || type;
}

const ACTION_TYPE_NAMES = Object.keys(actionTypes);

const getActionType = (type) =>
  Object.prototype.hasOwnProperty.call(actionTypes, type) ? actionTypes[type] : null;

/**
 * Validate + normalise an action's config through the registry. Wraps the
 * thrown ValidationError into a stable `{ ok, config?, error? }` for controllers.
 */
const validateActionConfig = (type, config, ctx) => {
  const entry = getActionType(type);
  if (!entry) return { ok: false, error: `Invalid action type "${type}"` };
  try {
    const normalised = entry.validate(config, ctx || {});
    return { ok: true, config: normalised || {} };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
};

/**
 * Build the action-catalog payload consumed by the FE action picker
 * (`GET /api/automations/action-catalog`).
 */
const buildActionCatalog = () =>
  ACTION_TYPE_NAMES.map((type) => {
    const entry = actionTypes[type];
    return {
      type,
      configSchema: entry.configSchema,
      describe: entry.description,
      requires: entry.requires,
      disabled: entry.disabled,
    };
  });

module.exports = {
  actionTypes,
  ACTION_TYPE_NAMES,
  getActionType,
  validateActionConfig,
  buildActionCatalog,
  DISABLED_REASON,
  // Shared spawn helpers reused by the controller's legacy/group paths.
  notifyAssignees,
  resolveDefaultStatusId,
};
