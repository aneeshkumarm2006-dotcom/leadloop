/**
 * sequenceService.js — the email-sequence engine (Phase 4, Comms).
 *
 * One surface shared by the runner (sweeps due steps), the controller (enroll,
 * bulk "mass email", stats) and the ENROLL_IN_SEQUENCE automation action. It
 * sends each step through the existing tracked `sendEmailForTask` primitive, so
 * open/click tracking on the resulting EmailMessage comes for free.
 *
 * Pure helpers (`stepDelayMs`, `firstRunAt`, `advanceCursor`) carry the cadence
 * math and are unit-tested without a DB.
 */

const EmailSequence = require('../models/EmailSequence');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const EmailTemplate = require('../models/EmailTemplate');
const EmailMessage = require('../models/EmailMessage');
const Task = require('../models/Task');
const Board = require('../models/Board');
const { interpolate } = require('../utils/templateInterpolate');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UNIT_MS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

// ---- pure cadence math (unit-tested) --------------------------------------

/** Milliseconds to wait before a step fires (delay after the previous send). */
const stepDelayMs = (step) => {
  if (!step) return 0;
  const amt = Math.max(0, Number(step.delayAmount) || 0);
  const unit = UNIT_MS[step.delayUnit] || UNIT_MS.days;
  return amt * unit;
};

/** When the first step is due, given the enrollment moment. */
const firstRunAt = (steps, now = new Date()) =>
  new Date(now.getTime() + stepDelayMs((steps && steps[0]) || {}));

/**
 * Advance the cursor after sending `fromStep`. Returns the next persisted shape:
 * `completed` (cursor past the last step) or `active` with the next `nextRunAt`.
 */
const advanceCursor = (steps, fromStep, now = new Date()) => {
  const next = fromStep + 1;
  if (!Array.isArray(steps) || next >= steps.length) {
    return { currentStep: next, status: 'completed', nextRunAt: null, completedAt: now };
  }
  return {
    currentStep: next,
    status: 'active',
    nextRunAt: new Date(now.getTime() + stepDelayMs(steps[next])),
    completedAt: null,
  };
};

// ---- recipient resolution -------------------------------------------------

const readCV = (task, colId) => {
  const cv = task && task.columnValues;
  if (!cv) return undefined;
  const key = String(colId);
  return typeof cv.get === 'function' ? cv.get(key) : cv[key];
};

/** The board column id to read a lead's email from (preferred, else first email column). */
const findEmailColumnId = (board, preferred) => {
  if (preferred) return String(preferred);
  const col = (board && Array.isArray(board.columns) ? board.columns : []).find(
    (c) => c && c.type === 'email'
  );
  return col ? String(col._id) : '';
};

/** Resolve a lead's email address from the board's email column. '' if none/invalid. */
const resolveRecipientEmail = (task, board, emailColumnId) => {
  const colId = findEmailColumnId(board, emailColumnId);
  if (!colId) return '';
  const raw = readCV(task, colId);
  const val = raw && typeof raw === 'object' ? raw.email || raw.value : raw;
  const s = val ? String(val).trim() : '';
  return EMAIL_RE.test(s) ? s : '';
};

// ---- enrollment -----------------------------------------------------------

/**
 * Enroll a (loaded) task into a (loaded) sequence. Idempotent: returns the
 * existing enrollment when the lead is already active in this sequence.
 * @returns {{ ok: boolean, reason?: string, enrollment?: object }}
 */
const enrollTask = async ({ sequence, task, board, recipientEmail = '', enrolledBy = null }) => {
  if (!sequence || !sequence.active || !Array.isArray(sequence.steps) || sequence.steps.length === 0) {
    return { ok: false, reason: 'sequence_inactive_or_empty' };
  }
  const existing = await SequenceEnrollment.findOne({
    sequence: sequence._id,
    task: task._id,
    status: 'active',
  });
  if (existing) return { ok: false, reason: 'already_enrolled', enrollment: existing };

  const provided = recipientEmail && EMAIL_RE.test(String(recipientEmail).trim())
    ? String(recipientEmail).trim()
    : '';
  const email = provided || resolveRecipientEmail(task, board, sequence.emailColumnId);
  if (!email) return { ok: false, reason: 'no_recipient' };

  const now = new Date();
  const enrollment = await SequenceEnrollment.create({
    sequence: sequence._id,
    organisation: sequence.organisation,
    board: sequence.board || (board && board._id) || null,
    task: task._id,
    recipientEmail: email,
    status: 'active',
    currentStep: 0,
    nextRunAt: firstRunAt(sequence.steps, now),
    enrolledAt: now,
    enrolledBy,
  });
  return { ok: true, enrollment };
};

/** Load sequence + task + board by id and enroll. Used by the automation action. */
const enrollById = async ({ sequenceId, taskId, enrolledBy = null }) => {
  const sequence = await EmailSequence.findById(sequenceId);
  if (!sequence) return { ok: false, reason: 'sequence_not_found' };
  const task = await Task.findById(taskId);
  if (!task) return { ok: false, reason: 'task_not_found' };
  const board = await Board.findById(sequence.board || task.board);
  return enrollTask({ sequence, task, board, enrolledBy });
};

// ---- runner step ----------------------------------------------------------

/** Terminate an enrollment with a reason (sequence gone, lead deleted, …). */
const stopEnrollment = async (enrollment, status, reason, now = new Date()) => {
  enrollment.status = status;
  enrollment.stoppedReason = reason;
  enrollment.completedAt = now;
  enrollment.nextRunAt = null;
  await enrollment.save();
};

/** Resolve a step's templated subject/body (inline overrides a linked template). */
const resolveStepContent = async (step) => {
  let subject = step.subject || '';
  let body = step.body || '';
  if ((!subject || !body) && step.templateId) {
    const tpl = await EmailTemplate.findById(step.templateId).lean();
    if (tpl) {
      if (!subject) subject = tpl.subject || '';
      if (!body) body = tpl.body || '';
    }
  }
  return { subject, body };
};

/**
 * Send the due step of one enrollment and advance the cursor. A failed or
 * empty-body step is recorded but does NOT block the cadence (the cursor still
 * advances). Reuses `sendEmailForTask` (tracked) and `resolveSenderAccount`.
 */
const processEnrollment = async (enrollment, now = new Date()) => {
  const sequence = await EmailSequence.findById(enrollment.sequence);
  if (!sequence || !sequence.active) {
    await stopEnrollment(enrollment, 'stopped', 'Sequence inactive', now);
    return { sent: false, reason: 'sequence_inactive' };
  }
  const steps = Array.isArray(sequence.steps) ? sequence.steps : [];
  if (enrollment.currentStep >= steps.length) {
    enrollment.status = 'completed';
    enrollment.completedAt = now;
    enrollment.nextRunAt = null;
    await enrollment.save();
    return { sent: false, reason: 'already_complete' };
  }

  const task = await Task.findById(enrollment.task);
  if (!task) {
    await stopEnrollment(enrollment, 'stopped', 'Lead deleted', now);
    return { sent: false, reason: 'task_missing' };
  }
  const board = await Board.findById(sequence.board || task.board);
  const email = enrollment.recipientEmail || resolveRecipientEmail(task, board, sequence.emailColumnId);
  if (!email) {
    await stopEnrollment(enrollment, 'stopped', 'No recipient email', now);
    return { sent: false, reason: 'no_recipient' };
  }

  const stepIndex = enrollment.currentStep;
  const { subject: subjectTpl, body: bodyTpl } = await resolveStepContent(steps[stepIndex]);
  const subject = interpolate(subjectTpl, { task, board });
  const body = interpolate(bodyTpl, { task, board });

  let message = null;
  let entryStatus = 'sent';
  let entryError = '';

  if (!body.trim()) {
    entryStatus = 'skipped';
    entryError = 'Empty body';
  } else {
    const { sendEmailForTask, resolveSenderAccount } = require('./taskEmail');
    const candidateUserIds = [
      ...(Array.isArray(task.assignedTo) ? task.assignedTo : []),
      sequence.createdBy,
    ];
    const account = await resolveSenderAccount({
      workspaceId: sequence.organisation,
      candidateUserIds,
    });
    message = await sendEmailForTask({
      taskId: task._id,
      to: [email],
      subject,
      body,
      account,
      sentBy: sequence.createdBy,
    });
    if (message.status === 'failed') {
      entryStatus = 'failed';
      entryError = message.sendError || 'Send failed';
    }
  }

  enrollment.history.push({
    step: stepIndex,
    sentAt: now,
    messageId: message ? message._id : null,
    status: entryStatus,
    error: entryError,
  });
  if (message) enrollment.lastMessageId = message._id;

  const adv = advanceCursor(steps, stepIndex, now);
  enrollment.currentStep = adv.currentStep;
  enrollment.status = adv.status;
  enrollment.nextRunAt = adv.nextRunAt;
  enrollment.completedAt = adv.completedAt;
  await enrollment.save();

  return { sent: entryStatus === 'sent', status: entryStatus, messageId: message ? message._id : null };
};

/**
 * Stop every active enrollment for a task whose sequence has `stopOnReply`.
 * Called from the runner's `email.received` listener. Returns the count stopped.
 */
const stopEnrollmentsForReply = async (taskId) => {
  const active = await SequenceEnrollment.find({ task: taskId, status: 'active' }).populate(
    'sequence',
    'stopOnReply'
  );
  const now = new Date();
  let stopped = 0;
  for (const en of active) {
    if (en.sequence && en.sequence.stopOnReply === false) continue;
    en.status = 'replied';
    en.stoppedReason = 'Contact replied';
    en.completedAt = now;
    en.nextRunAt = null;
    await en.save();
    stopped += 1;
  }
  return stopped;
};

// ---- stats ----------------------------------------------------------------

/** Roll up enrollment counts + open/click rates for one sequence. */
const sequenceStats = async (sequenceId) => {
  const enrollments = await SequenceEnrollment.find({ sequence: sequenceId })
    .select('status history')
    .lean();
  const byStatus = { active: 0, completed: 0, stopped: 0, replied: 0, failed: 0, unsubscribed: 0 };
  const messageIds = [];
  for (const en of enrollments) {
    byStatus[en.status] = (byStatus[en.status] || 0) + 1;
    for (const h of en.history || []) {
      if (h.messageId && h.status === 'sent') messageIds.push(h.messageId);
    }
  }
  let sent = 0;
  let opened = 0;
  let clicked = 0;
  if (messageIds.length) {
    const msgs = await EmailMessage.find({ _id: { $in: messageIds } })
      .select('openedAt clicks')
      .lean();
    sent = msgs.length;
    for (const m of msgs) {
      if (Array.isArray(m.openedAt) && m.openedAt.length) opened += 1;
      if (Array.isArray(m.clicks) && m.clicks.length) clicked += 1;
    }
  }
  return {
    enrollments: enrollments.length,
    byStatus,
    emails: {
      sent,
      opened,
      clicked,
      openRate: sent ? opened / sent : 0,
      clickRate: sent ? clicked / sent : 0,
    },
    replied: byStatus.replied,
  };
};

module.exports = {
  EMAIL_RE,
  stepDelayMs,
  firstRunAt,
  advanceCursor,
  findEmailColumnId,
  resolveRecipientEmail,
  enrollTask,
  enrollById,
  processEnrollment,
  stopEnrollmentsForReply,
  sequenceStats,
};
