const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
const Task = require('../models/Task');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const User = require('../models/User');

/**
 * Permission gate mirrors commentController.checkTaskAccess:
 *   - Personal task: only the creator can read.
 *   - Board task: any org member can read.
 */
const checkTaskAccess = async (task, userId) => {
  if (task.isPersonal) {
    if (!task.createdBy || task.createdBy.toString() !== userId) {
      return { status: 403, error: 'Not authorised' };
    }
    return { ok: true, board: null };
  }
  const board = await Board.findById(task.board);
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };
  const isMember = org.members.some((m) => m.toString() === userId);
  if (!isMember) {
    return { status: 403, error: 'Not a member of this organisation' };
  }
  return { ok: true, board };
};

/**
 * Resolve a single value (or array of values) for a given field into a shape
 * the frontend can render directly without extra round-trips.
 *
 * Resolution map:
 *   - status  → { id, name, color } from board.statuses
 *   - labels  → [{ id, name, color }] from board.labels
 *   - assignees → [{ id, name, profilePic }] from userMap
 *   - others (name, note, priority, dueDate, group) → raw value
 */
const resolveFieldValue = (field, value, board, userMap) => {
  if (value === null || value === undefined) return null;

  if (field === 'status') {
    if (!board) return value;
    const idStr = value.toString();
    const found = board.statuses?.find((s) => s._id.toString() === idStr);
    if (!found) return { id: idStr, name: 'Unknown', color: null };
    return { id: idStr, name: found.name, color: found.color };
  }

  if (field === 'labels') {
    if (!Array.isArray(value)) return [];
    if (!board) return value;
    return value.map((id) => {
      const idStr = id.toString();
      const found = board.labels?.find((l) => l._id.toString() === idStr);
      return found
        ? { id: idStr, name: found.name, color: found.color }
        : { id: idStr, name: 'Unknown', color: null };
    });
  }

  if (field === 'assignees') {
    if (!Array.isArray(value)) return [];
    return value.map((id) => {
      const idStr = id.toString();
      const u = userMap.get(idStr);
      return u
        ? { id: idStr, name: u.name, profilePic: u.profilePic }
        : { id: idStr, name: 'Unknown', profilePic: null };
    });
  }

  return value;
};

/**
 * Collect every user id referenced across a batch of activity entries so we
 * can fetch them all in one go (avoids N+1).
 */
const collectUserIds = (entries) => {
  const ids = new Set();
  for (const e of entries) {
    if (e.actor) ids.add(e.actor.toString());
    if (e.field === 'assignees') {
      if (Array.isArray(e.oldValue)) e.oldValue.forEach((id) => id && ids.add(id.toString()));
      if (Array.isArray(e.newValue)) e.newValue.forEach((id) => id && ids.add(id.toString()));
    }
  }
  return Array.from(ids);
};

/**
 * GET /api/tasks/:taskId/activity?cursor=<isoDate>&limit=50&actor=<id>&type=<type>
 */
const getActivity = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { taskId } = req.params;
    const { cursor, actor, type } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const access = await checkTaskAccess(task, userId);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const filter = { task: taskId };
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!isNaN(cursorDate.getTime())) {
        filter.createdAt = { $lt: cursorDate };
      }
    }
    if (actor && mongoose.Types.ObjectId.isValid(actor)) {
      filter.actor = actor;
    }
    if (type && ActivityLog.ACTIVITY_TYPES.includes(type)) {
      filter.type = type;
    }

    // +1 to detect if there are more pages.
    const raw = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = raw.length > limit;
    const slice = hasMore ? raw.slice(0, limit) : raw;

    const userIds = collectUserIds(slice);
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select('name profilePic email')
          .lean()
      : [];
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const board = access.board;

    const items = slice.map((e) => {
      const actorDoc = userMap.get(e.actor.toString());
      return {
        _id: e._id,
        type: e.type,
        field: e.field,
        oldValue: resolveFieldValue(e.field, e.oldValue, board, userMap),
        newValue: resolveFieldValue(e.field, e.newValue, board, userMap),
        metadata: e.metadata,
        actor: actorDoc
          ? {
              _id: actorDoc._id,
              name: actorDoc.name,
              profilePic: actorDoc.profilePic,
            }
          : { _id: e.actor, name: 'Unknown', profilePic: null },
        createdAt: e.createdAt,
      };
    });

    const nextCursor = hasMore ? slice[slice.length - 1].createdAt.toISOString() : null;

    return res.json({ items, nextCursor });
  } catch (err) {
    console.error('getActivity error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getActivity,
};
