const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Task = require('../models/Task');
const Board = require('../models/Board');

const NOTIFICATION_LIMIT = 50;
const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Scan for tasks assigned to the given user whose due date lands inside the
 * next 24 hours and create a `dueSoon` notification for each task that
 * doesn't already have one. Personal tasks created by the user are also
 * included.
 *
 * This runs on every GET /api/notifications call (poll-based, no cron).
 * Failures are swallowed so they never break the list fetch.
 *
 * Board-task dueSoon notifications are stamped with the board's organisation
 * so they only appear in that org's notification bell. Personal-task
 * dueSoon notifications keep `organisation: null` and show in every org.
 */
const ensureDueSoonNotifications = async (userId) => {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const dueTasks = await Task.find({
      dueDate: { $gte: now, $lte: soon },
      $or: [
        { assignedTo: userObjectId },
        { isPersonal: true, createdBy: userObjectId },
      ],
    }).select('_id name dueDate board isPersonal');

    if (!dueTasks.length) return;

    const taskIds = dueTasks.map((t) => t._id);
    const existing = await Notification.find({
      user: userObjectId,
      type: 'dueSoon',
      task: { $in: taskIds },
    }).select('task');
    const existingSet = new Set(existing.map((n) => n.task.toString()));

    const missing = dueTasks.filter((t) => !existingSet.has(t._id.toString()));
    if (!missing.length) return;

    // Bulk-resolve org id per board for the missing board tasks.
    const boardIds = [
      ...new Set(
        missing
          .filter((t) => !t.isPersonal && t.board)
          .map((t) => t.board.toString())
      ),
    ];
    const boardOrgMap = new Map();
    if (boardIds.length) {
      const boards = await Board.find({ _id: { $in: boardIds } }).select(
        'organisation'
      );
      boards.forEach((b) => {
        boardOrgMap.set(b._id.toString(), b.organisation || null);
      });
    }

    const toCreate = missing.map((t) => ({
      user: userObjectId,
      organisation: t.isPersonal
        ? null
        : boardOrgMap.get(t.board?.toString()) || null,
      type: 'dueSoon',
      message: `"${t.name}" is due soon`,
      task: t._id,
      isRead: false,
    }));

    if (toCreate.length) {
      await Notification.insertMany(toCreate);
    }
  } catch (err) {
    console.error('ensureDueSoonNotifications error:', err);
  }
};

/**
 * GET /api/notifications?org=<orgId>
 *
 * Return the latest 50 notifications for the current user, newest first.
 * Also runs an inline due-soon scan so users see reminders for tasks due
 * within the next 24 hours.
 *
 * When `org` is supplied, the result is scoped to that organisation —
 * notifications stamped with another org are hidden. Personal-task
 * notifications (organisation: null) are always included so dueSoon
 * reminders for personal tasks show regardless of the active org.
 *
 * When `org` is omitted, returns every notification for the user (legacy
 * behaviour — used by callers that don't yet have an org context).
 */
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = (req.query.org || '').toString().trim();

    await ensureDueSoonNotifications(userId);

    const filter = { user: userId };
    if (orgId && mongoose.Types.ObjectId.isValid(orgId)) {
      filter.$or = [
        { organisation: new mongoose.Types.ObjectId(orgId) },
        { organisation: null },
        { organisation: { $exists: false } },
      ];
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(NOTIFICATION_LIMIT)
      .populate('task', 'board');

    const unreadFilter = { ...filter, isRead: false };
    const unreadCount = await Notification.countDocuments(unreadFilter);

    return res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('getNotifications error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PUT /api/notifications/:id/read
 *
 * Mark one notification as read. Must belong to the current user.
 */
const markAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }

    const notif = await Notification.findOne({ _id: id, user: userId });
    if (!notif) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    notif.isRead = true;
    await notif.save();
    return res.json({ notification: notif });
  } catch (err) {
    console.error('markAsRead error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PUT /api/notifications/read-all?org=<orgId>
 *
 * Bulk mark every unread notification for the current user as read. When
 * `org` is supplied, only notifications for that organisation (plus
 * organisation-less personal-task notifications) are affected, matching
 * the scoping of the GET endpoint so the bell stays consistent.
 */
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = (req.query.org || '').toString().trim();

    const filter = { user: userId, isRead: false };
    if (orgId && mongoose.Types.ObjectId.isValid(orgId)) {
      filter.$or = [
        { organisation: new mongoose.Types.ObjectId(orgId) },
        { organisation: null },
        { organisation: { $exists: false } },
      ];
    }

    const result = await Notification.updateMany(filter, {
      $set: { isRead: true },
    });
    return res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    console.error('markAllAsRead error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * DELETE /api/notifications/:id
 *
 * Delete a single notification. Must belong to the current user.
 */
const deleteNotification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }

    const result = await Notification.deleteOne({ _id: id, user: userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('deleteNotification error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
