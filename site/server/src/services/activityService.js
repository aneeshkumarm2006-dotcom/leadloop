const ActivityLog = require('../models/ActivityLog');

/**
 * Record an activity event for a task.
 *
 * Fire-and-forget by design: failures are logged but never re-thrown so a
 * broken log never blocks the triggering mutation (mirrors notificationService).
 *
 * @param {Object} args
 * @param {Object|string} args.task    - Task doc (preferred — supplies board) OR task id
 * @param {string|ObjectId} args.actor - userId performing the action
 * @param {string} args.type           - one of ActivityLog.ACTIVITY_TYPES
 * @param {string} [args.field]        - for type 'task.field_changed'
 * @param {*}      [args.oldValue]
 * @param {*}      [args.newValue]
 * @param {Object} [args.metadata]     - { itemText, attachmentName, commentSnippet, ... }
 */
const logActivity = async ({
  task,
  actor,
  type,
  field,
  oldValue,
  newValue,
  metadata,
}) => {
  try {
    if (!task || !actor || !type) return null;

    const taskId = task._id || task;
    const boardId = task.board || null;

    const doc = await ActivityLog.create({
      task: taskId,
      board: boardId,
      actor,
      type,
      field: field || null,
      oldValue: oldValue === undefined ? null : oldValue,
      newValue: newValue === undefined ? null : newValue,
      metadata: metadata || null,
    });
    return doc;
  } catch (err) {
    console.error('logActivity error:', err);
    return null;
  }
};

/**
 * Record an `automation.run` activity event for a single AutomationRunLog row
 * (F5.6). Fire-and-forget like `logActivity` — a broken audit write never blocks
 * the automation. Multiple actions from one firing share `runId` so an audit
 * view (F16) can roll them up under one parent run.
 *
 * @param {Object} args
 * @param {Object|string} args.task        - triggering or created task (supplies board); optional
 * @param {string|ObjectId} args.actor     - actor (defaults to the automation owner)
 * @param {string|ObjectId} args.automationId
 * @param {string} args.actionType
 * @param {'ok'|'failed'|'skipped'} args.status
 * @param {string|ObjectId} [args.runId]
 * @param {string|null} [args.error]
 */
const logAutomationRun = async ({
  task,
  actor,
  automationId,
  actionType,
  status,
  runId,
  error,
}) => {
  if (!task || !actor) return null;
  return logActivity({
    task,
    actor,
    type: 'automation.run',
    metadata: {
      automationId: automationId ? automationId.toString() : null,
      actionType,
      status,
      runId: runId ? runId.toString() : null,
      error: error || null,
      taskName: task.name,
    },
  });
};

module.exports = {
  logActivity,
  logAutomationRun,
};
