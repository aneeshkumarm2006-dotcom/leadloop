/**
 * slaController.js — the response clock.
 *
 *   GET /api/sla?org=   (member) live queue + today's summary
 *   PUT /api/sla        (admin)  update the workspace policy
 */

const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const Task = require('../models/Task');
const { evaluate, summarise, resolvePolicy } = require('../services/slaService');

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

/** GET /api/sla?org= */
const getSla = async (req, res) => {
  try {
    const ctx = await loadOrg(req.query.org, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const policy = resolvePolicy(ctx.org.sla || {});

    const boards = await Board.find({ organisation: ctx.org._id }).select('_id name').lean();
    const boardName = new Map(boards.map((b) => [String(b._id), b.name]));

    // Everything with a clock from the last 7 days — enough for today's numbers
    // without scanning the whole history on every page load.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const leads = await Task.find({
      board: { $in: boards.map((b) => b._id) },
      slaDueAt: { $ne: null },
      createdAt: { $gte: since },
      isSample: { $ne: true },
    })
      .select('name board assignedTo createdAt slaDueAt firstResponseAt slaEscalatedAt')
      .populate('assignedTo', 'name email')
      .sort({ slaDueAt: 1 })
      .limit(200)
      .lean();

    const now = new Date();
    const evaluated = leads.map((l) => ({ lead: l, state: evaluate(l, policy, now) }));

    return res.json({
      policy,
      summary: summarise(evaluated.map((e) => e.state)),
      // The queue shows only what still needs a human: answered leads are done.
      queue: evaluated
        .filter((e) => e.state.state !== 'responded')
        .map(({ lead, state }) => ({
          _id: lead._id,
          name: lead.name,
          boardId: lead.board,
          boardName: boardName.get(String(lead.board)) || '',
          owner: (lead.assignedTo || [])[0] || null,
          createdAt: lead.createdAt,
          dueAt: state.dueAt,
          state: state.state,
          msRemaining: state.msRemaining,
          msLate: state.msLate,
          percentElapsed: state.percentElapsed,
          escalated: !!lead.slaEscalatedAt,
        })),
    });
  } catch (err) {
    console.error('getSla error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PUT /api/sla — update the workspace's policy (admin). */
const updateSla = async (req, res) => {
  try {
    const ctx = await loadOrg(req.body?.org, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const next = resolvePolicy({ ...(ctx.org.sla || {}), ...(req.body || {}) });
    ctx.org.sla = next;
    await ctx.org.save();
    return res.json({ policy: next });
  } catch (err) {
    console.error('updateSla error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getSla, updateSla };
