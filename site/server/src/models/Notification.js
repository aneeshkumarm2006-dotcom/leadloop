const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  // Organisation the notification belongs to. Null/undefined for personal-task
  // notifications (dueSoon on isPersonal tasks) — those are shown regardless of
  // the user's currently selected org since they don't live in any workspace.
  organisation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    default: null,
    index: true,
  },
  type: {
    // 'automation' is emitted by the F5 NOTIFY_PERSON action (in-app notice from
    // an automation rather than a direct user action).
    type: String,
    // 'health' — system alerts about the workspace's setup (a lead source went
    // quiet, ad-conversion sends failing). They carry a `link`, not a task.
    enum: ['assigned', 'commented', 'mentioned', 'statusChanged', 'dueSoon', 'automation', 'health'],
  },
  // In-app path to open when the notification is clicked (e.g. /lead-sources).
  link: {
    type: String,
  },
  message: {
    type: String,
  },
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
