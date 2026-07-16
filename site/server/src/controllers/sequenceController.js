/**
 * sequenceController.js — CRUD + enroll + stats for email sequences (Phase 4).
 *
 * Board-scoped, mirrors automationController's auth: `loadBoardContext` asserts
 * the requester is a member of the board's organisation. Enrollment is the
 * "mass email" surface too — POST a set of taskIds to drip them all.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Task = require('../models/Task');
const Organisation = require('../models/Organisation');
const EmailSequence = require('../models/EmailSequence');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const { enrollTask, sequenceStats } = require('../services/sequenceService');

const DELAY_UNITS = ['minutes', 'hours', 'days'];
const MAX_STEPS = 25;
const MAX_BULK = 500;

const isObjectId = (v) => v != null && mongoose.Types.ObjectId.isValid(String(v));

const loadBoardContext = async (boardId, userId) => {
  if (!isObjectId(boardId)) return { status: 400, error: 'Invalid board id' };
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };
  const isMember = org.members.some((m) => m.toString() === userId);
  if (!isMember) return { status: 403, error: 'Not a member of this organisation' };
  return { board, org };
};

/** Normalise + validate a steps[] payload. Throws { status, error } on bad input. */
const sanitizeSteps = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw { status: 400, error: 'A sequence needs at least one step' };
  }
  if (raw.length > MAX_STEPS) {
    throw { status: 400, error: `A sequence can have at most ${MAX_STEPS} steps` };
  }
  return raw.map((s, i) => {
    const step = s || {};
    const delayAmount = Math.max(0, Number(step.delayAmount) || 0);
    const delayUnit = DELAY_UNITS.includes(step.delayUnit) ? step.delayUnit : 'days';
    const subject = step.subject ? String(step.subject) : '';
    const body = step.body ? String(step.body) : '';
    const templateId = isObjectId(step.templateId) ? step.templateId : null;
    if (!body.trim() && !templateId) {
      throw { status: 400, error: `Step ${i + 1} needs a body or a template` };
    }
    return { delayAmount, delayUnit, subject, body, templateId };
  });
};

const serializeSequence = (seq) => ({
  _id: seq._id,
  name: seq.name,
  description: seq.description,
  board: seq.board,
  organisation: seq.organisation,
  emailColumnId: seq.emailColumnId,
  steps: seq.steps,
  stopOnReply: seq.stopOnReply,
  active: seq.active,
  createdBy: seq.createdBy,
  createdAt: seq.createdAt,
  updatedAt: seq.updatedAt,
});

// ---- handlers -------------------------------------------------------------

const listSequences = async (req, res) => {
  const userId = req.user.userId;
  const { boardId } = req.params;
  const ctx = await loadBoardContext(boardId, userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

  const sequences = await EmailSequence.find({ board: boardId }).sort({ createdAt: -1 });
  // Attach a lightweight active-enrollment count per sequence for the list UI.
  const counts = await SequenceEnrollment.aggregate([
    { $match: { board: new mongoose.Types.ObjectId(boardId), status: 'active' } },
    { $group: { _id: '$sequence', n: { $sum: 1 } } },
  ]);
  const activeBySeq = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(
    sequences.map((s) => ({
      ...serializeSequence(s),
      activeEnrollments: activeBySeq.get(String(s._id)) || 0,
    }))
  );
};

const createSequence = async (req, res) => {
  const userId = req.user.userId;
  const { boardId } = req.params;
  const ctx = await loadBoardContext(boardId, userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

  const { name, description, emailColumnId, steps, stopOnReply, active } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'A sequence name is required' });
  }
  let cleanSteps;
  try {
    cleanSteps = sanitizeSteps(steps);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.error || 'Invalid steps' });
  }

  const seq = await EmailSequence.create({
    organisation: ctx.board.organisation,
    board: boardId,
    name: String(name).trim(),
    description: description ? String(description) : '',
    emailColumnId: emailColumnId ? String(emailColumnId) : '',
    steps: cleanSteps,
    stopOnReply: stopOnReply !== false,
    active: active !== false,
    createdBy: userId,
  });
  res.status(201).json(serializeSequence(seq));
};

const loadSequenceContext = async (sequenceId, userId) => {
  if (!isObjectId(sequenceId)) return { status: 400, error: 'Invalid sequence id' };
  const sequence = await EmailSequence.findById(sequenceId);
  if (!sequence) return { status: 404, error: 'Sequence not found' };
  const ctx = await loadBoardContext(sequence.board, userId);
  if (ctx.error) return ctx;
  return { sequence, board: ctx.board, org: ctx.org };
};

const getSequence = async (req, res) => {
  const ctx = await loadSequenceContext(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  res.json(serializeSequence(ctx.sequence));
};

const updateSequence = async (req, res) => {
  const ctx = await loadSequenceContext(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  const seq = ctx.sequence;
  const { name, description, emailColumnId, steps, stopOnReply, active } = req.body || {};

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'A sequence name is required' });
    seq.name = String(name).trim();
  }
  if (description !== undefined) seq.description = String(description || '');
  if (emailColumnId !== undefined) seq.emailColumnId = emailColumnId ? String(emailColumnId) : '';
  if (steps !== undefined) {
    try {
      seq.steps = sanitizeSteps(steps);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.error || 'Invalid steps' });
    }
  }
  if (stopOnReply !== undefined) seq.stopOnReply = stopOnReply !== false;
  if (active !== undefined) seq.active = active !== false;

  await seq.save();
  res.json(serializeSequence(seq));
};

const deleteSequence = async (req, res) => {
  const ctx = await loadSequenceContext(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  await EmailSequence.deleteOne({ _id: ctx.sequence._id });
  // Stop any in-flight enrollments so the runner stops sweeping them.
  await SequenceEnrollment.updateMany(
    { sequence: ctx.sequence._id, status: 'active' },
    { $set: { status: 'stopped', stoppedReason: 'Sequence deleted', nextRunAt: null } }
  );
  res.json({ ok: true });
};

/** Bulk-enroll leads (mass email). Body: { taskIds: [] }. */
const enrollLeads = async (req, res) => {
  const ctx = await loadSequenceContext(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  const { sequence, board } = ctx;

  const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds.filter(isObjectId) : [];
  if (!taskIds.length) return res.status(400).json({ error: 'No valid taskIds provided' });
  if (taskIds.length > MAX_BULK) {
    return res.status(400).json({ error: `Enroll at most ${MAX_BULK} leads at once` });
  }

  const tasks = await Task.find({ _id: { $in: taskIds }, board: board._id });
  const enrolled = [];
  const skipped = [];
  for (const task of tasks) {
    const result = await enrollTask({
      sequence,
      task,
      board,
      enrolledBy: req.user.userId,
    });
    if (result.ok) enrolled.push(String(task._id));
    else skipped.push({ taskId: String(task._id), reason: result.reason });
  }
  res.json({ enrolled: enrolled.length, skipped });
};

const listEnrollments = async (req, res) => {
  const ctx = await loadSequenceContext(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  const enrollments = await SequenceEnrollment.find({ sequence: ctx.sequence._id })
    .sort({ enrolledAt: -1 })
    .limit(500)
    .populate('task', 'name')
    .lean();
  res.json(
    enrollments.map((e) => ({
      _id: e._id,
      task: e.task ? { _id: e.task._id, name: e.task.name } : null,
      recipientEmail: e.recipientEmail,
      status: e.status,
      currentStep: e.currentStep,
      nextRunAt: e.nextRunAt,
      enrolledAt: e.enrolledAt,
      completedAt: e.completedAt,
      stoppedReason: e.stoppedReason,
      sentCount: (e.history || []).filter((h) => h.status === 'sent').length,
    }))
  );
};

const getStats = async (req, res) => {
  const ctx = await loadSequenceContext(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  const stats = await sequenceStats(ctx.sequence._id);
  res.json(stats);
};

const stopEnrollment = async (req, res) => {
  const { enrollmentId } = req.params;
  if (!isObjectId(enrollmentId)) return res.status(400).json({ error: 'Invalid enrollment id' });
  const enrollment = await SequenceEnrollment.findById(enrollmentId);
  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
  const ctx = await loadBoardContext(enrollment.board, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (enrollment.status === 'active') {
    enrollment.status = 'stopped';
    enrollment.stoppedReason = 'Stopped manually';
    enrollment.completedAt = new Date();
    enrollment.nextRunAt = null;
    await enrollment.save();
  }
  res.json({ ok: true, status: enrollment.status });
};

module.exports = {
  listSequences,
  createSequence,
  getSequence,
  updateSequence,
  deleteSequence,
  enrollLeads,
  listEnrollments,
  getStats,
  stopEnrollment,
};
