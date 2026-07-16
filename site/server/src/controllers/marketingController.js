const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const Campaign = require('../models/Campaign');
const { computeRoi } = require('../services/marketingRoiService');

/**
 * marketingController — Phase 2.3 campaigns CRUD + the Marketing/ROI report.
 * Admin-only (financial data); org-scoped via `orgId`.
 */

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadAdminOrg = async (orgId, userId) => {
  if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
    return { status: 400, error: 'A valid orgId is required' };
  }
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Organisation not found' };
  if (!org.members.some((m) => m.toString() === userId)) {
    return { status: 403, error: 'Not a member of this organisation' };
  }
  if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { org };
};

const serialize = (c) => ({
  _id: c._id,
  workspaceId: c.workspaceId,
  boardId: c.boardId,
  name: c.name,
  source: c.source,
  budget: c.budget,
  startDate: c.startDate,
  endDate: c.endDate,
  active: c.active,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** GET /api/marketing/campaigns?orgId=&boardId= */
const listCampaigns = async (req, res) => {
  try {
    const ctx = await loadAdminOrg(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const filter = { workspaceId: ctx.org._id };
    if (req.query.boardId && mongoose.Types.ObjectId.isValid(req.query.boardId)) {
      filter.$or = [{ boardId: req.query.boardId }, { boardId: null }];
    }
    const campaigns = await Campaign.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ campaigns: campaigns.map(serialize) });
  } catch (err) {
    console.error('listCampaigns error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const validateBody = async (body, org) => {
  const name = (body.name || '').toString().trim();
  if (!name) return { error: 'Campaign name is required' };
  const source = (body.source || '').toString().trim();
  if (!source) return { error: 'Source is required' };
  const budget = body.budget == null || body.budget === '' ? 0 : Number(body.budget);
  if (!Number.isFinite(budget) || budget < 0) return { error: 'Budget must be a non-negative number' };

  let boardId = null;
  if (body.boardId) {
    if (!mongoose.Types.ObjectId.isValid(body.boardId)) return { error: 'Invalid boardId' };
    const board = await Board.findById(body.boardId).select('organisation');
    if (!board || board.organisation.toString() !== org._id.toString()) {
      return { error: 'Board does not belong to this workspace' };
    }
    boardId = board._id;
  }
  return {
    doc: {
      name,
      source,
      budget,
      boardId,
      startDate: parseDate(body.startDate),
      endDate: parseDate(body.endDate),
      active: body.active !== false,
    },
  };
};

/** POST /api/marketing/campaigns?orgId= */
const createCampaign = async (req, res) => {
  try {
    const ctx = await loadAdminOrg(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const v = await validateBody(req.body || {}, ctx.org);
    if (v.error) return res.status(400).json({ error: v.error });
    const campaign = await Campaign.create({
      ...v.doc,
      workspaceId: ctx.org._id,
      createdBy: req.user.userId,
    });
    return res.status(201).json({ campaign: serialize(campaign) });
  } catch (err) {
    console.error('createCampaign error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PATCH /api/marketing/campaigns/:id?orgId= */
const updateCampaign = async (req, res) => {
  try {
    const ctx = await loadAdminOrg(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: ctx.org._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const v = await validateBody({ ...serialize(campaign), ...req.body }, ctx.org);
    if (v.error) return res.status(400).json({ error: v.error });
    Object.assign(campaign, v.doc);
    await campaign.save();
    return res.json({ campaign: serialize(campaign) });
  } catch (err) {
    console.error('updateCampaign error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** DELETE /api/marketing/campaigns/:id?orgId= */
const deleteCampaign = async (req, res) => {
  try {
    const ctx = await loadAdminOrg(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, workspaceId: ctx.org._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    return res.status(204).end();
  } catch (err) {
    console.error('deleteCampaign error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/marketing/roi?orgId=&boardId=&sourceColumnId=&from=&to= */
const getRoi = async (req, res) => {
  try {
    const ctx = await loadAdminOrg(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { boardId, sourceColumnId } = req.query;
    if (!boardId || !mongoose.Types.ObjectId.isValid(boardId)) {
      return res.status(400).json({ error: 'A valid boardId is required' });
    }
    const board = await Board.findOne({ _id: boardId, organisation: ctx.org._id });
    if (!board) return res.status(404).json({ error: 'Board not found' });
    if (!sourceColumnId) {
      return res.status(400).json({ error: 'sourceColumnId is required' });
    }
    const hasCol = (board.columns || []).some((c) => c._id.toString() === String(sourceColumnId));
    if (!hasCol) return res.status(400).json({ error: 'sourceColumnId is not a column on this board' });

    const report = await computeRoi({
      org: ctx.org,
      board,
      sourceColumnId,
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
      wonStatusId: req.query.wonStatusId || null,
    });
    return res.json(report);
  } catch (err) {
    console.error('getRoi error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { listCampaigns, createCampaign, updateCampaign, deleteCampaign, getRoi };
