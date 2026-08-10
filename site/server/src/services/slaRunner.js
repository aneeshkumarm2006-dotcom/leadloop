const cron = require('node-cron');

/**
 * slaRunner.js — escalate leads nobody answered.
 *
 * Mirrors sequenceRunner / automationRunner: node-cron every minute with a
 * `started` guard so a hot reload can't double-schedule it.
 *
 * A breached lead is escalated ONCE (`slaEscalatedAt` is the guard): it is
 * reassigned to another member of the workspace and an event is emitted so
 * notifications and automations can react. Reassignment is the point — the
 * whole feature is worthless if a lead simply sits in the same inbox being
 * ignored, only now with a red badge.
 */

const Task = require('../models/Task');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const eventBus = require('./eventBus');
const { evaluate, resolvePolicy } = require('./slaService');
const { notifySafely } = require('./pushService');

let started = false;

/**
 * Choose who to hand an unanswered lead to: any workspace admin who isn't the
 * current owner. Admins are the safe default — they can always see every lead,
 * so escalation can never route a lead to someone who then can't open it.
 */
const pickEscalationTarget = (org, currentOwnerIds = []) => {
  const owners = new Set(currentOwnerIds.map(String));
  const candidates = [
    ...(Array.isArray(org.admins) ? org.admins : []),
    ...(org.admin ? [org.admin] : []),
  ].map(String);
  return candidates.find((id) => !owners.has(id)) || null;
};

/**
 * One pass: find overdue, unanswered leads and escalate the ones past the
 * grace period. Exported so it can be run directly (tests, a manual kick).
 */
const runOnce = async (now = new Date()) => {
  const due = await Task.find({
    slaDueAt: { $ne: null, $lte: now },
    firstResponseAt: null,
    slaEscalatedAt: null,
    isSample: { $ne: true },
  })
    .select('name board assignedTo createdAt slaDueAt')
    .limit(200)
    .lean();

  if (!due.length) return { checked: 0, escalated: 0 };

  // Cache board → org lookups; a burst of leads usually shares a board.
  const boardCache = new Map();
  const orgCache = new Map();
  let escalated = 0;

  for (const task of due) {
    try {
      const boardId = String(task.board);
      if (!boardCache.has(boardId)) {
        // eslint-disable-next-line no-await-in-loop
        boardCache.set(boardId, await Board.findById(task.board).select('organisation').lean());
      }
      const board = boardCache.get(boardId);
      if (!board) continue;

      const orgId = String(board.organisation);
      if (!orgCache.has(orgId)) {
        // eslint-disable-next-line no-await-in-loop
        orgCache.set(orgId, await Organisation.findById(board.organisation).select('sla admin admins members').lean());
      }
      const org = orgCache.get(orgId);
      if (!org) continue;

      const policy = resolvePolicy(org.sla || {});
      if (!policy.enabled) continue;

      const state = evaluate(task, policy, now);
      if (!state.shouldEscalate) continue;

      const target = pickEscalationTarget(org, task.assignedTo || []);
      const update = { slaEscalatedAt: now };
      if (target) update.assignedTo = [target];

      // Guarded update: only escalate if nobody replied in the meantime.
      // eslint-disable-next-line no-await-in-loop
      const res = await Task.updateOne(
        { _id: task._id, firstResponseAt: null, slaEscalatedAt: null },
        { $set: update }
      );
      if (!(res.modifiedCount > 0)) continue;

      escalated += 1;
      eventBus.emit('lead.sla_breached', {
        taskId: task._id,
        boardId: task.board,
        organisationId: board.organisation,
        reassignedTo: target,
        msLate: state.msLate,
      });

      // Tell the humans. The agent who missed it learns why the lead moved, and
      // whoever it landed on finds out immediately — a silent reassignment just
      // moves the lead into a second inbox nobody is watching.
      const leadName = task.name || '';
      for (const prev of task.assignedTo || []) {
        notifySafely(prev, board.organisation, 'sla_breached', {
          leadName,
          taskId: task._id,
          boardId: task.board,
        });
      }
      if (target) {
        notifySafely(target, board.organisation, 'lead_assigned', {
          leadName,
          taskId: task._id,
          boardId: task.board,
          minutes: policy.targetMinutes,
        });
      }
    } catch (err) {
      console.warn('[slaRunner] lead skipped:', err.message);
    }
  }

  return { checked: due.length, escalated };
};

/** Schedule the minute-by-minute sweep (idempotent). */
const start = () => {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', () => {
    runOnce().catch((err) => console.error('[slaRunner] pass failed:', err?.message || err));
  });
};

module.exports = { startSlaRunner: start, runOnce, pickEscalationTarget };
