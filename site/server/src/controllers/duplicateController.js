/**
 * duplicateController.js — the duplicate queue and the merge operation.
 *
 *   GET    /api/duplicates?org=          (member) pending pairs, with previews
 *   POST   /api/duplicates/:id/merge     (admin)  merge the pair
 *   POST   /api/duplicates/:id/dismiss   (admin)  "these are different people"
 *
 * Merging is the one genuinely destructive action in this feature, so:
 *   • it is admin-only;
 *   • the surviving record is the OLDER lead by default (it carries the
 *     history), and the newer one is removed;
 *   • field values are merged with `mergeValues`, which never blanks a field
 *     that only one side filled in;
 *   • the duplicate's source tag is preserved on the survivor where possible,
 *     so attribution reporting still knows the lead came from both places.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Task = require('../models/Task');
const Organisation = require('../models/Organisation');
const DuplicateCandidate = require('../models/DuplicateCandidate');
const { mergeValues } = require('../services/dedupeService');

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadOrg = async (orgId, userId, { admin = false } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(orgId)) return { status: 400, error: 'Invalid workspace id' };
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Workspace not found' };
  if (!org.members.some((m) => m.toString() === userId)) {
    return { status: 403, error: 'Not a member of this workspace' };
  }
  if (admin && !isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { org };
};

/** A lead flattened for the merge UI: every column, labelled. */
const previewTask = (task, board) => {
  const columns = (board?.columns || []).filter((c) => !c.isPrimary);
  const values = {};
  for (const col of columns) {
    const id = String(col._id);
    const raw =
      task.columnValues && typeof task.columnValues.get === 'function'
        ? task.columnValues.get(id)
        : task.columnValues?.[id];
    values[id] = raw == null ? '' : raw;
  }
  return {
    _id: task._id,
    name: task.name,
    createdAt: task.createdAt,
    group: task.group,
    values,
    columns: columns.map((c) => ({ _id: String(c._id), name: c.name, type: c.type })),
  };
};

/** GET /api/duplicates?org=:orgId — the pending queue. */
const listDuplicates = async (req, res) => {
  try {
    const ctx = await loadOrg(req.query.org, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const candidates = await DuplicateCandidate.find({
      organisation: ctx.org._id,
      status: 'pending',
    })
      .sort({ score: -1, createdAt: -1 })
      .limit(50)
      .lean();

    // Resolve both sides; drop rows whose tasks have since been deleted.
    const out = [];
    for (const c of candidates) {
      const [task, other, board] = await Promise.all([
        Task.findById(c.task).select('name columnValues createdAt group').lean(),
        Task.findById(c.duplicateOf).select('name columnValues createdAt group').lean(),
        Board.findById(c.board).select('name columns').lean(),
      ]);
      if (!task || !other || !board) {
        await DuplicateCandidate.deleteOne({ _id: c._id });
        continue;
      }
      out.push({
        _id: c._id,
        score: c.score,
        reasons: c.reasons,
        createdAt: c.createdAt,
        boardId: board._id,
        boardName: board.name,
        incoming: previewTask(task, board),
        existing: previewTask(other, board),
      });
    }
    return res.json({ duplicates: out, total: out.length });
  } catch (err) {
    console.error('listDuplicates error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/duplicates/:id/merge (admin).
 * Body: { choices: { [columnId]: 'primary' | 'duplicate' }, keep: 'existing' | 'incoming' }
 */
const mergeDuplicate = async (req, res) => {
  try {
    const candidate = await DuplicateCandidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Duplicate not found' });
    const ctx = await loadOrg(candidate.organisation, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (candidate.status !== 'pending') {
      return res.status(409).json({ error: 'This pair has already been resolved' });
    }

    const board = await Board.findById(candidate.board).select('columns organisation');
    if (!board) return res.status(422).json({ error: 'Board no longer exists' });

    // Default: keep the OLDER record — it holds the activity and history.
    const keepIncoming = req.body?.keep === 'incoming';
    const survivorId = keepIncoming ? candidate.task : candidate.duplicateOf;
    const removedId = keepIncoming ? candidate.duplicateOf : candidate.task;

    const [survivor, removed] = await Promise.all([Task.findById(survivorId), Task.findById(removedId)]);
    if (!survivor || !removed) {
      await DuplicateCandidate.deleteOne({ _id: candidate._id });
      return res.status(422).json({ error: 'One of these leads no longer exists' });
    }

    // Merge the column values. `choices` keys are column ids; 'primary' means
    // the survivor, 'duplicate' the record being removed.
    // columnValues is a Mongoose Map; fall back gracefully for a plain object.
    const asObject = (cv) => {
      if (!cv) return {};
      if (typeof cv.entries === 'function') return Object.fromEntries(cv.entries());
      return { ...cv };
    };
    const merged = mergeValues(asObject(survivor.columnValues), asObject(removed.columnValues), req.body?.choices || {});
    survivor.columnValues = new Map(Object.entries(merged).filter(([, v]) => v !== undefined));

    // Keep the better name if the survivor's is emptier than the other's.
    if (!survivor.name && removed.name) survivor.name = removed.name;

    await survivor.save();
    await Task.deleteOne({ _id: removed._id });

    candidate.status = 'merged';
    candidate.resolvedBy = req.user.userId;
    candidate.resolvedAt = new Date();
    await candidate.save();

    // Any other pending pair referencing the removed lead is now meaningless.
    await DuplicateCandidate.deleteMany({
      status: 'pending',
      $or: [{ task: removed._id }, { duplicateOf: removed._id }],
    });

    return res.json({ merged: true, survivorId: survivor._id, removedId: removed._id });
  } catch (err) {
    console.error('mergeDuplicate error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/duplicates/:id/dismiss (admin) — different people; never re-raise. */
const dismissDuplicate = async (req, res) => {
  try {
    const candidate = await DuplicateCandidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Duplicate not found' });
    const ctx = await loadOrg(candidate.organisation, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    candidate.status = 'dismissed';
    candidate.resolvedBy = req.user.userId;
    candidate.resolvedAt = new Date();
    await candidate.save();
    return res.json({ dismissed: true });
  } catch (err) {
    console.error('dismissDuplicate error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { listDuplicates, mergeDuplicate, dismissDuplicate };
